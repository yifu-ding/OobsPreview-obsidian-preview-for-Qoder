'use strict';

const assert = require('assert');
const MarkdownIt = require('markdown-it');
const obsidianCallout = require('../src/callout');
const obsidianTaskList = require('../src/tasklist');
const obsidianHighlight = require('../src/highlight');

const md = new MarkdownIt({ html: true }).use(obsidianHighlight).use(obsidianCallout).use(obsidianTaskList);

const cases = [
  ['- [ ] 待办\n- [x] 完成\n- [/] 进行中\n- [-] 取消', (out) => {
    assert.match(out, /<li class="task-list-item" data-task=" "><input type="checkbox" class="task-list-item-checkbox" data-task=" " disabled>待办<\/li>/);
    assert.match(out, /<li class="task-list-item" data-task="x"><input[^>]*checked[^>]*disabled>完成<\/li>/);
    assert.match(out, /data-task="\/"><input[^>]*disabled>进行中/);
    assert.match(out, /data-task="-"><input[^>]*disabled>取消/);
    assert.ok(!out.includes('[ ]'), '标记文本应被移除');
  }],
  ['- [X] 大写也算完成', (out) => {
    assert.match(out, /data-task="X"><input[^>]*checked/);
  }],
  ['- [!] [S] [k] [w] 各种标记', (out) => {
    assert.match(out, /data-task="!"/);
    assert.match(out, /\[S\] \[k\] \[w\] 各种标记/);
  }],
  ['- [ ] 带 **加粗** 和 ==高亮== 的任务', (out) => {
    assert.match(out, /<strong>加粗<\/strong>/);
    assert.match(out, /<mark>高亮<\/mark>/);
  }],
  ['1. [ ] 有序列表任务', (out) => {
    assert.match(out, /<ol>/);
    assert.match(out, /class="task-list-item"/);
  }],
  ['- [ ] 父任务\n  - [x] 子任务', (out) => {
    assert.match(out, /data-task=" "/);
    assert.match(out, /<li class="task-list-item" data-task="x"/);
  }],
  ['- [ ] 松散列表\n\n- [x] 第二段', (out) => {
    assert.match(out, /data-task=" "[^>]*>\s*<p>\s*<input[^>]*disabled>松散列表<\/p>/);
    assert.match(out, /data-task="x"[^>]*>\s*<p>\s*<input[^>]*checked/);
  }],
  ['普通列表不受影响\n- 项目 A', (out) => {
    assert.match(out, /<li>项目 A<\/li>/);
    assert.ok(!out.includes('task-list-item'));
  }],
  ['> [!todo] 任务\n> - [ ] callout 内的任务', (out) => {
    assert.match(out, /data-callout="todo"/);
    assert.match(out, /class="task-list-item" data-task=" "/);
  }],
  ['表格里 - [ ] 不算任务', (out) => {
    assert.ok(!out.includes('task-list-item'));
  }],
  ['- [l] 位置标记\n- [D] draft PR\n- [M] merged PR', (out) => {
    assert.match(out, /data-task="l"/);
    assert.match(out, /data-task="D"/);
    assert.match(out, /data-task="M"/);
  }]
];

let failed = 0;
for (const [src, check] of cases) {
  const out = md.render(src);
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
