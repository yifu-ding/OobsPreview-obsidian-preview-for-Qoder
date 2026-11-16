'use strict';

// 生成 README 与社区提交包用的功能截图：用插件真实渲染管线（src/* + media/obsidian.css）
// 渲染精选示例页，再交给 headless Chrome 截 2x PNG。不碰宿主窗口、不改用户浏览器。
// 用法：node tools/make-screenshots.cjs
//   逐语法页 → assets/（README 画廊用）
//   组合页   → submission/screenshots/（提交包用）
// 依赖：/Applications/Google Chrome.app（headless=new）

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createHostMarkdown } = require('./host-md');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, 'tools', '.shots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const LOGO = 'data:image/png;base64,' +
  fs.readFileSync(path.join(ROOT, 'media', 'logo.png')).toString('base64');

// 笔记嵌入演示源：readText 只对这一篇返回内容，其余仍走 unresolved 分支
const DEMO_NOTE = `---
title: Demo Note
---

## Section

这一节被嵌入到别的笔记里。**加粗**与==高亮==在嵌入内同样渲染。

## Other

这一节不会被嵌入。

可复用块。 ^demo-block
`;

const md = createHostMarkdown({
  resolveNote: (name) => '/vault/' + name + '.md',
  // 图片判定看解析后路径的扩展名，所以这里给真实路径，toUri 再换成 data URL
  resolveAsset: (name) => '/vault/' + name,
  readText: (p) => (p === '/vault/Demo Note.md' ? DEMO_NOTE : null),
  currentDocument: () => '/vault/Demo.md',
  toUri: (p) => (/\.(png|jpe?g|gif|webp|svg)$/i.test(p) ? LOGO : 'file://' + p)
});

const FRONTMATTER = `---
title: Obsidian-format 样例
aliases:
  - Obsidian Markdown 示例
tags:
  - obsidian
  - markdown
created: 2026-05-09
---
`;

const CALLOUTS_NATIVE = `> [!note]
> 这是 note 提示块。

> [!tip]
> 这是 tip 提示块。

> [!warning]
> 这是 warning 提示块。

> [!info] 自定义标题
> Callout 可以自定义标题。

> [!todo]+ 默认展开
> 标题后加 \`+\` 表示默认展开。

> [!example]- 默认折叠
> 标题后加 \`-\` 表示默认折叠。
`;

const CALLOUTS_AGENT = `> [!codex|2026-11-16 10:24 · gpt-5-codex]
> 已把 callout 的包裹层补齐，metadata 网格恢复整行正文。

> [!claude|2026-11-16 10:31 · sonnet-4.5]
> 复核通过：折叠与非折叠分支的 DOM 与 Obsidian 一致。

> [!user|2026-11-16 10:32]
> 截图里标题和正文的摆放都对了。

> [!qwen|2026-11-16 10:40 · qwen3-max]
> 中文长段落不再撑爆第一列，正文沉底的问题消失。
`;

const TASKS = `- [ ] 待办
- [/] 进行中
- [x] 完成
- [-] 取消
- [>] 转发
- [<] 排期
- [?] 问题
- [!] 重要
- [*] 星标
- [l] 位置
- [i] 信息
- [I] 想法
- [f] 火急
- [k] 关键
- [w] 胜利
- [u] 上升
- [d] 下降
- [D] draft PR
- [P] open PR
- [M] merged PR
- [ ] 带子任务
  - [x] 子任务完成
  - [ ] 子任务待办
`;

// 逐语法页：README 画廊一一对应
const FEATURES = [
  { name: 'properties', theme: 'light', src: FRONTMATTER + '\n属性区渲染为表格，值里的链接、标签、高亮照常渲染。\n' },
  { name: 'callouts', theme: 'light', src: CALLOUTS_NATIVE },
  { name: 'callouts-agent', theme: 'light', src: CALLOUTS_AGENT },
  { name: 'tasks', theme: 'light', src: TASKS },
  { name: 'wikilinks', theme: 'light', src: '[[Obsidian-format]] · [[Obsidian-format|带别名的内部链接]] · [[Obsidian-format#链接]] · [[Obsidian-format#^block-id]]\n' },
  { name: 'embed-image', theme: 'light', src: '![[attachment.png|300]]\n\n![[attachment.png|图片别名|300]]\n' },
  { name: 'embed-note', theme: 'light', src: '![[Demo Note#Section]]\n\n![[Demo Note#^demo-block]]\n' },
  { name: 'highlight', theme: 'light', src: '普通文字里混用 ==高亮文本== 与 **加粗**、*斜体*。\n' },
  { name: 'comments', theme: 'light', src: '可见文字%%这段注释不会显示%%继续可见。\n\n%%\n整段块注释也不会显示。\n%%\n\n注释前后的段落照常。\n' },
  { name: 'tags', theme: 'light', src: '行内标签 #obsidian 与嵌套标签 #markdown/nested 都会渲染成 pill。\n' },
  { name: 'footnotes', theme: 'light', src: '这是一个脚注引用。[^note] 这是一个行内脚注。^[这是行内脚注内容。]\n\n[^note]: 脚注定义会渲染到文末的脚注区。\n' },
  { name: 'block-id', theme: 'light', src: '这是一个可复用的块。 ^block-id\n\n引用它：[[Demo#^block-id]]\n' },
  { name: 'dark-theme', theme: 'dark', src: CALLOUTS_AGENT }
];

// 组合页：提交包 screenshots/
const GROUPS = [
  { name: '01-properties-callouts-light', theme: 'light', src: FRONTMATTER + '\n## Properties 与 Callout\n\n' + CALLOUTS_NATIVE },
  { name: '02-agent-callouts-light', theme: 'light', src: '## 自定义 Agent Callout（metadata 网格）\n\n' + CALLOUTS_AGENT },
  { name: '03-task-markers-light', theme: 'light', src: '## 任务标记（Cupertino / Tasks 全集节选）\n\n' + TASKS },
  { name: '04-links-embeds-light', theme: 'light', src: '## 链接、嵌入与行内语法\n\n[[Obsidian-format]] · [[Obsidian-format|带别名的内部链接]] · [[Obsidian-format#链接]] · [[Obsidian-format#^block-id]]\n\n![[attachment.png|图片别名|300]]\n\n==高亮文本==、 #obsidian 与 #markdown/nested 标签、%%这段注释不会显示%%。\n\n这是一个脚注引用。[^note] 这是一个行内脚注。^[这是行内脚注内容。]\n\n这是一个可复用的块。 ^block-id\n\n[^note]: 脚注定义会渲染到文末的脚注区。\n' },
  { name: '05-properties-callouts-dark', theme: 'dark', src: null, copyOf: '01-properties-callouts-light' },
  { name: '06-agent-callouts-dark', theme: 'dark', src: null, copyOf: '02-agent-callouts-light' }
];

const TOKENS = {
  light: {
    '--vscode-editor-background': '#ffffff',
    '--vscode-foreground': '#3b3b3b',
    '--vscode-descriptionForeground': '#616161',
    '--vscode-textLink-foreground': '#006ab1',
    '--vscode-panel-border': '#e5e5e5',
    '--vscode-focusBorder': '#0090f1',
    '--vscode-errorForeground': '#e51400',
    '--vscode-inputValidation-errorBorder': '#be1100',
    '--vscode-editor-font-size': '14px'
  },
  dark: {
    '--vscode-editor-background': '#1f1f1f',
    '--vscode-foreground': '#cccccc',
    '--vscode-descriptionForeground': '#9d9d9d',
    '--vscode-textLink-foreground': '#3794ff',
    '--vscode-panel-border': '#2b2b2b',
    '--vscode-focusBorder': '#007fd4',
    '--vscode-errorForeground': '#f14c4c',
    '--vscode-inputValidation-errorBorder': '#be1100',
    '--vscode-editor-font-size': '14px'
  }
};

const CSS = fs.readFileSync(path.join(ROOT, 'media', 'obsidian.css'), 'utf8');

function pageHtml(page, src) {
  const tokens = Object.entries(TOKENS[page.theme])
    .map(([k, v]) => `${k}:${v};`).join('');
  const body = md.render(src, {});
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
:root{${tokens}}
html,body{margin:0;padding:0;background:var(--vscode-editor-background);}
body{color:var(--vscode-foreground);font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Helvetica Neue",Arial,sans-serif;}
.wrap{max-width:920px;margin:0 auto;padding:36px 44px 56px;}
${CSS}
</style></head>
<body class="vscode-${page.theme}"><div class="wrap">
${body}
</div><script>
addEventListener('load', () => {
  document.title = String(Math.ceil(document.querySelector('.wrap').getBoundingClientRect().bottom + 28));
});
</script></body></html>`;
}

function shoot(page, src, outDir) {
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const htmlPath = path.join(TMP, page.name + '.html');
  fs.writeFileSync(htmlPath, pageHtml(page, src));
  const pngPath = path.join(outDir, page.name + '.png');
  // 先量内容高度，避免截图底部留大白边
  const dom = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--virtual-time-budget=1500',
    '--dump-dom', 'file://' + htmlPath
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = /<title>(\d+)<\/title>/.exec(dom);
  const height = m ? Number(m[1]) : 900;
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=2',
    `--window-size=1440,${height}`,
    '--virtual-time-budget=1500',
    `--screenshot=${pngPath}`,
    'file://' + htmlPath
  ], { stdio: 'ignore' });
  console.log(`shot ${path.relative(ROOT, pngPath)} (h=${height})`);
}

const groupByName = new Map(GROUPS.map((p) => [p.name, p]));
for (const page of FEATURES) {
  shoot(page, page.src, path.join(ROOT, 'assets'));
}
for (const page of GROUPS) {
  shoot(page, page.src || groupByName.get(page.copyOf).src, path.join(ROOT, 'submission', 'screenshots'));
}
console.log('done');