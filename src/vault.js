'use strict';

const path = require('path');

const MD_EXT = new Set(['.md']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico']);

const OTHER_ASSET_EXT = new Set([
  '.pdf', '.mp3', '.wav', '.m4a', '.flac', '.ogg', '.opus', '.mp4', '.webm', '.mov', '.ogv', '.3gp',
  '.pptx', '.ppt', '.xlsx', '.xls', '.csv', '.docx', '.doc', '.base', '.zip', '.txt', '.json'
]);

function baseKey(fsPath) {
  const ext = path.extname(fsPath).toLowerCase();
  return path.basename(fsPath, ext).toLowerCase();
}

/**
 * Vault-wide name index, mirroring how Obsidian resolves `[[Name]]`:
 * exact folder-qualified path first, then bare file name, preferring the
 * candidate nearest to the current file and the shortest path overall.
 */
class VaultIndex {
  constructor() {
    this.notes = new Map(); // baseKey -> string[]
    this.assets = new Map();
    this.allNotes = [];
    this.allAssets = [];
  }

  static fromPaths(mdPaths, assetPaths) {
    const index = new VaultIndex();
    for (const p of mdPaths) { index._add(index.notes, p); }
    for (const p of assetPaths) { index._add(index.assets, p); }
    index.allNotes = mdPaths.slice();
    index.allAssets = assetPaths.slice();
    return index;
  }

  _add(map, fsPath) {
    const key = baseKey(fsPath);
    if (!key) { return; }
    const list = map.get(key);
    if (list) { list.push(fsPath); } else { map.set(key, [fsPath]); }
  }

  _lookup(map, all, name, fromPath, qualified) {
    const wanted = name.toLowerCase().replace(/\\/g, '/').replace(/^\.?\//, '');
    if (!wanted) { return null; }

    if (qualified) {
      const suffix = '/' + wanted;
      const hits = all.filter((p) => p.toLowerCase().endsWith(suffix));
      if (hits.length) { return pick(hits, fromPath); }
    }

    const key = wanted.includes('/') ? baseKey('/x/' + wanted) : wanted;
    const candidates = map.get(key);
    return candidates && candidates.length ? pick(candidates, fromPath) : null;
  }

  resolveNote(name, fromPath) {
    return this._lookup(this.notes, this.allNotes, stripExt(name, '.md'), fromPath, true);
  }

  resolveAsset(name, fromPath) {
    return this._lookup(this.assets, this.allAssets, name, fromPath, true);
  }
}

function stripExt(name, ext) {
  return name.toLowerCase().endsWith(ext) ? name.slice(0, -ext.length) : name;
}

function pick(candidates, fromPath) {
  if (candidates.length === 1) { return candidates[0]; }
  const fromDir = fromPath ? path.dirname(fromPath) : '';
  let best = null;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    let score = candidate.length;
    if (fromDir && path.dirname(candidate) === fromDir) { score -= 100000; }
    else if (fromDir && commonPrefixLen(path.dirname(candidate), fromDir) > 0) {
      score -= 1000 * commonPrefixLen(path.dirname(candidate), fromDir);
    }
    if (score < bestScore) { bestScore = score; best = candidate; }
  }
  return best;
}

function commonPrefixLen(a, b) {
  const partsA = a.split('/');
  const partsB = b.split('/');
  let i = 0;
  while (i < partsA.length && i < partsB.length && partsA[i] === partsB[i]) { i++; }
  return i;
}

/** `![[Note#Heading#Sub]]` / `![[Note#^block-id]]` */
function splitTarget(rawTarget) {
  const hash = rawTarget.indexOf('#');
  if (hash === -1) { return { name: rawTarget.trim(), anchor: null }; }
  return {
    name: rawTarget.slice(0, hash).trim(),
    anchor: rawTarget.slice(hash + 1).trim()
  };
}

function extractSection(markdown, anchor) {
  const lines = markdown.split('\n');
  const isBlock = anchor ? anchor.startsWith('^') : false;

  if (isBlock) {
    const id = anchor.slice(1).trim();
    return extractBlock(lines, id);
  }

  const headings = anchor ? anchor.split('#').filter(Boolean) : [];
  if (!headings.length) { return markdown; }
  return extractHeading(lines, headings[headings.length - 1]);
}

function extractHeading(lines, wanted) {
  const target = normalizeHeading(wanted);
  let startLevel = 0;
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (!m) { continue; }
    if (start === -1 && normalizeHeading(m[2]) === target) {
      start = i;
      startLevel = m[1].length;
    } else if (start !== -1 && m[1].length <= startLevel) {
      return lines.slice(start, i).join('\n');
    }
  }
  if (start !== -1) { return lines.slice(start).join('\n'); }

  // fallback: setext heading
  for (let i = 1; i < lines.length; i++) {
    const setext = /^=+$|^(-{3,})$/.exec(lines[i].trim());
    if (setext && normalizeHeading(lines[i - 1]) === target) {
      const level = setext[1] ? 1 : 2;
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const m = new RegExp(`^#{1,${level}}\\s+`).exec(lines[j]);
        if (m) { end = j; break; }
      }
      return lines.slice(i - 1, end).join('\n');
    }
  }
  return '';
}

function normalizeHeading(text) {
  return String(text).replace(/\[\[([^\]|#]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[*_`]/g, '')
    .trim()
    .toLowerCase();
}

function extractBlock(lines, id) {
  const marker = new RegExp(`\\s\\^${escapeRe(id)}$|^\\^${escapeRe(id)}$`);
  for (let i = 0; i < lines.length; i++) {
    if (!marker.test(lines[i].trim())) { continue; }

    if (lines[i].trim() !== '^' + id) { // id on the same line as the content
      let end = i;
      while (end + 1 < lines.length && lines[end + 1].trim() !== '') { end++; }
      return lines.slice(i, end + 1).map((l) => l.replace(marker, '')).join('\n');
    }

    let end = i - 1; // standalone id: take the block above it
    while (end >= 0 && lines[end].trim() === '') { end--; }
    let start = end;
    while (start - 1 >= 0 && lines[start - 1].trim() !== '') { start--; }
    return lines.slice(start, end + 1).join('\n');
  }
  return '';
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripFrontMatter(markdown) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return m ? markdown.slice(m[0].length) : markdown;
}

module.exports = {
  VaultIndex,
  MD_EXT,
  IMAGE_EXT,
  OTHER_ASSET_EXT,
  splitTarget,
  extractSection,
  stripFrontMatter,
  baseKey
};
