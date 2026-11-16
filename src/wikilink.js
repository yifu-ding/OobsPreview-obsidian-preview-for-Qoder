'use strict';

// Obsidian wikilinks: [[Note]], [[Note|alias]], [[Note#Heading]], [[Note#^block]],
// [[#Heading]], ![[image.png|300]], ![[Note#Heading]].
//
// Output reuses the engine's own tokens so its link/image post-processing still
// applies: notes become standard `link_open` (absolute path is turned into a path
// relative to the previewed document at render time, which is what makes
// "open the note in a preview and scroll to the heading" work), images become
// standard `image` tokens with a `file:` src, and note embeds become a block
// token whose renderer reads and re-parses the target file.

const path = require('path');
const { IMAGE_EXT, splitTarget, extractSection, stripFrontMatter } = require('./vault');

const OPEN = 0x5b; // '['
const BANG = 0x21; // '!'
const BACKSLASH = 0x5c;
const NEWLINE = 0x0a;

const EMBED_LINE_RE = /^!\[\[([^\]\n]*)\]\][ \t]*$/;
const SIZE_RE = /^(\d{1,5})(?:x(\d{1,5}))?$/;
const PUNCT = /[!-/:-@[-`{-~]/g;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugifyHeading(text) {
  return encodeURI(
    String(text).trim().toLowerCase().replace(PUNCT, '').replace(/\s+/g, '-')
  );
}

function extOf(fsPath) {
  return path.extname(String(fsPath)).toLowerCase();
}

function displayName(fsPath, anchor) {
  if (anchor) { return String(anchor).replace(/^\^/, ''); }
  return path.basename(String(fsPath), path.extname(String(fsPath)));
}

module.exports = function obsidianWikilink(md, ctx) {
  const options = ctx || {};
  const resolveNote = options.resolveNote || (() => null);
  const resolveAsset = options.resolveAsset || (() => null);
  const readText = options.readText || (() => null);
  const currentDocument = options.currentDocument || (() => null);
  const toUri = options.toUri || ((p) => 'file://' + String(p).split('/').map(encodeURI).join('/'));

  const docPathOf = (env) => (env && env.currentDocument && env.currentDocument.fsPath) || null;

  // ------------------------------------------------------------- target model
  function describe(inner, isEmbed) {
    const bar = inner.indexOf('|');
    // 表格里别名分隔符要写成 \|，去掉这个转义反斜杠
    const rawTarget = (bar === -1 ? inner : inner.slice(0, bar)).trim().replace(/\\$/, '');
    const { name, anchor } = splitTarget(rawTarget);

    // 尺寸段只对图片嵌入有意义：![[图.png|别名|300]]、![[图.png|300x200]]。
    // 笔记链接的 [[note|300]] 里 300 是别名，不是宽度。
    const segments = bar === -1 ? [] : inner.slice(bar + 1).split('|').map((s) => s.trim().replace(/\\$/, ''));
    let size = null;
    if (segments.length && IMAGE_EXT.has(extOf(name))) {
      size = SIZE_RE.exec(segments[segments.length - 1]);
      if (size) { segments.pop(); }
    }
    const alias = segments.join('|').trim();
    const from = currentDocument();

    const info = {
      name,
      anchor,
      alias,
      width: size ? size[1] : null,
      height: size && size[2] ? size[2] : null,
      sameDoc: !name,
      kind: null,
      target: null,
      label: alias || (name ? displayName(name, anchor) : '')
    };

    if (name) {
      const note = resolveNote(name, from);
      const asset = resolveAsset(name, from);
      const preferAsset = extOf(name) !== '' && extOf(name) !== '.md' && extOf(name) !== '.markdown';

      if (asset && (preferAsset || !note)) {
        info.target = asset;
        info.kind = extIsImage(asset) ? 'image' : 'asset';
        if (!alias) { info.label = path.basename(asset); }
      } else if (note) {
        info.target = note;
        info.kind = 'note';
        if (!alias) { info.label = displayName(note, anchor); }
      } else {
        info.kind = 'unresolved';
        if (!alias) { info.label = rawTarget; }
      }
    } else {
      info.kind = isEmbed ? 'note' : 'self';
      info.label = info.label || (anchor ? anchor.replace(/^(\^|#)/, '') : '本页');
    }
    return info;
  }

  function extIsImage(fsPath) {
    return IMAGE_EXT.has(extOf(fsPath));
  }

  // ------------------------------------------------------------------- inline
  function findClose(src, from) {
    let i = from;
    while (i + 1 < src.length) {
      const code = src.charCodeAt(i);
      if (code === NEWLINE) { return -1; }
      if (code === OPEN && src.charCodeAt(i + 1) === OPEN) { return -1; }
      if (code === 0x5d && src.charCodeAt(i + 1) === 0x5d) { return i; }
      i++;
    }
    return -1;
  }

  function tokenize(state, silent) {
    const start = state.pos;
    let isEmbed = false;
    let cursor = start;

    if (state.src.charCodeAt(cursor) === BANG) {
      if (state.src.charCodeAt(cursor + 1) !== OPEN) { return false; }
      isEmbed = true;
      cursor++;
    }
    if (state.src.charCodeAt(cursor) !== OPEN || state.src.charCodeAt(cursor + 1) !== OPEN) {
      return false;
    }
    if (!isEmbed && start > 0 && state.src.charCodeAt(start - 1) === BACKSLASH) { return false; }

    const openEnd = cursor + 2;
    const close = findClose(state.src, openEnd);
    if (close === -1) { return false; }

    const inner = state.src.slice(openEnd, close);
    if (!inner.trim()) { return false; }
    state.pos = close + 2;
    if (silent) { return true; }

    const info = describe(inner, isEmbed);
    if (isEmbed) { emitEmbed(state, info); } else { emitLink(state, info); }
    return true;
  }

  function pushLabel(state, info) {
    const label = info.label || info.name || '本页';
    // 必须解析到全新数组：md.inline.parse 会清空它接收的 outTokens，
    // 直接传 state.tokens 会把父级已生成的 token（以及依赖它下标的分隔符）抹掉。
    const tokens = [];
    state.md.inline.parse(label, state.md, state.env, tokens);
    for (const token of tokens) { state.tokens.push(token); }
  }

  function emitLink(state, info) {
    const open = state.push('link_open', 'a', 1);
    open.attrs = [['class', info.kind === 'unresolved' ? 'internal-link is-unresolved' : 'internal-link']];
    open.meta = { obsidianWiki: info };
    pushLabel(state, info);
    state.push('link_close', 'a', -1);
  }

  function emitEmbed(state, info) {
    if (info.kind === 'image') {
      const token = state.push('image', 'img', 0);
      const altToken = new state.Token('text', '', 0);
      altToken.content = info.label;
      token.children = [altToken];
      token.attrs = [['src', toUri(info.target)]];
      if (info.width) { token.attrs.push(['width', info.width]); }
      if (info.height) { token.attrs.push(['height', info.height]); }
      token.attrs.push(['alt', '']);
      token.attrs.push(['class', 'internal-embed image-embed']);
      return;
    }
    if (info.kind === 'note' || info.kind === 'self') {
      // mixed into a line: a block embed cannot live inside <p>, so link instead
      emitLinkChip(state, info);
      return;
    }
    if (info.kind === 'asset') {
      emitLinkChip(state, info);
      return;
    }
    const span = state.push('html_inline', '', 0);
    span.content = `<span class="internal-embed is-unresolved">${escapeHtml(info.label || info.name)}</span>`;
    span.level = state.level;
  }

  function emitLinkChip(state, info) {
    const open = state.push('link_open', 'a', 1);
    open.attrs = [['class', 'internal-embed file-embed']];
    open.meta = { obsidianWiki: info };
    pushLabel(state, info);
    state.push('link_close', 'a', -1);
  }

  md.inline.ruler.before('link', 'obsidian_wikilink', tokenize);

  // ------------------------------------------------------------ block embeds
  md.block.ruler.before('paragraph', 'obsidian_embed_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (start >= max) { return false; }

    const match = EMBED_LINE_RE.exec(state.src.slice(start, max));
    if (!match) { return false; }

    const info = describe(match[1], true);
    if (info.kind === 'image' || info.kind === 'unresolved') { return false; }
    if (silent) { return true; }

    const token = state.push('obsidian_embed', '', 0);
    token.map = [startLine, startLine + 1];
    token.meta = { obsidianEmbed: info };
    state.line = startLine + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  // ------------------------------------------------------------------ hrefs
  function buildHref(info, env) {
    if (info.kind === 'unresolved') { return null; }

    if (info.sameDoc) {
      if (!docPathOf(env)) { return null; }
      if (!info.anchor) { return urlize('#', env); }
      const fragment = info.anchor.startsWith('^') ? info.anchor.slice(1) : slugifyHeading(info.anchor);
      return urlize('#' + fragment, env);
    }
    if (!info.target) { return null; }
    return urlize(pathToHref(docPathOf(env), info.target, info), env);
  }

  function pathToHref(docPath, target, info) {
    let base = target;
    if (docPath) {
      const relative = path.relative(path.dirname(docPath), target);
      if (relative && !path.isAbsolute(relative)) {
        base = relative.split(path.sep).join('/');
      }
    }
    if (!info.anchor) { return base; }
    // 块锚点的 id 不带 caret（见 src/blockid.js），href 要跟它一致
    const fragment = info.anchor.startsWith('^') ? info.anchor.slice(1) : info.anchor;
    return base + '#' + encodeURIComponent(fragment);
  }

  function urlize(href, env) {
    try {
      const normalized = md.normalizeLink(href);
      if (normalized && (md.validateLink(normalized) || href.startsWith('#'))) { return normalized; }
    } catch { /* fall through to the raw value */ }
    return href;
  }

  // ----------------------------------------------------------- renderer hooks
  const fallbackLinkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, idx, options_, env, self) => {
    const token = tokens[idx];
    const info = token.meta && token.meta.obsidianWiki;
    if (info) {
      const href = buildHref(info, env);
      token.attrSet('href', href === null ? '#' : href);
      token.attrSet('data-href', href === null ? '#' : href);
    }
    return fallbackLinkOpen
      ? fallbackLinkOpen(tokens, idx, options_, env, self)
      : self.renderToken(tokens, idx, options_);
  };

  md.renderer.rules.obsidian_embed = (tokens, idx, options_, env, self) => renderEmbed(tokens[idx], env, options_);

  function renderEmbed(token, env, renderOptions) {
    const info = token.meta && token.meta.obsidianEmbed;
    if (!info) { return ''; }

    const docPath = docPathOf(env);
    const source = info.sameDoc ? docPath : info.target;
    const label = escapeHtml(info.label || info.name || '嵌入');

    if (!source) {
      return `<div class="internal-embed is-unresolved">${label}</div>`;
    }
    if (info.kind === 'asset') {
      const href = buildHref(info, env);
      return `<div class="internal-embed file-embed"><a class="internal-link" href="${escapeHtml(href || '#')}" data-href="${escapeHtml(href || '#')}">${label}</a></div>`;
    }

    const seen = env.__obsidianEmbeds || (env.__obsidianEmbeds = new Set());
    const key = source + '::' + (info.anchor || '');
    if (seen.has(key)) {
      return `<div class="internal-embed is-circular">${label}</div>`;
    }

    const raw = readText(source);
    if (raw === null || raw === undefined) {
      return `<div class="internal-embed is-missing">${label}</div>`;
    }

    let section = stripFrontMatter(raw);
    if (info.anchor) { section = extractSection(section, info.anchor); }

    seen.add(key);
    let html;
    try {
      const innerTokens = md.parse(section, env);
      html = md.renderer.render(innerTokens, renderOptions, env);
    } catch (err) {
      html = `<div class="internal-embed is-error">${escapeHtml(String(err && err.message || err))}</div>`;
    } finally {
      seen.delete(key);
    }

    const href = escapeHtml(buildHref(info, env) || '#');
    const title = `<div class="embed-title"><a class="internal-link" href="${href}" data-href="${href}">${label}</a></div>`;
    return `<div class="internal-embed markdown-rendered" data-obsidian-embed="${escapeHtml(source)}">${title}${html}</div>`;
  }
};
