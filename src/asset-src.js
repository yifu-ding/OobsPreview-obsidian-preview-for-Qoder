'use strict';

const fs = require('fs');
const path = require('path');

const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.avif': 'image/avif'
};
const MAX_INLINE_BYTES = 8 * 1024 * 1024;

// 宿主只改写 markdown 图片 token 的资源路径，raw HTML 里的 <img src> 原样进 webview，
// 相对路径必裂；这里把相对 src 解析后内联成 data URI（先文档目录、再全库文件名）。
module.exports = function obsidianAssetSrc(md, ctx) {
  const options = ctx || {};
  const resolveAsset = options.resolveAsset || (() => null);
  const currentDocument = options.currentDocument || (() => null);
  const toUri = options.toUri || ((p) => 'file://' + p);

  const isRelative = (value) => !!value && !value.startsWith('#') &&
    !value.startsWith('//') && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);

  const decode = (value) => {
    try { return decodeURIComponent(value); } catch { return value; }
  };

  function locate(value, docDir) {
    const decoded = decode(value);
    if (docDir) {
      const direct = path.resolve(docDir, decoded);
      if (fs.existsSync(direct)) { return direct; }
    }
    return resolveAsset(decoded, currentDocument()) || null;
  }

  function inlineUri(fsPath) {
    const mime = IMAGE_MIME[path.extname(fsPath).toLowerCase()];
    if (!mime) { return null; }
    try {
      const stat = fs.statSync(fsPath);
      if (!stat.isFile() || stat.size > MAX_INLINE_BYTES) { return toUri(fsPath); }
      return 'data:' + mime + ';base64,' + fs.readFileSync(fsPath).toString('base64');
    } catch {
      return null;
    }
  }

  md.core.ruler.after('inline', 'obsidian_asset_src', (state) => {
    const doc = currentDocument();
    const docDir = doc ? path.dirname(doc) : null;

    const walk = (tokens) => {
      for (const token of tokens) {
        if (token.type === 'image') {
          const src = token.attrGet('src');
          if (!isRelative(src)) { continue; }
          if (docDir && fs.existsSync(path.resolve(docDir, decode(src)))) { continue; }
          const hit = locate(src, docDir);
          if (hit) { token.attrSet('src', toUri(hit)); }
        } else if (token.type === 'html_block' || token.type === 'html_inline') {
          token.content = token.content.replace(/<img\b[^>]*>/gi, (tag) => tag.replace(
            /(\bsrc\s*=\s*)(["'])([^"']*)\2/i,
            (match, lead, quote, value) => {
              if (!isRelative(value)) { return match; }
              const hit = locate(value, docDir);
              const uri = hit && inlineUri(hit);
              return uri ? lead + quote + uri + quote : match;
            }));
        }
        if (token.children) { walk(token.children); }
      }
    };
    walk(state.tokens);
  });
};