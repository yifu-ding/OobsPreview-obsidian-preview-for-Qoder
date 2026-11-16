'use strict';

const assert = require('assert');
const MarkdownIt = require('markdown-it');
const obsidianCallout = require('../src/callout');
const obsidianTaskList = require('../src/tasklist');
const obsidianWikilink = require('../src/wikilink');

const NOTES = {
  'Obsidian-format': '/vault/Personal/workflow/Obsidian-format.md',
  'A': '/vault/A.md',
  '子目录/B': '/vault/Notes/子目录/B.md'
};

const ASSETS = {
  'pic.png': '/vault/Assets/pic.png',
  '报告.pdf': '/vault/报告.pdf'
};

const FILES = {
  '/vault/Personal/workflow/Obsidian-format.md': '---\ntitle: 样例\n---\n\n## 链接\n\n正文内容\n',
  '/vault/A.md': '# 标题 A\n\n![[A]]\n',
  '/vault/Notes/子目录/B.md': '## B 小节\n\nB 的内容\n'
};

const ctx = {
  resolveNote: (name) => NOTES[name] || null,
  resolveAsset: (name) => ASSETS[name] || null,
  readText: (p) => Object.prototype.hasOwnProperty.call(FILES, p) ? FILES[p] : null,
  currentDocument: () => '/vault/Personal/workflow/current.md'
};

const md = new MarkdownIt({ html: true }).use(obsidianCallout).use(obsidianTaskList).use(obsidianWikilink, ctx);
const env = { currentDocument: { fsPath: '/vault/Personal/workflow/current.md' } };

const cases = [
  ['| 说明 |\n| --- |\n| [[Obsidian-format\\|表格里的别名]] |', (out) => {
    assert.match(out, /<a class="internal-link" href="Obsidian-format\.md"/);
    assert.match(out, />表格里的别名</);
  }],
  ['[[Obsidian-format]]', (out) => {
    assert.match(out, /<a class="internal-link" href="Obsidian-format\.md" data-href="Obsidian-format\.md">/);
    assert.match(out, />Obsidian-format<\/a>/);
  }],
  ['[[Obsidian-format|带别名的内部链接]]', (out) => {
    assert.match(out, /href="Obsidian-format\.md"/);
    assert.match(out, />带别名的内部链接<\/a>/);
  }],
  ['[[Obsidian-format#链接]]', (out) => {
    assert.match(out, /href="Obsidian-format\.md#%E9%93%BE%E6%8E%A5"/);
    assert.match(out, />链接<\/a>/);
  }],
  ['[[子目录/B#B 小节]]', (out) => {
    assert.match(out, /href="\.\.\/\.\.\/Notes\/%E5%AD%90%E7%9B%AE%E5%BD%95\/B\.md#B%20%E5%B0%8F%E8%8A%82"/);
  }],
  ['[[#文字样式]]', (out) => {
    assert.match(out, /<a class="internal-link" href="#%E6%96%87%E5%AD%97%E6%A0%B7%E5%BC%8F"/);
  }],
  ['[[不存在的笔记]]', (out) => {
    assert.match(out, /class="internal-link is-unresolved"/);
    assert.match(out, /href="#"/);
  }],
  ['![[pic.png]]', (out) => {
    assert.match(out, /<img src="file:\/\/\/vault\/Assets\/pic\.png" alt="pic\.png" class="internal-embed image-embed">/);
  }],
  ['![[pic.png|300]]', (out) => {
    assert.match(out, /width="300"/);
    assert.ok(!/height=/.test(out));
  }],
  ['![[pic.png|300x200]]', (out) => {
    assert.match(out, /width="300"/);
    assert.match(out, /height="200"/);
  }],
  ['前文 ![[pic.png|64]] 后文', (out) => {
    assert.match(out, /<p>前文 <img src="file:\/\/\/vault\/Assets\/pic\.png" width="64"/);
    assert.match(out, / 后文<\/p>/);
  }],
  ['![[Obsidian-format#链接]]', (out) => {
    assert.match(out, /<div class="internal-embed markdown-rendered"/);
    assert.match(out, /<h2[^>]*>链接<\/h2>/);
    assert.match(out, /正文内容/);
    assert.ok(!out.includes('title: 样例'), '嵌入应去掉 frontmatter');
  }],
  ['![[A]]', (out) => {
    assert.match(out, /<h1[^>]*>标题 A<\/h1>/);
    assert.match(out, /is-circular/);
  }],
  ['![[报告.pdf]]', (out) => {
    assert.match(out, /class="internal-embed file-embed"/);
    assert.match(out, /data-href="[^"]*%E6%8A%A5%E5%91%8A\.pdf"/);
  }],
  ['![[缺失.png]]', (out) => {
    assert.match(out, /class="internal-embed is-unresolved">缺失\.png</);
  }],
  ['[[Obsidian-format]] 与 [外部链接](https://obsidian.md)', (out) => {
    assert.match(out, /<a class="internal-link"/);
    assert.match(out, /<a href="https:\/\/obsidian\.md">外部链接<\/a>/);
  }],
  ['![普通图片](pic.png)', (out) => {
    assert.match(out, /<img src="pic\.png" alt="普通图片">/);
  }],
  ['> [!tip] 见 [[Obsidian-format]]\n> 正文', (out) => {
    assert.match(out, /data-callout="tip"/);
    assert.match(out, /callout-title-inner">见 <a class="internal-link"/);
  }],
  ['- [ ] 检查 [[Obsidian-format#链接]]', (out) => {
    assert.match(out, /data-task=" "/);
    assert.match(out, /class="internal-link"/);
  }],
  ['\\[[不是链接]]', (out) => {
    assert.ok(!out.includes('internal-link'), out);
  }],
  ['行内代码 `[[Obsidian-format]]` 不该转换', (out) => {
    assert.match(out, /<code>\[\[Obsidian-format\]\]<\/code>/);
    assert.ok(!out.includes('internal-link'));
  }],
  ['![[pic.png|图片别名|300]]', (out) => {
    assert.match(out, /width="300"/);
    assert.match(out, /alt="图片别名"/);
  }],
  ['![[pic.png|图片别名|300x200]]', (out) => {
    assert.match(out, /width="300"/);
    assert.match(out, /height="200"/);
    assert.match(out, /alt="图片别名"/);
  }],
  ['[[Obsidian-format|300]]', (out) => {
    assert.match(out, />300<\/a>/);
    assert.ok(!/width=/.test(out), '笔记链接的 |300 是别名不是宽度');
  }],
  ['[[Obsidian-format#^block-id]]', (out) => {
    assert.match(out, /href="Obsidian-format\.md#block-id"/);
    assert.match(out, />block-id<\/a>/);
  }],
  ['[[#^block-id]]', (out) => {
    assert.match(out, /href="#block-id"/);
  }]
];

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

let failed = 0;
for (const [src, check] of cases) {
  const out = md.render(src, env);
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
