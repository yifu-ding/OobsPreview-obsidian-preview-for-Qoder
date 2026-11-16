#!/usr/bin/env node
// 从 styles/preview-theme.css（作者自有 snippet 的发布用改名副本）里抽出
// 适用于 VS Code 预览的规则，与手写的 media/base.css 合并成 media/obsidian.css。
//
// 用法：node tools/build-preview-css.mjs [源文件路径]
//   不带参数读仓库内的 styles/preview-theme.css（发布产物不依赖个人 vault）。
//   要从 vault 同步最新改动：先覆盖 styles/preview-theme.css，再跑本脚本；
//   或直接把 vault snippet 路径作为参数传入做一次性对比。
//
// 处理内容：
//   1. 丢掉只作用于编辑器（CM6 / Live Preview）的选择器分支；
//   2. 把 Obsidian 的阅读视图容器换成预览的 body；
//   3. theme-dark / theme-light 换成 vscode-dark / vscode-light；
//   4. 丢掉 --callout-icon: lucide-*（预览自己输出 SVG 图标）。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv.slice(2).find((arg) => !arg.startsWith('-'))
  || path.join(root, 'styles', 'preview-theme.css');

const EDITOR_ONLY = [
  '.cm-s-obsidian', '.cm-content', '.markdown-source-view', '.mod-cm6', '.HyperMD-',
  '.inline-title', '.metadata-container', '.cm-', 'HyperMD'
];
const READING_CONTAINERS = /\.markdown-(rendered|preview-view|view)/g;
// 强调色由 base.css 绑定到 VS Code 主题变量，不让 snippet 里的 Obsidian 变量覆盖
const OWNED_VARS = ['--notation-font-accent', '--notation-emphasis'];

const css = readFileSync(source, 'utf8');
const blocks = parseRules(css);

const kept = [];
const dropped = [];

for (const block of blocks) {
  const selectors = block.selectors
    .flatMap((selector) => rewriteSelector(selector))
    .filter(Boolean);

  if (!selectors.length) {
    dropped.push(block.selectors.join(', '));
    continue;
  }

  const declarations = block.body
    .replace(/--[a-z0-9-]*(?:callout|fold)-icon\s*:[^;]+;/gi, '')
    .replace(/(^|\n)\s*(?:--notation-font-accent|--notation-emphasis)\s*:[^;]+;/g, '$1')
    .replace(/\/\*[^]*?\*\//g, '')
    .trim();

  if (!declarations) {
    dropped.push(block.selectors.join(', '));
    continue;
  }

  kept.push([selectors.join(',\n'), declarations, block.comment]);
}

const ported = kept
  .map(([selector, declarations, comment]) =>
    (comment ? `/* ${comment} */\n` : '') + `${selector} {\n${indent(declarations)}\n}\n`)
  .join('\n');

const relSource = path.relative(root, source) || path.basename(source);
const header = `/* 由 tools/build-preview-css.mjs 生成，请勿手改。
 * 来源：${relSource}
 * 保留 ${kept.length} 条规则，丢弃 ${dropped.length} 条（仅编辑器作用域）。 */\n`;

writeFileSync(
  path.join(root, 'media', 'obsidian.css'),
  `${header}\n${readFileSync(path.join(root, 'media', 'base.css'), 'utf8').trim()}\n\n/* ===== 从 ${path.basename(source)} 移植 ===== */\n\n${ported}`
);

console.log(`保留 ${kept.length} 条，丢弃 ${dropped.length} 条 → media/obsidian.css`);
if (process.env.VERBOSE || process.argv.includes('--verbose')) {
  console.log('\n丢弃的选择器：\n  ' + dropped.join('\n  '));
}

// ------------------------------------------------------------------ parsing

function parseRules(text) {
  const out = [];
  let i = 0;
  let comment = '';

  while (i < text.length) {
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const body = text.slice(i + 2, end === -1 ? text.length : end).trim();
      if (body.includes('\n')) { comment = ''; } else { comment = body; }
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    const brace = text.indexOf('{', i);
    if (brace === -1) { break; }

    const selectorText = text.slice(i, brace).replace(/\/\*[^]*?\*\//g, '').trim();
    const close = matchingBrace(text, brace);
    const body = text.slice(brace + 1, close);

    if (selectorText.startsWith('@')) {
      // 预览里没有 @media/@supports/@import 需求；如有需要另行处理
      comment = '';
    } else {
      const declarations = stripComments(body).trim();
      if (declarations) {
        out.push({ selectors: splitTopLevel(selectorText, ','), body: declarations, comment });
        comment = '';
      }
    }
    i = close + 1;
  }
  return out;
}

function matchingBrace(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') { depth++; }
    else if (text[i] === '}') { depth--; if (depth === 0) { return i; } }
  }
  return text.length;
}

function stripComments(text) {
  return text.replace(/\/\*[^]*?\*\//g, '');
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(' || char === '[') { depth++; }
    if (char === ')' || char === ']') { depth--; }
    if (char === separator && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

// ----------------------------------------------------------------- rewriting

function rewriteSelector(selector) {
  let text = selector
    .replace(/body\.theme-dark/g, 'body.vscode-dark')
    .replace(/body\.theme-light/g, 'body.vscode-light')
    .replace(/:is\(\s*\.markdown-rendered\s*,\s*\.markdown-source-view\s*\)/g, ' ')
    .replace(READING_CONTAINERS, ' ')
    .replace(/\.cm-content/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return splitTopLevel(text, ',')
    .map(prune)
    .filter((part) => part && !isEditorOnly(part));
}

function isEditorOnly(part) {
  return EDITOR_ONLY.some((token) => part.includes(token));
}

// 递归删掉 :is() / :where() 里只作用于编辑器的分支
function prune(part) {
  let out = '';
  let i = 0;

  while (i < part.length) {
    const open = part.indexOf(':is(', i);
    const where = part.indexOf(':where(', i);
    const candidates = [open, where].filter((index) => index !== -1);
    if (!candidates.length) { out += part.slice(i); break; }

    const index = Math.min(...candidates);
    const name = part.slice(index, index + (candidates[0] === where ? 7 : 4));
    const innerStart = index + name.length;
    const innerEnd = matchingParen(part, innerStart - 1);

    const inner = part.slice(innerStart, innerEnd)
      .split(',')
      .map((item) => prune(item.trim()))
      .filter((item) => item && !isEditorOnly(item));

    out += part.slice(i, index);
    if (inner.length) {
      out += name + inner.join(', ') + ')';
    }
    i = innerEnd + 1;
  }
  return out.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
}

function matchingParen(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') { depth++; }
    else if (text[i] === ')') { depth--; if (depth === 0) { return i; } }
  }
  return text.length;
}

function indent(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => '  ' + line).join('\n');
}
