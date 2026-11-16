'use strict';

// 回归：宿主单次 app-plugin RPC 响应有字符上限（APP_PLUGIN_RPC_CHARACTER_LIMIT_EXCEEDED）。
// render 响应只能带占位符，图片字节必须经 assetChunk 分块取回且每块不超上限。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const NOTE = path.join(ROOT, 'README.md');

// node-main 按部署布局 require('./src/…')，这里在临时目录搭出 dist/node 结构再加载。
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'om-rpc-'));
process.on('exit', () => { try { fs.rmSync(stage, { recursive: true, force: true }); } catch {} });
fs.mkdirSync(path.join(stage, 'dist', 'node'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'desktop', 'node-main.cjs'), path.join(stage, 'dist', 'node', 'main.cjs'));
fs.symlinkSync(path.join(ROOT, 'src'), path.join(stage, 'dist', 'node', 'src'), 'dir');
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(stage, 'node_modules'), 'dir');
const { renderFile, assetChunk, ASSET_CHUNK_CHARS } = require(path.join(stage, 'dist', 'node', 'main.cjs'));

function unescapeAttr(value) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

const rendered = renderFile(NOTE);
const refs = Array.from(rendered.html.matchAll(/data-om-img="([^"]*)"/g)).map((m) => unescapeAttr(m[1]));
assert.ok(refs.length >= 13, 'README 的本地图片应全部变成占位符引用');
assert.ok(!/src="data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]{1000,}/.test(rendered.html),
  'render 响应里不允许再内联大 base64');
assert.ok(rendered.html.length < 200000, 'render 响应本身必须保持小体积: ' + rendered.html.length);

let totalChars = 0;
for (const ref of refs) {
  const expected = fs.readFileSync(ref).toString('base64');
  const parts = [];
  let offset = 0;
  let mime = null;
  for (;;) {
    const chunk = assetChunk({ note: NOTE, path: ref, offset });
    assert.ok(chunk.data.length <= ASSET_CHUNK_CHARS, '单块字符数超上限');
    assert.ok(JSON.stringify(chunk).length < 100000, '单块 RPC 响应过大');
    assert.strictEqual(chunk.offset, offset);
    mime = chunk.mime;
    parts.push(chunk.data);
    totalChars += chunk.data.length;
    if (chunk.next == null) { break; }
    assert.ok(chunk.next > offset, 'offset 必须前进');
    offset = chunk.next;
  }
  assert.strictEqual(parts.join(''), expected, '分块拼回后必须与原图 base64 一致: ' + ref);
  assert.ok(mime.startsWith('image/'));
}
assert.ok(totalChars > 1000000, '用例应覆盖到超百万字符的图片总量');

// 越界与安全校验
assert.throws(() => assetChunk({ note: NOTE, path: refs[0], offset: 10 ** 12 }), /OBSIDIAN_MD_ASSET_OFFSET/);
const outside = path.join(os.tmpdir(), 'om-outside-' + Date.now() + '.png');
fs.writeFileSync(outside, Buffer.from('89504e470d0a1a0a', 'hex'));
try {
  assert.throws(() => assetChunk({ note: NOTE, path: outside, offset: 0 }), /OBSIDIAN_MD_ASSET_DENIED/);
} finally {
  fs.unlinkSync(outside);
}
assert.throws(() => assetChunk({ note: NOTE, path: '/etc/passwd', offset: 0 }), /OBSIDIAN_MD_ASSET_DENIED/);

console.log('desktop-rpc: ok (' + refs.length + ' images, ' + totalChars + ' base64 chars chunked)');