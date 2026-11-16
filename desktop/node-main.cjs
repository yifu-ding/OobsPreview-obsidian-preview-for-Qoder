'use strict';

// Qoder Desktop 的 app plugin node 入口。
// 视图跑在 isolated world + Shadow DOM 里，browser 侧 require 只有 react 白名单，
// 所以整条 markdown-it 管线放在 node 侧，浏览器只负责把 HTML 塞进 shadow root。

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const MarkdownIt = require('markdown-it');
const obsidianFootnote = require('markdown-it-footnote');

const obsidianHighlight = require('./src/highlight');
const obsidianComment = require('./src/comment');
const obsidianTag = require('./src/tag');
const obsidianCallout = require('./src/callout');
const obsidianTaskList = require('./src/tasklist');
const obsidianBlockId = require('./src/blockid');
const obsidianProperties = require('./src/properties');
const obsidianWikilink = require('./src/wikilink');
const { VaultIndex, IMAGE_EXT, OTHER_ASSET_EXT } = require('./src/vault');

const MARKDOWN_EXTS = new Set(['.md', '.markdown']);
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.obsidian', '.wolf', '.qoder', '.qoder-cn', '.claude',
  '.codex', '.trae', '.cursor', '.vscode', 'venv', '.venv', '__pycache__', 'dist', 'out',
  'build', '.next', '.cache', 'tmp'
]);
const SCAN_LIMIT = 40000;
const INDEX_TTL_MS = 30000;
const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.ico': 'image/x-icon'
};
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 16 * 1024 * 1024;
// 宿主对单次 app-plugin RPC 的响应有字符数上限（APP_PLUGIN_RPC_CHARACTER_LIMIT_EXCEEDED），
// 整页 base64 内联图片会超限。render 只发占位符，图片由视图按块拉取。
const ASSET_CHUNK_CHARS = 64 * 1024;
const ASSET_CACHE_LIMIT = 16;
const PLACEHOLDER_IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'obsidian:']);

const indexes = new Map();
const assetCache = new Map();

function isMarkdown(fsPath) {
  return MARKDOWN_EXTS.has(path.extname(fsPath).toLowerCase());
}

function vaultRootFor(fsPath) {
  let dir = path.dirname(fsPath);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.obsidian'))) { return dir; }
    const parent = path.dirname(dir);
    if (parent === dir) { return path.dirname(fsPath); }
    dir = parent;
  }
}

function walk(dir, notes, assets, budget) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (budget.left <= 0) { return; }
    if (entry.name.startsWith('.') && entry.name !== '.obsidian') { continue; }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) { walk(full, notes, assets, budget); }
      continue;
    }
    if (!entry.isFile()) { continue; }
    const ext = path.extname(entry.name).toLowerCase();
    if (MARKDOWN_EXTS.has(ext)) { notes.push(full); budget.left--; }
    else if (IMAGE_EXT.has(ext) || OTHER_ASSET_EXT.has(ext)) { assets.push(full); budget.left--; }
  }
}

function indexFor(root) {
  const cached = indexes.get(root);
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) { return cached.index; }
  const notes = [];
  const assets = [];
  walk(root, notes, assets, { left: SCAN_LIMIT });
  const index = VaultIndex.fromPaths(notes, assets);
  indexes.set(root, { index, builtAt: Date.now() });
  return index;
}

function readText(fsPath) {
  try { return fs.readFileSync(fsPath, 'utf8'); } catch { return null; }
}

// 宿主 IDE 会自己注册 front_matter 块规则，Desktop 没有，得自带。
function frontMatterRule(md) {
  md.block.ruler.before('hr', 'front_matter', (state, startLine, endLine, silent) => {
    if (startLine !== 0) { return false; }
    const open = state.src.slice(state.bMarks[0] + state.tShift[0], state.eMarks[0]).trim();
    if (open !== '---') { return false; }
    for (let line = 1; line < endLine; line++) {
      const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trim();
      if (text !== '---' && text !== '...') { continue; }
      if (silent) { return true; }
      const token = state.push('front_matter', '', 0);
      token.hidden = true;
      token.map = [0, line + 1];
      token.meta = state.src.slice(state.eMarks[0] + 1, state.bMarks[line] + state.tShift[line]);
      state.line = line + 1;
      return true;
    }
    return false;
  });
}

function createMarkdown(ctx) {
  const md = new MarkdownIt({ html: true, linkify: true });
  frontMatterRule(md);
  return md
    .use(obsidianFootnote)
    .use(obsidianHighlight)
    .use(obsidianComment)
    .use(obsidianTag)
    .use(obsidianCallout)
    .use(obsidianTaskList)
    .use(obsidianBlockId)
    .use(obsidianProperties)
    .use(obsidianWikilink, ctx);
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeFileUrl(value) {
  try { return decodeURIComponent(value.slice('file://'.length)); } catch { return null; }
}

function hasScheme(value) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function localTarget(value, noteDir) {
  if (!value || value.startsWith('#')) { return null; }
  if (value.startsWith('file://')) { return decodeFileUrl(value); }
  if (hasScheme(value)) { return null; }
  return path.resolve(noteDir, value);
}

function insideRoot(fsPath, root) {
  const rel = path.relative(root, fsPath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// 预览里没有宿主的相对路径解析器，图片也不会放行 file://。
// 本地链接改成 data-om-open 交给视图点击处理；本地图片只发占位符 + data-om-img，
// 真实字节由视图调 assetChunk 分块取回（单次 RPC 响应不能超宿主字符上限）。
function rewriteAssets(html, notePath, root, resolveAsset) {
  const noteDir = path.dirname(notePath);
  let budget = MAX_TOTAL_IMAGE_BYTES;

  const assetRef = (fsPath) => {
    const mime = IMAGE_MIME[path.extname(fsPath).toLowerCase()];
    if (!mime || !insideRoot(fsPath, root)) { return null; }
    let stat;
    try { stat = fs.statSync(fsPath); } catch { return null; }
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES || stat.size > budget) { return null; }
    budget -= stat.size;
    return fsPath;
  };

  return html.replace(/<(img|a)\b[^>]*>/gi, (tag) => tag.replace(
    /(^|\s)(data-href|href|src)="([^"]*)"/gi,
    (match, lead, attr, value) => {
      const target = localTarget(value, noteDir);
      if (!target) { return match; }
      if (attr === 'src') {
        // 文档相对路径不存在时（如拷贝出去的 README 引用原库图片），退回全库文件名解析。
        let resolved = target;
        if (!fs.existsSync(resolved) && resolveAsset) {
          let decoded = value;
          try { decoded = decodeURIComponent(value); } catch { /* 保留原值 */ }
          const hit = resolveAsset(decoded, notePath);
          if (hit) { resolved = hit; }
        }
        const ref = assetRef(resolved);
        return ref
          ? lead + 'src="' + PLACEHOLDER_IMG + '" data-om-img="' + escapeAttr(ref) + '"'
          : match;
      }
      let exists = false;
      try { exists = fs.statSync(target).isFile(); } catch { exists = false; }
      if (!exists || !insideRoot(target, root)) { return match; }
      if (attr === 'data-href') { return lead + 'data-href="#"'; }
      return lead + 'href="#" data-om-open="' + escapeAttr(target) + '"';
    }
  ));
}

// 分块返回单张图片的 base64。offset 是 base64 字符串上的字符偏移，
// 每块 ASSET_CHUNK_CHARS 字符，视图拼完后自己组 data URL。
function assetChunk(input) {
  const note = input && input.note;
  const fsPath = input && input.path;
  const offset = input && Number.isInteger(input.offset) ? input.offset : 0;
  if (typeof note !== 'string' || !path.isAbsolute(note) ||
      typeof fsPath !== 'string' || !path.isAbsolute(fsPath) || offset < 0) {
    throw new Error('OBSIDIAN_MD_PATH_INVALID');
  }
  const mime = IMAGE_MIME[path.extname(fsPath).toLowerCase()];
  if (!mime || !insideRoot(fsPath, vaultRootFor(note))) { throw new Error('OBSIDIAN_MD_ASSET_DENIED'); }
  let stat;
  try { stat = fs.statSync(fsPath); } catch { throw new Error('OBSIDIAN_MD_ASSET_MISSING'); }
  if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) { throw new Error('OBSIDIAN_MD_ASSET_DENIED'); }
  const version = stat.mtimeMs + ':' + stat.size;
  let entry = assetCache.get(fsPath);
  if (!entry || entry.version !== version) {
    let buf;
    try { buf = fs.readFileSync(fsPath); } catch { throw new Error('OBSIDIAN_MD_ASSET_MISSING'); }
    entry = { version, mime, b64: buf.toString('base64') };
    assetCache.delete(fsPath);
    assetCache.set(fsPath, entry);
    if (assetCache.size > ASSET_CACHE_LIMIT) { assetCache.delete(assetCache.keys().next().value); }
  }
  if (offset > entry.b64.length) { throw new Error('OBSIDIAN_MD_ASSET_OFFSET'); }
  const data = entry.b64.slice(offset, offset + ASSET_CHUNK_CHARS);
  const next = offset + data.length;
  return { mime: entry.mime, total: entry.b64.length, offset, data, next: next < entry.b64.length ? next : null };
}

function renderFile(fsPath) {
  const stat = fs.statSync(fsPath);
  const version = stat.mtimeMs + ':' + stat.size;
  const root = vaultRootFor(fsPath);
  const index = indexFor(root);
  const ctx = {
    resolveNote: (name, from) => index.resolveNote(name, from),
    resolveAsset: (name, from) => index.resolveAsset(name, from),
    readText,
    currentDocument: () => fsPath,
    toUri: (p) => 'file://' + String(p).split('/').map(encodeURI).join('/')
  };
  const source = fs.readFileSync(fsPath, 'utf8');
  const html = createMarkdown(ctx).render(source, { currentDocument: { fsPath } });
  return {
    version,
    title: path.basename(fsPath),
    html: rewriteAssets(html, fsPath, root, ctx.resolveAsset)
  };
}

function openExternal(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('OBSIDIAN_MD_URL_INVALID'); }
  if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) { throw new Error('OBSIDIAN_MD_URL_DENIED'); }
  // obsidian:// 交给系统路由，http(s) 交给默认浏览器；execFile 不过 shell。
  execFile('open', [parsed.href], () => {});
  return { ok: true };
}

const service = {
  name: 'obsidianMarkdown',
  methods: {
    render: async (input, context) => {
      const fromContext = context && context.fileResource && context.fileResource.path;
      const fsPath = (input && typeof input.path === 'string' && input.path) || fromContext;
      if (typeof fsPath !== 'string' || !path.isAbsolute(fsPath) || !isMarkdown(fsPath)) {
        throw new Error('OBSIDIAN_MD_PATH_INVALID');
      }
      const stat = fs.statSync(fsPath);
      const version = stat.mtimeMs + ':' + stat.size;
      if (input && input.version === version) { return { version, unchanged: true }; }
      return renderFile(fsPath);
    },
    openExternal: async (input) => openExternal(input && input.url),
    assetChunk: async (input) => assetChunk(input)
  }
};

async function activate(context) {
  const disposable = await context.api.node.registerService(service);
  context.subscriptions.push(disposable);
}

module.exports = { activate, renderFile, rewriteAssets, vaultRootFor, assetChunk, ASSET_CHUNK_CHARS };