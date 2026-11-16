'use strict';

const assert = require('assert');
const MarkdownIt = require('markdown-it');
const obsidianComment = require('../src/comment');

const md = new MarkdownIt({ html: true }).use(obsidianComment);

const cases = [
  ['行内 %%隐藏%% 文字', '<p>行内 文字</p>'],
  ['%%整段注释%%', ''],
  ['%%\n多行注释\n第二行\n%%', ''],
  ['第一段\n\n%%\n多行\n%%\n\n第二段', '<p>第一段</p>\n<p>第二段</p>'],
  ['保留 %% 单个百分号', '<p>保留 %% 单个百分号</p>'],
  ['文字%%未闭合', '<p>文字%%未闭合</p>'],
  ['`代码里的 %% 不算注释 %%`', '<p><code>代码里的 %% 不算注释 %%</code></p>'],
  ['> 引用 %%注释%% 正文', '<blockquote>\n<p>引用 正文</p>\n</blockquote>'],
  ['- 列表 %%注释%% 项', '<ul>\n<li>列表 项</li>\n</ul>']
];

let failed = 0;

for (const [src, expected] of cases) {
  const actual = md.render(src).trimEnd();
  const ok = actual === expected;
  if (!ok) { failed++; }
  console.log(`${ok ? 'PASS' : 'FAIL'}  in:  ${JSON.stringify(src)}`);
  console.log(`      out: ${JSON.stringify(actual)}`);
}

// 围栏代码原样保留
const fenced = md.render('```\n%% 围栏里的原样 %%\n```');
assert.ok(fenced.includes('%% 围栏里的原样 %%'), fenced);

// 注释与高亮、链接混排时不互相影响
assert.strictEqual(md.render('前 %%藏%% 后').trim(), '<p>前 后</p>');

// 块注释跨到表格：整张表隐藏
assert.strictEqual(md.render('前\n\n%%\n| 列 |\n| --- |\n| 值 |\n\n%%\n\n后').trim(),
  '<p>前</p>\n<p>后</p>');
// 未闭合的 %% 行按普通文本保留
assert.ok(md.render('%%\n没有闭合').includes('没有闭合'));

console.log(failed === 0 ? '\nall cases ok' : `\n${failed} case(s) failed`);
process.exit(failed === 0 ? 0 : 1);
