'use strict';

const assert = require('assert');
const MarkdownIt = require('markdown-it');
const obsidianCallout = require('../src/callout');
const obsidianTaskList = require('../src/tasklist');
const obsidianBlockId = require('../src/blockid');

const md = new MarkdownIt({ html: true })
  .use(obsidianCallout).use(obsidianTaskList).use(obsidianBlockId);

const cases = [
  ['这是一个可复用的块。 ^block-id', (out) => {
    assert.ok(!out.includes('^block-id'), out);
    assert.match(out, /<p>这是一个可复用的块。<span class="obsidian-block-anchor" id="block-id"><\/span><\/p>/);
  }],
  ['> 引用块\n\n^quote-id', (out) => {
    assert.ok(!out.includes('^quote-id'), out);
    assert.match(out, /<div class="obsidian-block-anchor" id="quote-id"><\/div>/);
    assert.ok(!/<p>\s*<div/.test(out), '独占一行的块 ID 不该留下空段落');
  }],
  ['- 列表项 ^item-id', (out) => {
    assert.ok(!out.includes('^item-id'), out);
    assert.match(out, /id="item-id"/);
    assert.match(out, /<li>列表项/);
  }],
  ['- [ ] 任务 ^task-id', (out) => {
    assert.match(out, /data-task=" "/);
    assert.match(out, /id="task-id"/);
    assert.ok(!out.includes('^task-id'), out);
  }],
  ['## 标题 ^head-id', (out) => {
    assert.match(out, /<h2>标题<span class="obsidian-block-anchor" id="head-id"><\/span><\/h2>/);
  }],
  ['正文里的 ^not-end 后面还有字', (out) => {
    assert.match(out, /\^not-end/, '不在行尾的 ^id 不是块 ID');
    assert.ok(!out.includes('obsidian-block-anchor'), out);
  }],
  ['^id 开头但不是独占一行', (out) => {
    assert.match(out, /\^id/);
    assert.ok(!out.includes('obsidian-block-anchor'), out);
  }],
  ['代码里的 `^code-id` 不动', (out) => {
    assert.match(out, /<code>\^code-id<\/code>/);
    assert.ok(!out.includes('obsidian-block-anchor'), out);
  }],
  ['第一行  \n第二行 ^tail-id', (out) => {
    assert.match(out, /id="tail-id"/);
    assert.ok(!out.includes('^tail-id'), out);
  }],
  ['甲 ^one\n\n乙 ^two', (out) => {
    assert.match(out, /id="one"/);
    assert.match(out, /id="two"/);
    assert.ok(!out.includes('^one') && !out.includes('^two'), out);
  }],
  ['^only-id', (out) => {
    assert.match(out, /<div class="obsidian-block-anchor" id="only-id"><\/div>/);
    assert.ok(!out.includes('^only-id'), out);
  }],
  ['没有块 ID 的普通段落', (out) => {
    assert.strictEqual(out.trim(), '<p>没有块 ID 的普通段落</p>');
  }],
  ['带连字符与数字 ^a-b-123', (out) => {
    assert.match(out, /id="a-b-123"/);
  }],
  ['中文块 ID 不识别 ^中文', (out) => {
    assert.match(out, /\^中文/, 'Obsidian 块 ID 只允许字母数字和连字符');
  }],
  ['> 引用\n^issue-01', (out) => {
    assert.ok(!out.includes('^issue-01'), out);
    assert.match(out, /<blockquote>\s*<p>引用<span class="obsidian-block-anchor" id="issue-01"><\/span><\/p>\s*<\/blockquote>/);
  }],
  ['普通段\n^issue-01', (out) => {
    assert.ok(!out.includes('^issue-01'), out);
    assert.match(out, /<p>普通段<span class="obsidian-block-anchor" id="issue-01"><\/span><\/p>/);
  }]
];

let failed = 0;
for (const [src, check] of cases) {
  const out = md.render(src).trimEnd();
  try {
    check(out);
    console.log('PASS  ' + JSON.stringify(src));
  } catch (err) {
    failed++;
    console.log('FAIL  ' + JSON.stringify(src) + '\n' + err.message + '\n' + out);
  }
}

console.log(failed === 0 ? `\n${cases.length} cases ok` : `\n${failed} case(s) failed`);
process.exit(failed === 0 ? 0 : 1);