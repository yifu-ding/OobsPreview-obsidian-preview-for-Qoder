'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const MarkdownIt = require('markdown-it');

// 临时库：没有打开文件夹、只打开单篇笔记时，扩展要能自己找到库根。
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ompreview-'));
fs.mkdirSync(path.join(root, '.obsidian'));
fs.mkdirSync(path.join(root, 'sub'));
fs.writeFileSync(path.join(root, 'Project Notes.md'), '---\naliases:\n  - PN\n---\n\n# Project Notes\n\n## Tasks\n');
fs.writeFileSync(path.join(root, 'sub', 'Project Notes.md'), '# 同名笔记\n');
fs.writeFileSync(path.join(root, 'diagram.png'), '');
const notePath = path.join(root, '草稿.md');
fs.writeFileSync(notePath, '# 草稿\n\n## 小标题\n\n正文 #urgent\n');

const fileUri = (fsPath) => ({ scheme: 'file', fsPath, toString: () => 'file://' + fsPath });
const noteDoc = { uri: fileUri(notePath), getText: () => fs.readFileSync(notePath, 'utf8') };

const registered = [];
const watched = [];

class CompletionItem {
  constructor(label, kind) { this.label = label; this.kind = kind; }
}
class Range {
  constructor(start, end) { this.start = start; this.end = end; }
}
class RelativePattern {
  constructor(base, pattern) { this.base = base; this.pattern = pattern; }
}

const vscodeStub = {
  workspace: {
    workspaceFolders: undefined,
    textDocuments: [noteDoc],
    createFileSystemWatcher: (pattern) => {
      watched.push(pattern);
      return {
        onDidCreate: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        onDidChange: () => ({ dispose() {} }),
        dispose() {}
      };
    }
  },
  languages: {
    registerCompletionItemProvider: (selector, provider, ...triggerCharacters) => {
      registered.push({ selector, provider, triggerCharacters });
      return { dispose() {} };
    }
  },
  window: {
    activeTextEditor: null,
    onDidChangeActiveTextEditor: () => ({ dispose() {} })
  },
  CompletionItem,
  Range,
  RelativePattern,
  CompletionItemKind: { File: 17, Reference: 18, Value: 12 },
  Uri: { file: fileUri },
  commands: { executeCommand: async () => {} }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') { return vscodeStub; }
  return originalLoad.call(this, request, parent, isMain);
};
const { activate } = require('../extension.js');
Module._load = originalLoad;

const api = activate({ subscriptions: [] });

function editorFor(text) {
  const lines = text.split('\n');
  return {
    uri: fileUri(notePath),
    getText: () => text,
    offsetAt: (pos) => lines.slice(0, pos.line).reduce((n, l) => n + l.length + 1, 0) + pos.character,
    positionAt: (offset) => {
      const head = text.slice(0, offset).split('\n');
      return { line: head.length - 1, character: head[head.length - 1].length };
    }
  };
}

async function engineCase() {
  const extend = await Promise.resolve((md) => api.extendMarkdownIt(md));

  // 宿主是 t = (await factory)(t)，只 await 工厂、不 await 返回值。
  const md = extend(new MarkdownIt({ html: true, linkify: true }));
  assert.ok(md instanceof MarkdownIt, 'extendMarkdownIt 必须同步返回 markdown-it 实例');
  assert.ok(md.block && md.block.ruler, '返回 Promise 会让宿主读 md.block.ruler 时崩溃');
  md.block.ruler.before('fence', 'front_matter', () => false, {
    alt: ['paragraph', 'reference', 'blockquote', 'list']
  });

  const out = md.render('> [!note] 标题\n> 正文\n\n- [x] 完成\n\n==高亮==');
  assert.match(out, /data-callout="note"/);
  assert.match(out, /data-task="x"/);
  assert.match(out, /<mark>高亮<\/mark>/);
}

async function providerCase() {
  for (let i = 0; i < 300 && watched.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(registered.length, 1, '应注册一个补全 provider');
  const { selector, triggerCharacters } = registered[0];
  assert.equal(selector.language, 'markdown');
  assert.deepEqual(triggerCharacters, ['[', '#']);
  assert.deepEqual(watched.map((w) => w.base), [root], '没有 workspace 时也要按库根监听');
}

// 补全发生在真实笔记末尾，标题/标签索引要能看到整篇正文。
function cursorDoc(suffix, caret = suffix.length) {
  const text = noteDoc.getText() + '\n' + suffix;
  return { document: editorFor(text), position: { line: text.split('\n').length - 1, character: caret } };
}

function complete(suffix, caret) {
  const { document, position } = cursorDoc(suffix, caret);
  return registered[0].provider.provideCompletionItems(document, position);
}

async function noteCase() {
  const items = await complete('见 [[Pro');
  const notes = items.filter((i) => i.label === 'Project Notes');
  assert.deepEqual(notes.map((i) => i.insertText).sort(), ['Project Notes]]', 'sub/Project Notes]]']);
  assert.equal(notes[0].detail, 'Project Notes.md');
  assert.ok(items.some((i) => i.label === 'PN' && i.insertText === 'Project Notes|PN]]'), '别名应可补全');
  assert.ok(!items.some((i) => i.label === 'diagram.png'), '普通链接不列图片');
  assert.equal(notes[0].range.start.character, 4, '替换范围从 [[ 之后开始');
  const embeds = await complete('![[dia');
  assert.ok(embeds.some((i) => i.label === 'diagram.png'), '嵌入要能补图片');
}

async function closingCase() {
  const open = await complete('见 [[Pro');
  assert.ok(open[0].insertText.endsWith(']]'), '缺右括号时补上');
  const closed = await complete('见 [[Pro]]', 7);
  assert.ok(closed.every((i) => !i.insertText.endsWith(']]')), '已有 ]] 时不重复补');
  assert.equal(closed[0].range.end.character, 7, '替换范围止于已有的 ]] 之前');
}

async function headingCase() {
  const mine = await complete('[[#');
  assert.deepEqual(mine.map((i) => i.label), ['草稿', '小标题']);
  const other = await complete('[[Project Notes#');
  assert.deepEqual(other.map((i) => i.label), ['Project Notes', 'Tasks']);
}

async function tagCase() {
  const items = await complete('正文 #');
  assert.deepEqual(items.map((i) => i.label), ['urgent']);
  const { document } = cursorDoc('');
  assert.equal(await registered[0].provider.provideCompletionItems(document, { line: 0, character: 1 }), null);
}

// watcher 漏掉删除事件时（库在工作区外就会漏），补全仍不能列出已删文件。
async function deletedCase() {
  const before = await complete('见 [[Pro');
  assert.ok(before.some((i) => i.insertText === 'sub/Project Notes]]'));

  fs.rmSync(path.join(root, 'sub', 'Project Notes.md'));
  fs.rmSync(path.join(root, 'diagram.png'));

  const after = await complete('见 [[Pro');
  assert.ok(!after.some((i) => i.insertText.startsWith('sub/')), '删掉的笔记不该再补全');
  assert.ok(after.some((i) => i.label === 'Project Notes'), '其余笔记不受影响');
  const embeds = await complete('![[dia');
  assert.ok(!embeds.some((i) => i.label === 'diagram.png'), '删掉的图片不该再补全');
}

(async () => {
  const cases = [
    ['宿主引擎构造契约', engineCase],
    ['补全 provider 注册与库根监听', providerCase],
    ['[[ 补全笔记、同名路径与别名', noteCase],
    ['右括号不重复插入', closingCase],
    ['[[# 与 [[Note# 补全标题', headingCase],
    ['# 补全标签、Markdown 标题不触发', tagCase],
    ['文件删除后补全不再列出', deletedCase]
  ];
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
  fs.rmSync(root, { recursive: true, force: true });
  console.log(failed === 0 ? `\n${cases.length} cases ok` : `\n${failed} case(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
})();