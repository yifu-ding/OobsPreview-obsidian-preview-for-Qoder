'use strict';

const assert = require('assert');
const MarkdownIt = require('markdown-it');
const obsidianTag = require('../src/tag');

const md = new MarkdownIt({ html: true }).use(obsidianTag);

const cases = [
  ['#tag', '<p><a class="tag">#tag</a></p>'],
  ['文字 #nested/path 结尾', '<p>文字 <a class="tag">#nested/path</a> 结尾</p>'],
  ['中文 #工作流 标签', '<p>中文 <a class="tag">#工作流</a> 标签</p>'],
  ['#1984', '<p>#1984</p>'],
  ['#1984book', '<p><a class="tag">#1984book</a></p>'],
  ['a#b 不是标签', '<p>a#b 不是标签</p>'],
  ['#tag-', '<p><a class="tag">#tag</a>-</p>'],
  ['#tag**加粗**', '<p><a class="tag">#tag</a><strong>加粗</strong></p>'],
  ['#tag，后面跟中文标点', '<p><a class="tag">#tag</a>，后面跟中文标点</p>'],
  ['# 标题不是标签', '<h1>标题不是标签</h1>'],
  ['`#tag` 在代码里', '<p><code>#tag</code> 在代码里</p>'],
  ['[链接](http://example.com#frag)', '<p><a href="http://example.com#frag">链接</a></p>']
];

let failed = 0;

for (const [src, expected] of cases) {
  const actual = md.render(src).trimEnd();
  const ok = actual === expected;
  if (!ok) { failed++; }
  console.log(`${ok ? 'PASS' : 'FAIL'}  in:  ${JSON.stringify(src)}`);
  console.log(`      out: ${actual}`);
}

// 标签前后缀不吞掉相邻 token
assert.ok(md.render('- [ ] 任务 #todo').includes('<a class="tag">#todo</a>'));
assert.ok(md.render('| 列 |\n| --- |\n| #tag |').includes('<a class="tag">#tag</a>'));

console.log(failed === 0 ? '\nall cases ok' : `\n${failed} case(s) failed`);
process.exit(failed === 0 ? 0 : 1);
