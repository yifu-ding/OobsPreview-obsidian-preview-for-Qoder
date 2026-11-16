'use strict';

// Obsidian `==text==` highlight -> <mark>text</mark>
// Follows the markdown-it delimiter pattern (same shape as markdown-it-ins).

const MARKER = 0x3d; // '='

function tokenize(state, silent) {
  const start = state.pos;

  if (silent) { return false; }
  if (state.src.charCodeAt(start) !== MARKER) { return false; }
  if (state.src.charCodeAt(start + 1) !== MARKER) { return false; }

  const scanned = state.scanDelims(start, true);
  let len = scanned.length;

  if (len < 2) { return false; }

  if (len % 2) {
    const token = state.push('text', '', 0);
    token.content = '=';
    len--;
  }

  if (len) {
    const token = state.push('text', '', 0);
    token.content = '==';
  }

  state.delimiters.push({
    marker: MARKER,
    length: 0, // skip the emphasis "rule of 3" length checks
    token: state.tokens.length - 1,
    end: -1,
    // Obsidian 的 ==高亮== 不看 CommonMark 的标点邻近规则，
    // 否则「说明，==文字==但」这类中文写法会退化成正文。
    open: true,
    close: true
  });

  state.pos += scanned.length;
  return true;
}

function postProcess(state, delimiters) {
  for (let i = 0; i < delimiters.length; i++) {
    const startDelim = delimiters[i];

    if (startDelim.marker !== MARKER) { continue; }
    if (startDelim.end === -1) { continue; }

    const endDelim = delimiters[startDelim.end];

    const open = state.tokens[startDelim.token];
    open.type = 'obsidian_mark_open';
    open.tag = 'mark';
    open.nesting = 1;
    open.markup = '==';
    open.content = '';

    const close = state.tokens[endDelim.token];
    close.type = 'obsidian_mark_close';
    close.tag = 'mark';
    close.nesting = -1;
    close.markup = '==';
    close.content = '';
  }
}

module.exports = function obsidianHighlight(md) {
  md.inline.ruler.before('emphasis', 'obsidian_mark', tokenize);

  md.inline.ruler2.before('emphasis', 'obsidian_mark', (state) => {
    postProcess(state, state.delimiters);

    for (let i = 0; i < state.tokens_meta.length; i++) {
      if (state.tokens_meta[i]) {
        postProcess(state, state.tokens_meta[i].delimiters);
      }
    }
  });
};
