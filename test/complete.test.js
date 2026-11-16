'use strict';

const assert = require('assert');
const { completionContext, parseNote, MetaIndex, completionItems } = require('../src/complete');
const { VaultIndex } = require('../src/vault');

// 用 ‸ 标记光标
function ctx(src) {
  const offset = src.indexOf('‸');
  assert.ok(offset >= 0, '用例缺少光标标记');
  return completionContext(src.replace('‸', ''), offset);
}

const FILES = new Map([
  ['/vault/Project Notes.md', '---\naliases:\n  - PN\n  - 项目笔记\ntags:\n  - project\n---\n\n# Project Notes\n\n## Tasks\n\n正文 #urgent\n'],
  ['/vault/Backlog.md', '# Backlog\n\n## Tasks\n\n### Later\n\n#project #urgent\n'],
  ['/vault/sub/Project Notes.md', '# 另一个同名笔记\n\n## 别的标题\n\n#once\n'],
  ['/vault/AI Bridge.md', '# AI Bridge\n']
]);
const ASSETS = ['/vault/diagram.png', '/vault/spec.pdf'];
const NOTES = [...FILES.keys()];

const vault = VaultIndex.fromPaths(NOTES, ASSETS);
let reads = 0;
const meta = new MetaIndex({
  readText: (p) => { reads++; return FILES.has(p) ? FILES.get(p) : null; },
  stat: (p) => FILES.has(p) ? { mtimeMs: 1, size: FILES.get(p).length } : null
});

const deps = () => ({ meta, vault, root: '/vault', currentPath: '/vault/Backlog.md', currentText: FILES.get('/vault/Backlog.md') });
const labels = (items) => items.map((i) => i.label);

const cases = [
  ['[[ 触发笔记补全', () => {
    const c = ctx('[[‸');
    assert.equal(c.kind, 'note');
    assert.equal(c.query, '');
    assert.equal(c.start, 2);
    assert.equal(c.appendClosing, true);
  }],
  ['[[ 带前缀与中文前文', () => {
    const c = ctx('见 [[Pro‸');
    assert.equal(c.kind, 'note');
    assert.equal(c.query, 'Pro');
    assert.equal(c.start, 4);
  }],
  ['编辑器自动补的 ]] 不再重复插入', () => {
    const c = ctx('[[‸]]');
    assert.equal(c.appendClosing, false);
    assert.equal(c.end, 2);
  }],
  ['光标在已有链接内部时替换整段目标', () => {
    const c = ctx('[[Project No‸tes]]');
    assert.equal(c.query, 'Project No');
    assert.equal(c.end, 15);
    assert.equal(c.appendClosing, false);
  }],
  ['[[# 补全当前笔记标题', () => {
    const c = ctx('[[#‸');
    assert.equal(c.kind, 'heading');
    assert.equal(c.noteName, '');
    assert.equal(c.start, 3);
  }],
  ['[[Note# 补全指定笔记标题', () => {
    const c = ctx('[[Backlog#Ta‸');
    assert.equal(c.kind, 'heading');
    assert.equal(c.noteName, 'Backlog');
    assert.equal(c.query, 'Ta');
    assert.equal(c.start, 10);
  }],
  ['![[ 走嵌入补全', () => {
    assert.equal(ctx('![[di‸').kind, 'embed');
  }],
  ['别名与多级标题不补全', () => {
    assert.equal(ctx('[[Note|ali‸'), null);
    assert.equal(ctx('[[Backlog#Tasks#Sub‸'), null);
  }],
  ['行首 # 后已有空格是 Markdown 标题，不补全标签', () => {
    assert.equal(ctx('#‸ '), null);
    assert.equal(ctx('##‸ '), null);
    assert.equal(ctx('### 标题‸'), null);
    assert.equal(ctx('#‸# 标题'), null);
  }],
  ['行首刚打出的 # 仍补全标签', () => {
    const c = ctx('#‸');
    assert.equal(c.kind, 'tag');
    assert.equal(c.query, '');
    assert.equal(ctx('  #‸').kind, 'tag');
  }],
  ['行首 #tag 与空白后的 #tag 补全标签', () => {
    const a = ctx('#pro‸');
    assert.equal(a.kind, 'tag');
    assert.equal(a.query, 'pro');
    const b = ctx('文本 #pro‸');
    assert.equal(b.kind, 'tag');
    assert.equal(b.start, 4);
  }],
  ['紧贴文字的 # 不是标签', () => {
    assert.equal(ctx('a#pro‸'), null);
  }],
  ['行内代码与围栏代码里不补全', () => {
    assert.equal(ctx('`#pro‸`'), null);
    assert.equal(ctx('`[[Note‸]]`'), null);
    assert.equal(ctx('```\n[[Note‸\n```'), null);
    assert.equal(ctx('```\n#pro‸\n```'), null);
    assert.equal(ctx('```\ncode\n```\n\n[[Note‸').kind, 'note', '围栏闭合后应恢复补全');
  }],
  ['中文标签在中文标点处断开', () => {
    const c = ctx('#项目‸，说明');
    assert.equal(c.kind, 'tag');
    assert.equal(c.query, '项目');
  }],
  ['parseNote 提取标题、行内标签与属性标签、别名', () => {
    const parsed = parseNote(FILES.get('/vault/Project Notes.md'));
    assert.deepEqual(parsed.headings.map((h) => h.text), ['Project Notes', 'Tasks']);
    assert.deepEqual(parsed.aliases, ['PN', '项目笔记']);
    assert.equal(parsed.tags.get('urgent'), 1);
    assert.equal(parsed.tags.get('project'), 1);
  }],
  ['parseNote 不把代码块里的 # 当标题或标签', () => {
    const parsed = parseNote('# 真标题\n\n```\n# 假标题\n#fake\n```\n');
    assert.deepEqual(parsed.headings.map((h) => h.text), ['真标题']);
    assert.equal(parsed.tags.size, 0);
  }],
  ['笔记补全列出全库笔记', () => {
    const items = completionItems(ctx('[[‸'), deps());
    for (const name of ['Project Notes', 'Backlog', 'AI Bridge']) {
      assert.ok(labels(items).includes(name), name);
    }
    assert.ok(!labels(items).includes('diagram.png'), '普通链接不该列出图片');
  }],
  ['同名笔记插入带路径的目标', () => {
    const items = completionItems(ctx('[[‸'), deps());
    const targets = items.filter((i) => i.label === 'Project Notes').map((i) => i.insertText);
    assert.ok(targets.includes('Project Notes'), targets.join(','));
    assert.ok(targets.includes('sub/Project Notes'), targets.join(','));
  }],
  ['别名补全插入 Note|alias', () => {
    const items = completionItems(ctx('[[‸'), deps());
    const alias = items.find((i) => i.label === 'PN');
    assert.equal(alias.insertText, 'Project Notes|PN');
    assert.match(alias.detail, /别名/);
  }],
  ['嵌入补全包含图片与附件', () => {
    const items = completionItems(ctx('![[‸'), deps());
    assert.ok(labels(items).includes('diagram.png'));
    assert.ok(labels(items).includes('spec.pdf'));
    assert.ok(labels(items).includes('Backlog'));
  }],
  ['输入不存在的名字时给出新笔记项', () => {
    const items = completionItems(ctx('[[全新想法‸'), deps());
    const fresh = items.find((i) => i.detail.includes('新笔记'));
    assert.equal(fresh.insertText, '全新想法');
    const first = items.reduce((a, b) => (a.sortText <= b.sortText ? a : b));
    assert.equal(first, fresh, '新笔记项应排在最前');
  }],
  ['[[# 用未保存的正文取当前笔记标题', () => {
    const d = deps();
    d.currentText = '# Backlog\n\n## 刚加的标题\n';
    const items = completionItems(ctx('[[#‸'), d);
    assert.deepEqual(labels(items), ['Backlog', '刚加的标题']);
    assert.equal(items[1].detail, 'H2 · 当前笔记');
  }],
  ['[[Note# 取目标笔记标题', () => {
    const items = completionItems(ctx('[[Project Notes#‸'), deps());
    assert.deepEqual(labels(items), ['Project Notes', 'Tasks']);
    assert.equal(items[0].detail, 'H1 · Project Notes');
  }],
  ['[[不存在的笔记# 没有标题可补', () => {
    assert.deepEqual(completionItems(ctx('[[查无此篇#‸'), deps()), []);
  }],
  ['标签补全按引用次数排序并合并当前正文', () => {
    const items = completionItems(ctx('文本 #‸'), deps());
    assert.deepEqual(labels(items), ['project', 'urgent', 'once']);
    const project = items.find((i) => i.label === 'project');
    assert.equal(project.detail, '2 处引用');
    assert.equal(items[items.length - 1].detail, '1 处引用');
    assert.ok(items[0].sortText <= items[items.length - 1].sortText);
  }],
  ['MetaIndex 按 mtime+size 缓存，没变不重读', async () => {
    await meta.ensure(NOTES);
    const afterFirst = reads;
    assert.equal(afterFirst, NOTES.length);
    meta.invalidate();
    await meta.ensure(NOTES);
    assert.equal(reads, afterFirst, '内容没变时不该重读');
    FILES.set('/vault/AI Bridge.md', '# AI Bridge\n\n## 新标题\n');
    meta.invalidate();
    await meta.ensure(NOTES);
    assert.equal(reads, afterFirst + 1, '只重读变化的那一篇');
    assert.deepEqual(meta.headingsFor('/vault/AI Bridge.md').map((h) => h.text), ['AI Bridge', '新标题']);
  }],
  ['建索引期间再次失效会保持 dirty', async () => {
    meta.invalidate();
    const pending = meta.ensure(NOTES);
    meta.invalidate();
    await pending;
    assert.equal(meta.dirty, true);
    await meta.ensure(NOTES);
    assert.equal(meta.dirty, false);
  }]
];

(async () => {
  await meta.ensure(NOTES);
  let failed = 0;
  for (const [name, check] of cases) {
    try {
      await check();
      console.log('PASS  ' + name);
    } catch (err) {
      failed++;
      console.log('FAIL  ' + name + '\n' + err.message);
    }
  }
  console.log(failed === 0 ? `\n${cases.length} cases ok` : `\n${failed} case(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
})();