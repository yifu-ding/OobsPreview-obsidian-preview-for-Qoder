'use strict';

const assert = require('assert');
const MarkdownIt = require('markdown-it');
const obsidianCallout = require('../src/callout');

const md = new MarkdownIt({ html: true }).use(obsidianCallout);

const VOID_TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'input', 'br', 'hr', 'img']);

function assertBalanced(html, label) {
  const stack = [];
  const re = /<(\/)?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/)?>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, closing, tag, selfClosing] = m;
    if (selfClosing || VOID_TAGS.has(tag)) { continue; }
    if (closing) {
      const top = stack.pop();
      assert.strictEqual(top, tag, `${label}: 期望 </${top}> 实际 </${tag}>\n${html}`);
    } else {
      stack.push(tag);
    }
  }
  assert.strictEqual(stack.length, 0, `${label}: 未闭合 ${stack.join(',')}\n${html}`);
}

const cases = [
  ['> [!note]\n> 简单提示块', (out) => {
    assert.match(out, /<div class="callout" data-callout="note">/);
    assert.match(out, /callout-title-inner">Note</);
    assert.match(out, /<p>简单提示块<\/p>/);
  }],
  ['> [!info] 自定义标题\n> 正文', (out) => {
    assert.match(out, /data-callout="info"/);
    assert.match(out, /callout-title-inner">自定义标题</);
  }],
  ['> [!warning]- 默认折叠\n> 折叠内容', (out) => {
    assert.match(out, /<details class="callout is-collapsible" data-callout="warning">/);
    assert.ok(!/\bopen\b/.test(out), '默认折叠不应带 open');
    assert.match(out, /<summary class="callout-title">/);
    assert.match(out, /<div class="callout-content">/);
  }],
  ['> [!tip]+ 默认展开\n> 内容', (out) => {
    assert.match(out, /<details class="callout is-collapsible" data-callout="tip" open="open">/);
  }],
  ['> [!caution] 别名\n> 正文', (out) => {
    assert.match(out, /data-callout="warning"/);
  }],
  ['> [!question]\n> - [ ] 子任务\n>\n> ```python\n> print(1)\n> ```', (out) => {
    assert.match(out, /data-callout="question"/);
    assert.match(out, /<ul>/);
    assert.match(out, /class="language-python"/);
  }],
  ['> [!note] 外层\n> > [!warning] 内层\n> > 嵌套', (out) => {
    assert.strictEqual((out.match(/class="callout"/g) || []).length, 2);
  }],
  ['> 普通引用不是 callout', (out) => {
    assert.match(out, /^<blockquote>/);
  }],
  ['> [!not a callout]\n> 不匹配', (out) => {
    assert.match(out, /^<blockquote>/);
  }],
  ['> [!summary]\n> 标题 ==高亮== 与 **加粗**', (out) => {
    assert.match(out, /data-callout="abstract"/);
    assert.match(out, /callout-title-inner">Summary</);
  }],
  ['> [!qoder] 自定义类型\n> 正文', (out) => {
    assert.match(out, /data-callout="qoder"/);
    assert.match(out, /callout-title-inner">自定义类型</);
    assert.match(out, /<svg/, '未知类型也要有默认图标');
  }],
  ['> [!codex\\|2026-11-12 15:44] 表格里转义的标题分隔符', (out) => {
    assert.match(out, /data-callout="codex"/);
    assert.match(out, /data-callout-metadata="2026-11-12 15:44"/);
    assert.match(out, /callout-title-inner">表格里转义的标题分隔符</);
  }],
  ['> [!qwen|2026-11-12 15:44] 进展\n> 今天的矩阵已验收', (out) => {
    assert.match(out, /<div class="callout-content"><p>今天的矩阵已验收<\/p>\s*<\/div>/);
  }],
  ['> [!note] 非折叠也要有正文包裹层\n> 正文', (out) => {
    assert.match(out, /<div class="callout-content"><p>正文<\/p>\s*<\/div>/);
  }],
  ['> [!NOTE] 大写类型', (out) => {
    assert.match(out, /data-callout="note"/);
  }],
  ['> [!check] 别名', (out) => {
    assert.match(out, /data-callout="success"/);
  }]
];

let failed = 0;
for (const [src, check] of cases) {
  const out = md.render(src);
  try {
    assertBalanced(out, JSON.stringify(src));
    check(out);
    console.log('PASS  ' + JSON.stringify(src));
  } catch (err) {
    failed++;
    console.log('FAIL  ' + JSON.stringify(src) + '\n' + err.message + '\n' + out);
  }
}

console.log(failed === 0 ? `\n${cases.length} cases ok` : `\n${failed} case(s) failed`);
process.exit(failed === 0 ? 0 : 1);
