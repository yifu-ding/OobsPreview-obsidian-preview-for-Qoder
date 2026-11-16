'use strict';

const MarkdownIt = require('markdown-it');
const obsidianHighlight = require('../src/highlight');

const md = new MarkdownIt({ html: true }).use(obsidianHighlight);

const cases = [
  ['==高亮==', '<p><mark>高亮</mark></p>'],
  ['普通文字 ==加粗 **和斜体** 混用== 结尾', null],
  ['外层 ==A ==嵌套== B== 外', null],
  ['这是 **加粗**、==高亮==、~~删除线~~ 和 `代码`。', null],
  ['未闭合 ==高亮', '<p>未闭合 ==高亮</p>'],
  ['单个 = 号 = 不变', '<p>单个 = 号 = 不变</p>'],
  ['> 引用里的 ==高亮==', null],
  ['- 列表 ==高亮==', null],
  ['| 名称 | 说明 |\n| --- | --- |\n| `[[note]]` | ==内部链接== |', null]
];

let failed = 0;

for (const [src, expected] of cases) {
  const actual = md.render(src).trimEnd();
  const ok = expected === null ? actual.includes('<mark>') : actual === expected;
  if (!ok) { failed++; }
  console.log(`${ok ? 'PASS' : 'FAIL'}  in:  ${JSON.stringify(src)}`);
  console.log(`      out: ${actual}`);
}

console.log(failed === 0 ? '\nall cases ok' : `\n${failed} case(s) failed`);
process.exit(failed === 0 ? 0 : 1);
