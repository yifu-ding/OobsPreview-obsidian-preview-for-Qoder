'use strict';

const assert = require('assert');
const MarkdownIt = require('markdown-it');
const obsidianFootnote = require('markdown-it-footnote');
const obsidianHighlight = require('../src/highlight');
const obsidianTag = require('../src/tag');
const obsidianCallout = require('../src/callout');
const obsidianTaskList = require('../src/tasklist');
const obsidianWikilink = require('../src/wikilink');

const ctx = {
  resolveNote: (name) => (name === '笔记' ? '/vault/Notes/笔记.md' : null),
  resolveAsset: () => null,
  readText: () => null,
  currentDocument: () => null,
  toUri: (p) => 'file://' + p
};

const md = new MarkdownIt({ html: true })
  .use(obsidianFootnote)
  .use(obsidianHighlight)
  .use(obsidianTag)
  .use(obsidianCallout)
  .use(obsidianTaskList)
  .use(obsidianWikilink, ctx);

const html = md.render('正文[^1]和内联^[说明]。\n\n[^1]: 脚注里有 [[笔记]] 与 ==高亮==。\n');

assert.ok(html.includes('<sup class="footnote-ref"><a href="#fn1"'), html);
assert.ok(html.includes('<section class="footnotes">'), html);
assert.ok(html.includes('class="internal-link"'), html);
assert.ok(html.includes('<mark>高亮</mark>'), html);
// 行内脚注与编号脚注各占一个序号
assert.ok(html.includes('#fn2'), html);

const mixed = md.render('> [!note] 带脚注[^a]的提示\n> 正文\n\n[^a]: 注释\n');
assert.ok(mixed.includes('class="callout"'), mixed);
assert.ok(mixed.includes('footnote-ref'), mixed);

const task = md.render('- [ ] 任务[^t]\n\n[^t]: 任务脚注\n');
assert.ok(task.includes('task-list-item'), task);
assert.ok(task.includes('footnote-ref'), task);

// `[[链接]]` 不能被脚注规则吃掉
assert.ok(md.render('[[笔记]]').includes('internal-link'));

console.log('footnote cases ok');
