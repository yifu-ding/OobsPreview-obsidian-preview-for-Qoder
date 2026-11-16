'use strict';
const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const fn = require('markdown-it-footnote');
const hl = require('../src/highlight');
const cm = require('../src/comment');
const tg = require('../src/tag');
const co = require('../src/callout');
const tl = require('../src/tasklist');
const pr = require('../src/properties');
const wl = require('../src/wikilink');
const { VaultIndex, IMAGE_EXT, OTHER_ASSET_EXT } = require('../src/vault');

const SKIP = new Set(['node_modules', '.git', '.obsidian', '.wolf', '.qoder', '.qoder-cn', '.claude', '.codex', '.trae', '.cursor', '.vscode', 'dist', 'out', 'build', '__pycache__', '.venv', 'venv', '.cache']);
const MD_EXT = new Set(['.md', '.markdown']);
const root = path.join(__dirname, '..', '..', '..', '..');

function walk(dir, out, assetOut) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) { walk(full, out, assetOut); }
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (MD_EXT.has(ext)) { out.push(full); }
      else if (IMAGE_EXT.has(ext) || OTHER_ASSET_EXT.has(ext)) { assetOut.push(full); }
    }
  }
  return out;
}

const notes = [];
const assets = [];
walk(root, notes, assets);
const vault = VaultIndex.fromPaths(notes, assets);
const ctx = {
  resolveNote: (n, f) => vault.resolveNote(n, f),
  resolveAsset: (n, f) => vault.resolveAsset(n, f),
  readText: (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } },
  currentDocument: () => null,
  toUri: (p) => 'file://' + p
};
const md = new MarkdownIt({ html: true }).use(fn).use(hl).use(cm).use(tg).use(co).use(tl).use(pr).use(wl, ctx);

const errors = [];
for (const file of notes) {
  const src = fs.readFileSync(file, 'utf8');
  try {
    md.render(src, { currentDocument: { fsPath: file } });
  } catch (err) {
    errors.push(path.relative(root, file) + ' :: ' + err.message + '\n    ' +
      String(err.stack).split('\n')[1]);
  }
}
console.log(`渲染异常 ${errors.length} / ${notes.length} 篇`);
for (const line of errors.slice(0, 15)) { console.log('  ' + line); }
