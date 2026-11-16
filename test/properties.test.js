'use strict';

const assert = require('assert');
const MarkdownIt = require('markdown-it');
const obsidianProperties = require('../src/properties');
const { renderProperties } = obsidianProperties;

// 复刻引擎的 front_matter 规则（markdown-it-front-matter 行为），用于离线测试
function frontMatter(md) {
  md.block.ruler.before('fence', 'front_matter', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    if (startLine > 0 || state.src.slice(start, start + 3) !== '---') { return false; }
    let nextLine = startLine + 1;
    while (nextLine < endLine) {
      const pos = state.bMarks[nextLine] + state.tShift[nextLine];
      if (state.src.slice(pos, state.eMarks[nextLine]).trim() === '---') { break; }
      nextLine++;
    }
    if (nextLine >= endLine) { return false; }
    if (silent) { return true; }
    const body = state.src
      .split('\n')
      .slice(startLine + 1, nextLine)
      .join('\n');
    const token = state.push('front_matter', '', 0);
    token.hidden = true;
    token.meta = body;
    state.line = nextLine + 1;
    return true;
  });
}

const md = new MarkdownIt({ html: true }).use(frontMatter)
  .use(require('../src/highlight'))
  .use(require('../src/wikilink'), {
    resolveNote: (name) => '/vault/' + name + '.md',
    resolveAsset: () => null,
    readText: () => null,
    currentDocument: () => '/vault/current.md'
  })
  .use(obsidianProperties);

const cases = [
  ['---\ntitle: Obsidian-format样例\ntags:\n  - obsidian\n  - markdown\ncreated: 2026-05-09\n---\n\n# 正文', (out) => {
    assert.match(out, /<div class="frontmatter-container">/);
    assert.match(out, /frontmatter-property-name"><span>tags<\/span>/);
    assert.match(out, /<a class="tag">#obsidian<\/a>/);
    assert.match(out, /title<\/span><\/td><td class="frontmatter-property-value"><span>Obsidian-format样例/);
    assert.match(out, /2026-05-09/);
    assert.match(out, /<h1[^>]*>正文<\/h1>/);
    assert.ok(!out.includes('---'), '原始 YAML 不应出现');
  }],
  ['---\ntags:\n  - 项目/论文\n---\n正文', (out) => {
    assert.match(out, /<a class="tag">#项目\/论文<\/a>/);
  }],
  ['---\ndraft: true\nhidden: false\n---\n正文', (out) => {
    assert.match(out, /<span>✓<\/span>/);
    assert.match(out, /<span>✗<\/span>/);
  }],
  ['---\nempty:\naliases:\n  - 别名\n---\n正文', (out) => {
    assert.match(out, /<span class="frontmatter-empty">空<\/span>/);
    assert.match(out, /frontmatter-plain">别名</);
  }],
  ['---\nowners:\n  - name: 张三\n    role: 作者\n---\n正文', (out) => {
    assert.match(out, /frontmatter-kv/);
    assert.match(out, /<b>name<\/b>/);
  }],
  ['---\nkey: [unclosed\n---\n正文', (out) => {
    assert.match(out, /frontmatter-container is-error/);
    assert.match(out, /正文/);
  }],
  ['---\n---\n正文', (out) => {
    assert.ok(!out.includes('frontmatter-container'), '空 frontmatter 不应渲染表格');
  }],
  ['---\nsource: "[[所有题目]]"\nnote: ==重点==\n---\n正文', (out) => {
    assert.match(out, /<a class="internal-link"[^>]*>所有题目<\/a>/);
    assert.match(out, /<mark>重点<\/mark>/);
    assert.ok(!out.includes('[[所有题目]]'), '属性值里的 wikilink 应被渲染');
  }],
  ['---\naliases:\n  - "[[别名笔记]]"\n---\n正文', (out) => {
    assert.match(out, /frontmatter-plain"><a class="internal-link"/);
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

assert.strictEqual(renderProperties(''), '', '空 YAML 不渲染');
assert.strictEqual(renderProperties('title: x')[0], '<');
console.log(failed === 0 ? `\n${cases.length} cases ok` : `\n${failed} case(s) failed`);
process.exit(failed === 0 ? 0 : 1);
