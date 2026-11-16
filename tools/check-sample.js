'use strict';

// 以 Obsidian-format.md 为验收清单，逐项核对渲染结果。
// 数学公式与 mermaid 由宿主内置扩展提供（markdown-math / markdown-mermaid），
// 这里只确认本插件不会破坏它们的源码。
// 用法：node tools/check-sample.js [样例文件路径]

const fs = require('fs');
const path = require('path');
const { createHostMarkdown } = require('./host-md');

const ROOT = path.join(__dirname, '..');
const SAMPLE = process.argv[2] ||
  path.join(__dirname, '..', '..', 'Obsidian-format.md');

const md = createHostMarkdown({
  resolveNote: (name) => '/vault/' + name + '.md',
  resolveAsset: (name) => '/vault/' + name,
  readText: () => null,
  currentDocument: () => SAMPLE,
  toUri: (p) => 'file://' + p
});

const src = fs.readFileSync(SAMPLE, 'utf8');
let out;
try {
  out = md.render(src, {});
} catch (err) {
  console.log('RENDER ERROR: ' + err.message);
  process.exit(1);
}
fs.writeFileSync(path.join(ROOT, 'tools/.sample-render.html'), out);

// 样例里有 `[[文件名#^block-id]]` 这种写在行内代码里的示范，泄漏检查要先把代码摘掉
const prose = out.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<code[\s\S]*?<\/code>/g, '');

// [说明, 正则, 期望命中, 在去掉代码后的正文里查]
const CHECKS = [
  ['==高亮== → <mark>', /<mark>/, true],
  ['行内脚注 ^[...] 不泄漏原文', /\^\[这是行内脚注内容/, false, true],
  ['脚注引用生成 footnote-ref', /class="footnote-ref"/, true],
  ['脚注定义 [^note]', /class="footnote-item"/, true],
  ['块 ID ^block-id 不泄漏', /\^block-id/, false, true],
  ['块 ID ^final-example 不泄漏', /\^final-example/, false, true],
  ['块 ID 生成锚点', /id="block-id"/, true],
  ['块引用链接指向锚点', /href="[^"]*#block-id"/, true],
  ['图片嵌入 ![[attachment.png]]', /<img[^>]+attachment\.png/, true],
  ['图片宽度 |300', /width="300"/, true],
  ['图片别名 alt', /alt="图片别名"/, true],
  ['obsidian:// 链接保留', /href="obsidian:\/\/open"/, true],
  ['<details> 折叠保留', /<details>/, true],
  ['<kbd> 保留', /<kbd>/, true],
  ['裸链接自动识别', /<a href="https:\/\/obsidian\.md">/, true],
  ['%%注释%% 不泄漏', /这是一段注释/, false, true],
  ['#标签 → <a class="tag">', /<a class="tag">/, true],
  ['Properties 属性表', /class="frontmatter-container"/, true],
  ['wikilink 别名', /带别名的内部链接/, true],
  ['callout 默认展开 +', /data-callout="todo"[^>]*open="open"/, true],
  ['callout 默认折叠 -', /<details class="callout is-collapsible" data-callout="example">/, true],
  ['行内公式源码未被破坏', /\$E = mc\^2\$/, true],
  ['mermaid 源码未被破坏', /flowchart TD/, true]
];

// 验收只覆盖样例里真实出现的任务标记；代码围栏里的语法示范不算
const sampleTasks = new Set();
let inFence = false;
for (const line of src.split('\n')) {
  if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
  if (inFence) { continue; }
  const m = /^(?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[([^\][\n])\](?:[ \t]|$)/.exec(line);
  if (m) { sampleTasks.add(m[1]); }
}
// Obsidian 的别名归一：important→tip、summary→abstract
const CALLOUT_TYPES = ['note', 'tip', 'warning', 'danger', 'info', 'todo', 'example', 'abstract'];

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&gt;/g, '>')
  .replace(/&lt;/g, '<').replace(/&amp;/g, '&');

let failed = 0;
for (const [label, re, want, inProse] of CHECKS) {
  const ok = re.test(inProse ? prose : out) === want;
  if (!ok) { failed++; }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

const tasks = new Set([...out.matchAll(/data-task="([^"]*)"/g)].map((m) => decode(m[1])));
const expectedTasks = [...sampleTasks];
const missingTasks = expectedTasks.filter((m) => !tasks.has(m));
console.log(`${missingTasks.length ? 'FAIL' : 'PASS'}  任务标记 ${expectedTasks.length - missingTasks.length}/${expectedTasks.length}` +
  (missingTasks.length ? ' 缺: ' + missingTasks.map((m) => JSON.stringify(m)).join(' ') : ''));
if (missingTasks.length) { failed++; }

const callouts = new Set([...out.matchAll(/data-callout="([^"]*)"/g)].map((m) => m[1]));
const missingCallouts = CALLOUT_TYPES.filter((t) => !callouts.has(t));
console.log(`${missingCallouts.length ? 'FAIL' : 'PASS'}  callout 类型 ${CALLOUT_TYPES.length - missingCallouts.length}/${CALLOUT_TYPES.length}` +
  (missingCallouts.length ? ' 缺: ' + missingCallouts.join(' ') : ''));
if (missingCallouts.length) { failed++; }

console.log(failed === 0 ? '\n样例全部通过' : `\n${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);