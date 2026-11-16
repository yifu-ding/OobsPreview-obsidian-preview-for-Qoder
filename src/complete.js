'use strict';

const path = require('path');
const yaml = require('js-yaml');
const { isTagChar } = require('./tag');
const { baseKey } = require('./vault');

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function countBackticks(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) { if (text[i] === '`') { n++; } }
  return n;
}

function inFencedCode(head) {
  let fence = null;
  for (const line of head.split('\n')) {
    const m = FENCE_RE.exec(line);
    if (!m) { continue; }
    const marker = m[1][0];
    if (!fence) { fence = marker; } else if (fence === marker) { fence = null; }
  }
  return fence !== null;
}

// 光标右侧若已有 `]]`（编辑器自动补的或本来就在链接里），替换到它前面为止，不再补右括号。
function closingBracket(text, offset, lineEnd) {
  const m = /^([^[\]]*)\]\]/.exec(text.slice(offset, lineEnd));
  return m ? { end: offset + m[1].length, found: true } : { end: offset, found: false };
}

/**
 * 判定光标处的补全上下文。纯函数，便于离线测试。
 * 返回 { kind: 'note'|'embed'|'heading'|'tag', query, start, end, appendClosing, noteName? }
 */
function completionContext(text, offset) {
  if (typeof text !== 'string' || offset < 0 || offset > text.length) { return null; }

  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const newline = text.indexOf('\n', offset);
  const lineEnd = newline === -1 ? text.length : newline;
  if (inFencedCode(text.slice(0, lineStart))) { return null; }

  const before = text.slice(lineStart, offset);
  const open = before.lastIndexOf('[[');
  if (open !== -1) {
    const inner = before.slice(open + 2);
    if (inner.includes(']]') || inner.includes('[')) { return null; }
    if (countBackticks(before.slice(0, open)) % 2 === 1) { return null; }

    const close = closingBracket(text, offset, lineEnd);
    const embed = open > 0 && before[open - 1] === '!';
    const hash = inner.indexOf('#');

    if (hash === -1) {
      if (inner.includes('|')) { return null; }
      return {
        kind: embed ? 'embed' : 'note',
        query: inner,
        noteName: null,
        start: lineStart + open + 2,
        end: close.end,
        appendClosing: !close.found
      };
    }

    const noteName = inner.slice(0, hash);
    const query = inner.slice(hash + 1);
    if (noteName.includes('|') || query.includes('|') || query.includes('#')) { return null; }
    return {
      kind: 'heading',
      query,
      noteName,
      start: lineStart + open + 2 + hash + 1,
      end: close.end,
      appendClosing: !close.found
    };
  }

  let start = offset;
  while (start > lineStart && isTagChar(text.charCodeAt(start - 1))) { start--; }
  if (start === lineStart || text[start - 1] !== '#') { return null; }

  const hash = start - 1;
  const prev = hash > lineStart ? text[hash - 1] : ' ';
  if (!/\s/.test(prev)) { return null; }
  if (countBackticks(text.slice(lineStart, hash)) % 2 === 1) { return null; }

  // 行首 1–6 个 `#` 后面已经跟了空格才是 Markdown 标题；只打了 `#` 还没打空格时
  // 仍按标签处理，否则「输入 # 补全标签」在行首永远触发不了。
  if (/^ {0,3}$/.test(text.slice(lineStart, hash))) {
    let runEnd = hash;
    while (runEnd < lineEnd && text[runEnd] === '#') { runEnd++; }
    const after = runEnd < lineEnd ? text[runEnd] : null;
    if (runEnd - hash <= 6 && (after === ' ' || after === '\t')) { return null; }
  }

  return { kind: 'tag', query: text.slice(start, offset), noteName: null, start, end: offset, appendClosing: false };
}

function frontMatter(text) {
  const m = FRONT_MATTER_RE.exec(text);
  if (!m) { return { data: null, body: text }; }
  let data = null;
  try { data = yaml.load(m[1]); } catch { data = null; }
  return { data: data && typeof data === 'object' ? data : null, body: text.slice(m[0].length) };
}

function asList(value) {
  if (Array.isArray(value)) { return value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim()); }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,\s]+/).filter(Boolean);
  }
  return [];
}

function collectInlineTags(body, counts) {
  let inFence = false;
  for (const raw of body.split('\n')) {
    if (FENCE_RE.test(raw)) { inFence = !inFence; continue; }
    if (inFence) { continue; }
    const line = raw.replace(/`[^`]*`/g, '');
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== '#') { continue; }
      if (i > 0 && !/\s/.test(line[i - 1])) { continue; }
      let j = i + 1;
      while (j < line.length && isTagChar(line.charCodeAt(j))) { j++; }
      while (j > i + 1 && /[-/]/.test(line[j - 1])) { j--; }
      const tag = line.slice(i + 1, j);
      if (!tag || /^[\d_]+$/.test(tag)) { continue; }
      counts.set(tag, (counts.get(tag) || 0) + 1);
      i = j - 1;
    }
  }
}

/** 单篇笔记的标题、标签与别名。标题保留原文，供 `[[#…]]` 直接插入。 */
function parseNote(text) {
  const { data, body } = frontMatter(text);
  const headings = [];
  const tags = new Map();
  let inFence = false;
  let lineNo = 0;

  for (const raw of body.split('\n')) {
    lineNo++;
    if (FENCE_RE.test(raw)) { inFence = !inFence; continue; }
    if (inFence) { continue; }
    const m = HEADING_RE.exec(raw);
    if (m) { headings.push({ text: m[2].trim(), level: m[1].length, line: lineNo }); }
  }

  collectInlineTags(body, tags);
  for (const tag of asList(data && data.tags)) {
    const clean = tag.replace(/^#/, '');
    if (clean) { tags.set(clean, (tags.get(clean) || 0) + 1); }
  }

  const aliases = data ? asList(data.aliases).concat(asList(data.alias)) : [];
  return { headings, tags, aliases: [...new Set(aliases)] };
}

/**
 * 全库标题/标签/别名索引。按 mtime+size 缓存，文件没变就只 stat 不重读；
 * 分片让出事件循环，避免首次建索引时卡住扩展宿主。
 */
class MetaIndex {
  constructor({ readText, stat, chunkSize = 64 }) {
    this.readText = readText;
    this.stat = stat;
    this.chunkSize = chunkSize;
    this.files = new Map();
    this.tagCounts = new Map();
    this.dirty = true;
    this._pending = null;
    this._generation = 0;
  }

  invalidate() { this.dirty = true; this._generation++; }

  headingsFor(fsPath) {
    const entry = this.files.get(fsPath);
    return entry ? entry.headings : [];
  }

  async ensure(notePaths) {
    if (!this.dirty) { return; }
    if (!this._pending) {
      this._pending = this._build(notePaths).finally(() => { this._pending = null; });
    }
    await this._pending;
  }

  async _build(notePaths) {
    const generation = this._generation;
    const files = new Map();
    const tagCounts = new Map();
    let sinceYield = 0;

    for (const fsPath of notePaths) {
      const stat = this.stat(fsPath);
      if (!stat) { continue; }
      const key = stat.mtimeMs + ':' + stat.size;
      let entry = this.files.get(fsPath);
      if (!entry || entry.key !== key) {
        const text = this.readText(fsPath);
        if (text === null) { continue; }
        entry = Object.assign({ key }, parseNote(text));
      }
      files.set(fsPath, entry);
      for (const [tag, n] of entry.tags) { tagCounts.set(tag, (tagCounts.get(tag) || 0) + n); }

      if (++sinceYield >= this.chunkSize) {
        sinceYield = 0;
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    this.files = files;
    this.tagCounts = tagCounts;
    // 建索引期间又有文件改动的话保持 dirty，下次请求再建一遍。
    if (this._generation === generation) { this.dirty = false; }
  }
}

function posixRelative(from, target) {
  return path.relative(from, target).split(path.sep).join('/');
}

function noteTarget(fsPath, root, duplicated) {
  const name = path.basename(fsPath, path.extname(fsPath));
  if (!duplicated) { return name; }
  const rel = posixRelative(root, fsPath);
  return rel.replace(/\.md$/i, '');
}

function pad(n) { return String(n).padStart(6, '0'); }

/**
 * 生成补全项描述（不含任何 vscode 类型），由宿主适配层转成 CompletionItem。
 * kind: 'file' | 'reference' | 'value'
 */
function completionItems(ctx, { meta, vault, root, currentPath, currentText }) {
  if (ctx.kind === 'tag') { return tagItems(meta, currentPath, currentText); }
  if (ctx.kind === 'heading') { return headingItems(ctx, { meta, vault, currentPath, currentText }); }
  return noteItems(ctx, { meta, vault, root, currentPath });
}

function tagItems(meta, currentPath, currentText) {
  const counts = new Map(meta.tagCounts);
  // 当前笔记用未保存的正文重新计数，先扣掉索引里那份磁盘版本，避免重复。
  const onDisk = currentPath ? meta.files.get(currentPath) : null;
  if (onDisk) {
    for (const [tag, n] of onDisk.tags) {
      const left = (counts.get(tag) || 0) - n;
      if (left > 0) { counts.set(tag, left); } else { counts.delete(tag); }
    }
  }
  if (currentText) {
    for (const [tag, n] of parseNote(currentText).tags) { counts.set(tag, (counts.get(tag) || 0) + n); }
  }
  const items = [];
  for (const [tag, count] of counts) {
    items.push({
      label: tag,
      insertText: tag,
      filterText: tag,
      detail: count + ' 处引用',
      kind: 'value',
      sortText: pad(Math.max(0, 999999 - count)) + tag.toLowerCase()
    });
  }
  return items.sort((a, b) => (a.sortText < b.sortText ? -1 : 1));
}

function headingItems(ctx, { meta, vault, currentPath, currentText }) {
  let headings;
  let where;
  if (!ctx.noteName) {
    headings = parseNote(currentText || '').headings;
    where = '当前笔记';
  } else {
    const target = vault.resolveNote(ctx.noteName, currentPath);
    if (!target) { return []; }
    headings = meta.headingsFor(target);
    where = path.basename(target, path.extname(target));
  }
  return headings.map((h, i) => ({
    label: h.text,
    insertText: h.text,
    filterText: h.text,
    detail: 'H' + h.level + ' · ' + where,
    kind: 'reference',
    sortText: pad(i)
  }));
}

function noteItems(ctx, { meta, vault, root, currentPath }) {
  const paths = ctx.kind === 'embed' ? vault.allNotes.concat(vault.allAssets) : vault.allNotes;
  const currentDir = currentPath ? path.dirname(currentPath) : '';
  const seen = new Map();
  for (const p of vault.allNotes) {
    const key = baseKey(p);
    seen.set(key, (seen.get(key) || 0) + 1);
  }

  const items = [];
  const exact = new Set();
  for (const fsPath of paths) {
    const ext = path.extname(fsPath);
    const isNote = meta.files.has(fsPath);
    const label = isNote ? path.basename(fsPath, ext) : path.basename(fsPath);
    const duplicated = isNote && seen.get(baseKey(fsPath)) > 1;
    const target = isNote ? noteTarget(fsPath, root, duplicated) : path.basename(fsPath);
    const rel = posixRelative(root, fsPath);
    const sameDir = currentDir && path.dirname(fsPath) === currentDir;

    exact.add(label.toLowerCase());
    items.push({
      label,
      insertText: target,
      filterText: label + ' ' + rel,
      detail: rel,
      kind: 'file',
      sortText: pad(sameDir ? 0 : 1) + pad(rel.length) + label.toLowerCase()
    });

    if (isNote && ctx.kind === 'note') {
      for (const alias of meta.files.get(fsPath).aliases) {
        items.push({
          label: alias,
          insertText: target + '|' + alias,
          filterText: alias + ' ' + label,
          detail: '别名 → ' + label,
          kind: 'reference',
          sortText: pad(sameDir ? 0 : 1) + pad(rel.length) + alias.toLowerCase()
        });
      }
    }
  }

  const query = ctx.query.trim();
  if (query && !exact.has(query.toLowerCase())) {
    items.push({
      label: query,
      insertText: ctx.kind === 'embed' ? query : query.replace(/\.md$/i, ''),
      filterText: query,
      detail: '新笔记（库中还没有）',
      kind: 'file',
      sortText: '!' + query.toLowerCase()
    });
  }
  return items;
}

module.exports = { completionContext, parseNote, MetaIndex, completionItems };