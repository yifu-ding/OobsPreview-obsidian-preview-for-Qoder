#!/usr/bin/env node
// 离线渲染审计：把真实笔记跑一遍扩展的 markdown-it 管线，
// 统计哪些 Obsidian 语法在预览 HTML 里仍以源码形式出现。
//
// 用法：node tools/audit-render.mjs [根目录] [相对路径...]
//      不给路径时扫描根目录前 200 篇笔记
'use strict';

const fs = require('fs');
const path = require('path');
const { createHostMarkdown } = require('./host-md');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..', '..'));
const explicit = process.argv.slice(3);

const { VaultIndex, IMAGE_EXT, OTHER_ASSET_EXT } = require('../src/vault');

const SKIP = new Set(['node_modules', '.git', '.obsidian', '.wolf', '.qoder', '.qoder-cn', '.claude', '.codex', '.trae', '.cursor', '.vscode', 'dist', 'out', 'build', '__pycache__', '.venv', 'venv', '.cache']);
const MD_EXT = new Set(['.md', '.markdown']);

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) { walk(full, out); }
    } else if (MD_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

const all = explicit.length ? explicit.map((p) => path.resolve(root, p)) : walk(root, []);
const notes = [];
for (const file of walk(root, [])) { notes.push(file); }
function walkAssets(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) { walkAssets(full, out); }
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXT.has(ext) || OTHER_ASSET_EXT.has(ext)) { out.push(full); }
    }
  }
  return out;
}
const vault = VaultIndex.fromPaths(notes, walkAssets(root, []));

const ctx = {
  resolveNote: (name, from) => vault.resolveNote(name, from),
  resolveAsset: (name, from) => vault.resolveAsset(name, from),
  readText: (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } },
  currentDocument: () => null,
  toUri: (p) => 'file://' + p
};

const md = createHostMarkdown(ctx);

// 每种语法的“源码指纹”：源文件里出现，且渲染后的 HTML 文本节点里仍原样出现即算未转换
const PROBES = [
  ['callout', /^>[ \t]*\[[!][^\]]+\]/m],
  ['wikilink', /\[\[[^\]\n]+\]\]/],
  ['embed', /!\[\[[^\]\n]+\]\]/],
  ['任务标记', /^[ \t]*[-*][ \t]\[[ xX\/\-><?!*"lbipcfkuwMdDPM-][ \t(]/m],
  ['高亮', /==[^=\n]+==/],
  ['注释', /%%[^%]*%%/],
  ['行内标签', /(?:^|[ \t])#[A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5\/-]*/m],
  ['脚注引用', /\[\^[^\]\n]+\]/],
  ['行内脚注', /\^\[[^\]\n]+\]/],
  ['块 ID', /(?:^|[ \t])\^[A-Za-z0-9-]+[ \t]*$/m],
  ['frontmatter', /^---[ \t]*\r?\n(?:[^\r\n]*\r?\n)*?---[ \t]*\r?\n/m]
];

const textOf = (html) => html
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, ' ')
  .replace(/<code[^>]*>[\s\S]*?<\/code>/gi, ' ')
  // 已转成胶囊的标签，文本里本来还留着 #xxx，不算“仍是源码”
  .replace(/<a class="tag">[^<]*<\/a>/gi, ' ')
  .replace(/<[^>]+>/g, ' ');

let files = 0;
const totals = new Map(PROBES.map(([name]) => [name, { src: 0, leaked: 0, files: new Set() }]));
const samples = [];

const scanLimit = Number(process.env.AUDIT_LIMIT || (explicit.length ? 500 : 200));
for (const file of (all.length ? all : notes).slice(0, scanLimit)) {
  const src = fs.readFileSync(file, 'utf8');
  let html;
  try {
    html = md.render(src, { currentDocument: { fsPath: file } });
  } catch (err) {
    samples.push({ file: path.relative(root, file), probe: 'RENDER-ERROR', detail: String(err.message).slice(0, 120) });
    continue;
  }
  files++;
  const text = textOf(html);
  for (const [name, re] of PROBES) {
    const inSrc = src.match(new RegExp(re.source, re.flags.includes('m') ? re.flags : re.flags + 'm'));
    if (!inSrc) { continue; }
    const bucket = totals.get(name);
    bucket.src++;
    const inOut = text.match(new RegExp(re.source, re.flags.includes('m') ? re.flags : re.flags + 'm'));
    if (inOut) {
      bucket.leaked++;
      bucket.files.add(path.relative(root, file));
      if (samples.length < 25) {
        samples.push({ file: path.relative(root, file), probe: name, detail: (inOut[0] || '').trim().slice(0, 90) });
      }
    }
  }
}

console.log(`扫描 ${files} 篇笔记（根目录 ${root}）\n`);
for (const [name, bucket] of totals) {
  if (!bucket.src) { continue; }
  console.log(`${name.padEnd(14)} 出现 ${String(bucket.src).padStart(4)} 篇 · 仍以源码出现 ${String(bucket.leaked).padStart(4)} 篇`);
}
console.log('\n样例：');
for (const s of samples) { console.log(`  [${s.probe}] ${s.file} :: ${s.detail}`); }
