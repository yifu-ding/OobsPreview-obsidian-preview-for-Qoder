'use strict';

// 回归：IDE 原生预览不改写 raw HTML 的资源路径，相对 <img src> 会裂图；
// 文档目录里不存在的标准 markdown 图片同样裂。asset-src 规则负责解析+内联/接管。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const MarkdownIt = require('markdown-it');
const plugin = require('../src/asset-src');
const { VaultIndex } = require('../src/vault');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-assetsrc-'));
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.mkdirSync(path.join(root, 'media'), { recursive: true });
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
  '0000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
fs.writeFileSync(path.join(root, 'media', 'icon.png'), PNG);
fs.writeFileSync(path.join(root, 'docs', 'local.png'), PNG);
fs.writeFileSync(path.join(root, 'docs', 'note.md'), '# note\n');
fs.writeFileSync(path.join(root, 'note.md'), '# root note\n');
const B64 = PNG.toString('base64');

const vault = VaultIndex.fromPaths(
  [path.join(root, 'docs', 'note.md'), path.join(root, 'note.md')],
  [path.join(root, 'media', 'icon.png'), path.join(root, 'docs', 'local.png')]);

function mdFor(doc) {
  return new MarkdownIt({ html: true }).use(plugin, {
    resolveAsset: (name, from) => vault.resolveAsset(name, from),
    currentDocument: () => doc,
    toUri: (p) => 'file://' + p
  });
}
const fromDocs = mdFor(path.join(root, 'docs', 'note.md'));
const fromRoot = mdFor(path.join(root, 'note.md'));

// HTML img：文档相对缺失 → 全库解析并内联，其余属性保留
let out = fromDocs.render('<img src="media/icon.png" width="96" alt="OobsPreview 标志">\n');
assert.ok(out.includes('src="data:image/png;base64,' + B64 + '"'), out);
assert.ok(out.includes('width="96"') && out.includes('alt="OobsPreview 标志"'), out);

// HTML img：文档相对命中也内联（宿主不改写 raw HTML 资源路径）
out = fromDocs.render("<img src='local.png'>\n");
assert.ok(out.includes("src='data:image/png;base64," + B64 + "'"), out);
out = fromRoot.render('<img src="media/icon.png">\n');
assert.ok(out.includes('data:image/png;base64,' + B64), out);

// HTML img：带 scheme / data / 解析不到 → 原样
out = fromDocs.render('<img src="https://example.com/x.png">\n');
assert.ok(out.includes('src="https://example.com/x.png"'), out);
out = fromDocs.render('<img src="data:image/png;base64,AAAA">\n');
assert.ok(out.includes('src="data:image/png;base64,AAAA"'), out);
out = fromDocs.render('<img src="nope.png">\n');
assert.ok(out.includes('src="nope.png"'), out);

// 标准 markdown 图片：文档相对缺失 → 接管为 file:// URI（宿主会转 webview 资源）
out = fromDocs.render('![a](icon.png)\n');
assert.ok(out.includes('src="file://' + path.join(root, 'media', 'icon.png') + '"'), out);
out = fromDocs.render('![a](media/icon.png)\n');
assert.ok(out.includes('src="file://' + path.join(root, 'media', 'icon.png') + '"'), out);

// 标准 markdown 图片：文档相对命中 / 带 scheme → 不动，交宿主原生解析
out = fromRoot.render('![a](media/icon.png)\n');
assert.ok(out.includes('src="media/icon.png"'), out);
out = fromDocs.render('![a](https://example.com/x.png)\n');
assert.ok(out.includes('src="https://example.com/x.png"'), out);
out = fromDocs.render('![a](nope.png)\n');
assert.ok(out.includes('src="nope.png"'), out);

// 行内 HTML 与多图同块也要覆盖
out = fromDocs.render('前 <img src="media/icon.png"> 后 <img src="local.png">\n');
assert.strictEqual((out.match(/data:image\/png;base64,/g) || []).length, 2, out);

console.log('asset-src: ok');