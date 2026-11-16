'use strict';

// Obsidian callout:  > [!type|-|+] metadata/title
// DOM mirrors Obsidian so the ported CSS applies unchanged:
//   <div|details class="callout is-collapsible" data-callout data-callout-metadata>
//     <div|summary class="callout-title">
//       <div class="callout-icon"><svg/></div>
//       <div class="callout-title-inner">title</div>
//       <div class="callout-fold"><svg/></div>   (collapsible only)
//     <div class="callout-content">…body…</div>
// 包裹层不可省：Obsidian 始终输出 callout-content，移植 CSS 的 metadata grid
// 靠 > .callout-content 占整行，少了它正文段落会掉进 grid 自动排版。

const HEADER_RE = /^\[!(\w+)([+-]?)(?:\\?\|([^\]]*))?\]([+-]?)[ \t]*(.*)$/;

const ALIASES = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  attention: 'warning',
  caution: 'warning',
  error: 'danger',
  fail: 'failure',
  failing: 'failure',
  missing: 'failure',
  ok: 'success',
  check: 'success',
  done: 'success',
  faq: 'question',
  help: 'question',
  cite: 'quote'
};

const DEFAULT_TITLES = {
  note: 'Note',
  abstract: 'Summary',
  info: 'Info',
  todo: 'Todo',
  tip: 'Tip',
  success: 'Success',
  question: 'Question',
  warning: 'Warning',
  failure: 'Failure',
  danger: 'Danger',
  bug: 'Bug',
  example: 'Example',
  quote: 'Quote',
  codex: 'Codex',
  claude: 'Claude',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  user: 'User',
  script: 'Script'
};

const ICONS = {
  note: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  abstract: '<path d="M9 4h6v3H9z"/><path d="M7 4H5v16h14V4h-2"/><path d="M8 11h8M8 15h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  todo: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  tip: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.2.9 2.1h5.2c0-.9.3-1.6.9-2.1A6 6 0 0 0 12 3Z"/>',
  success: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.5L16 9.5"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 0 1 4.4.9c.3 1.4-1 1.9-1.6 2.6-.4.5-.3 1-.3 1.5M12 17h.01"/>',
  warning: '<path d="M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15A2 2 0 0 0 21.2 17.5L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4.5M12 17.5h.01"/>',
  failure: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  danger: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
  bug: '<path d="M8 6a4 4 0 0 1 8 0v3H8Z"/><rect x="6" y="8" width="12" height="11" rx="5"/><path d="M3 12h3M18 12h3M4 19l2.5-2M20 19l-2.5-2"/>',
  example: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M7 9h6M7 13h4"/><path d="m15 20 2-3h-4Z"/>',
  quote: '<path d="M9 7H5v5h4c0 3-1.5 4.5-4 5"/><path d="M19 7h-4v5h4c0 3-1.5 4.5-4 5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  script: '<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="m6.5 9 2.5 2.5L6.5 14M11.5 14h6"/>',
  codex: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  claude: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  deepseek: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  qwen: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  kimi: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  minimax: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'
};

const CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="6 9 12 15 18 9"/></svg>';

function resolveType(rawType) {
  const lower = rawType.toLowerCase();
  if (ALIASES[lower]) { return ALIASES[lower]; }
  // Obsidian 对未知类型也按提示块渲染（用默认图标），自定义类型很常见，
  // 例如 [!qoder]、[!conclusion]，不能退回普通引用。
  return lower;
}

function svgIcon(name) {
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (ICONS[name] || ICONS.note) + '</svg>';
}

module.exports = function obsidianCallout(md) {
  md.core.ruler.after('inline', 'obsidian_callout', (state) => {
    const Token = state.Token;

    const html = (markup) => Object.assign(new Token('html_block', '', 0), { content: markup });
    const el = (type, tag, attrs) => Object.assign(new Token(type, tag, 1), { attrs: attrs || [] });
    const end = (type, tag) => new Token(type, tag, -1);
    const parseInline = (src, out) => md.inline.parse(src, md, state.env, out);

    const findClose = (tokens, start) => {
      let depth = 0;
      for (let j = start; j < tokens.length; j++) {
        depth += tokens[j].nesting;
        if (depth <= 0 && tokens[j].nesting === -1) { return j; }
      }
      return -1;
    };

    const readHeader = (tokens, start) => {
      const paraOpen = tokens[start + 1];
      const inlineToken = tokens[start + 2];
      if (!paraOpen || paraOpen.type !== 'paragraph_open') { return null; }
      if (!inlineToken || inlineToken.type !== 'inline') { return null; }

      const firstLine = inlineToken.content.split('\n', 1)[0];
      const m = HEADER_RE.exec(firstLine.trim());
      if (!m) { return null; }

      const kind = resolveType(m[1]);

      const metadata = (m[3] || '').trim();
      const title = m[5].trim();
      return {
        kind,
        fold: m[2] || m[4],
        metadata,
        title: title || (DEFAULT_TITLES[kind] || m[1]),
        titleIsLiteral: !title,
        inlineToken,
        body: inlineToken.content.slice(firstLine.length)
      };
    };

    const titleTokens = (header, foldable) => {
      const inner = [
        el('obsidian_callout_icon_open', 'div', [['class', 'callout-icon']]),
        html(svgIcon(header.kind)),
        end('obsidian_callout_icon_close', 'div'),
        el('obsidian_callout_title_inner_open', 'div', [['class', 'callout-title-inner']]),
        Object.assign(new Token('inline', '', 0), {
          content: header.title,
          children: header.titleIsLiteral
            ? [Object.assign(new Token('text', '', 0), { content: header.title })]
            : (() => { const out = []; parseInline(header.title, out); return out; })()
        }),
        end('obsidian_callout_title_inner_close', 'div')
      ];

      if (foldable) {
        inner.push(
          el('obsidian_callout_fold_open', 'div', [['class', 'callout-fold']]),
          html(CHEVRON),
          end('obsidian_callout_fold_close', 'div')
        );
      }

      const titleTag = foldable ? 'summary' : 'div';
      const titleType = foldable ? 'obsidian_callout_summary' : 'obsidian_callout_title';
      return [
        el(titleType + '_open', titleTag, [['class', 'callout-title']]),
        ...inner,
        end(titleType + '_close', titleTag)
      ];
    };

    const rewrite = (tokens) => {
      const out = [];

      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].type !== 'blockquote_open') {
          out.push(tokens[i]);
          continue;
        }

        const header = readHeader(tokens, i);
        const closeIdx = header ? findClose(tokens, i) : -1;
        if (!header || closeIdx <= i) {
          out.push(tokens[i]);
          continue;
        }

        const foldable = header.fold === '-' || header.fold === '+';
        const attrs = [['class', 'callout' + (foldable ? ' is-collapsible' : '')],
          ['data-callout', header.kind]];
        if (header.metadata) { attrs.push(['data-callout-metadata', header.metadata]); }

        let body = tokens.slice(i + 1, closeIdx);
        if (header.body.trim()) {
          header.inlineToken.content = header.body.replace(/^\n+/, '');
          header.inlineToken.children = [];
          parseInline(header.inlineToken.content, header.inlineToken.children);
        } else {
          body = body.slice(3); // drop the header-only paragraph
        }
        body = rewrite(body);

        const container = el('obsidian_callout_open', foldable ? 'details' : 'div', attrs);
        if (foldable && header.fold === '+') { container.attrPush(['open', 'open']); }
        const containerClose = end('obsidian_callout_close', foldable ? 'details' : 'div');

        out.push(container, ...titleTokens(header, foldable));
        out.push(
          el('obsidian_callout_content_open', 'div', [['class', 'callout-content']]),
          ...body,
          end('obsidian_callout_content_close', 'div'),
          containerClose
        );

        i = closeIdx;
      }

      return out;
    };

    state.tokens = rewrite(state.tokens);
  });
};
