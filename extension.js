'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
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
const { completionContext, completionItems, MetaIndex } = require('./src/complete');

const MARKDOWN_EXTS = ['.md', '.markdown'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.obsidian', '.wolf', '.qoder', '.qoder-cn',
  '.claude', '.codex', '.trae', '.cursor', '.vscode', 'venv', '.venv', '__pycache__', 'dist', 'out',
  'build', '.next', '.cache', 'tmp']);
const ASSET_EXTS = new Set([...IMAGE_EXT, ...OTHER_ASSET_EXT]);
const WATCH_EXTS = MARKDOWN_EXTS.concat([...ASSET_EXTS]).map((ext) => ext.slice(1)).join(',');
const WATCH_GLOB = `**/*.{${WATCH_EXTS}}`;
const SCAN_LIMIT = 40000;

let vault = new VaultIndex();
let roots = [];

// 直接打开单篇笔记（没有打开文件夹）时 workspace 是空的，只能从文件本身向上找库根。
function vaultRootOf(fsPath) {
  let dir = path.dirname(fsPath);
  const start = dir;
  for (;;) {
    if (fs.existsSync(path.join(dir, '.obsidian'))) { return dir; }
    const parent = path.dirname(dir);
    if (parent === dir) { return start; }
    dir = parent;
  }
}

function currentRoots() {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length) { return folders.map((folder) => folder.uri.fsPath); }
  const found = new Set();
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === 'file' && MARKDOWN_EXTS.includes(path.extname(doc.uri.fsPath).toLowerCase())) {
      found.add(vaultRootOf(doc.uri.fsPath));
    }
  }
  return [...found];
}

async function walk(dir, notes, assets, budget) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (budget.left <= 0) { return; }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) { await walk(full, notes, assets, budget); }
      continue;
    }
    if (!entry.isFile()) { continue; }
    const ext = path.extname(entry.name).toLowerCase();
    if (MARKDOWN_EXTS.includes(ext)) { notes.push(full); budget.left--; }
    else if (ASSET_EXTS.has(ext)) { assets.push(full); budget.left--; }
  }
}

async function scanVault() {
  roots = currentRoots();
  const notes = [];
  const assets = [];
  const budget = { left: SCAN_LIMIT };
  for (const root of roots) { await walk(root, notes, assets, budget); }
  vault = VaultIndex.fromPaths(notes, assets);
  meta.invalidate();
  return vault;
}

function readText(fsPath) {
  try {
    return fs.readFileSync(fsPath, 'utf8');
  } catch {
    return null;
  }
}

function statFile(fsPath) {
  try {
    const stat = fs.statSync(fsPath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

const meta = new MetaIndex({ readText, stat: statFile });

// 嵌入与链接需要知道“当前正在预览哪个文件”，官方预览扩展点没有把它传给插件，
// 只能用活动编辑器近似；解析失败时会退回绝对路径。
function currentDocumentPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return null; }
  const fsPath = editor.document.uri.fsPath;
  return MARKDOWN_EXTS.includes(path.extname(fsPath).toLowerCase()) ? fsPath : null;
}

function rootFor(fsPath) {
  const hit = roots.filter((root) => fsPath.startsWith(root + path.sep))
    .sort((a, b) => b.length - a.length)[0];
  return hit || path.dirname(fsPath);
}

function rescan() {
  return scanVault().then(() => {
    watchRoots();
    vscode.commands.executeCommand('markdown.preview.refresh');
    return meta.ensure(vault.allNotes);
  }, () => {});
}

// 库根在工作区之外时，VS Code 的 watcher 会漏掉一部分删除事件，
// 补全前按存在性过一遍，免得列出已经删掉的笔记。全库 stat 约 7ms。
function pruneMissing() {
  const notes = vault.allNotes.filter((fsPath) => fs.existsSync(fsPath));
  const assets = vault.allAssets.filter((fsPath) => fs.existsSync(fsPath));
  if (notes.length === vault.allNotes.length && assets.length === vault.allAssets.length) { return; }
  vault = VaultIndex.fromPaths(notes, assets);
  meta.invalidate();
}

const watchers = new Map();
let pathTimer = null;
let metaTimer = null;

// 增删文件会改变可链接的目标列表，要重扫路径；改内容只影响标题/标签索引。
function schedulePaths() {
  if (pathTimer) { clearTimeout(pathTimer); }
  pathTimer = setTimeout(() => { pathTimer = null; rescan(); }, 1500);
}

function scheduleMeta() {
  if (metaTimer) { clearTimeout(metaTimer); }
  metaTimer = setTimeout(() => {
    metaTimer = null;
    meta.invalidate();
    meta.ensure(vault.allNotes);
  }, 800);
}

function watchRoots() {
  for (const root of roots) {
    if (watchers.has(root)) { continue; }
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, WATCH_GLOB));
    watcher.onDidCreate(schedulePaths);
    watcher.onDidDelete(schedulePaths);
    watcher.onDidChange(scheduleMeta);
    watchers.set(root, watcher);
  }
}

function watchVault(context) {
  context.subscriptions.push({ dispose: () => { for (const w of watchers.values()) { w.dispose(); } } });
  // 打开了另一个库里的笔记时，库根会变，要补扫并补上监听。
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor || editor.document.uri.scheme !== 'file') { return; }
    if (!MARKDOWN_EXTS.includes(path.extname(editor.document.uri.fsPath).toLowerCase())) { return; }
    if (!currentRoots().every((root) => watchers.has(root))) { rescan(); }
  }));
}

const COMPLETION_KINDS = {
  file: vscode.CompletionItemKind.File,
  reference: vscode.CompletionItemKind.Reference,
  value: vscode.CompletionItemKind.Value
};

function registerCompletion(context) {
  const provider = {
    async provideCompletionItems(document, position) {
      const text = document.getText();
      const ctx = completionContext(text, document.offsetAt(position));
      if (!ctx) { return null; }

      if (ctx.kind !== 'tag') { pruneMissing(); }
      await meta.ensure(vault.allNotes);
      const range = new vscode.Range(document.positionAt(ctx.start), document.positionAt(ctx.end));
      const entries = completionItems(ctx, {
        meta, vault, root: rootFor(document.uri.fsPath),
        currentPath: document.uri.fsPath, currentText: text
      });

      return entries.map((entry) => {
        const item = new vscode.CompletionItem(entry.label, COMPLETION_KINDS[entry.kind]);
        item.range = range;
        item.insertText = entry.insertText + (ctx.appendClosing ? ']]' : '');
        item.filterText = entry.filterText;
        item.sortText = entry.sortText;
        item.detail = entry.detail;
        return item;
      });
    }
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider({ language: 'markdown' }, provider, '[', '#')
  );
}

function activate(context) {
  const ctx = {
    resolveNote: (name, from) => vault.resolveNote(name, from),
    resolveAsset: (name, from) => vault.resolveAsset(name, from),
    readText,
    currentDocument: currentDocumentPath,
    toUri: (fsPath) => vscode.Uri.file(fsPath).toString()
  };

  rescan();
  watchVault(context);
  registerCompletion(context);

  return {
    // 宿主取 extendMarkdownIt 的返回值时不 await，异步会让整个预览引擎构造失败。
    extendMarkdownIt(md) {
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
  };
}

module.exports = { activate };
