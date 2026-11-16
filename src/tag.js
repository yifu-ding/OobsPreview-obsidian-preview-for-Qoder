'use strict';

// Obsidian 行内标签 #tag → <a class="tag">#tag</a>，与属性区里的标签共用一套样式。
// 规则同 Obsidian：行首或空白后开始，可含字母、数字、下划线、连字符、斜杠和非 ASCII 字符，
// 且至少有一个非数字字符（#1984 不算标签），不以连字符或斜杠结尾。

const TAG_START = 0x23; // '#'

function isTagChar(code) {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) || code === 0x5f || code === 0x2d || code === 0x2f ||
    (code >= 0x80 && !isPunctuation(code));
}

// 中文、日韩标点与全角符号不算标签字符（“#tag，说明” 应在逗号处断开）
function isPunctuation(code) {
  return (code >= 0x2000 && code <= 0x206f) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xfe10 && code <= 0xff65) ||
    (code >= 0xff90 && code <= 0xffdf) ||
    (code >= 0x2e00 && code <= 0x2e7f);
}

module.exports = function obsidianTag(md) {
  md.inline.ruler.before('link', 'obsidian_tag', (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== TAG_START) { return false; }

    const before = start > 0 ? state.src.charAt(start - 1) : ' ';
    if (!/\s/.test(before)) { return false; }

    let pos = start + 1;
    while (pos < state.posMax && isTagChar(state.src.charCodeAt(pos))) { pos++; }
    while (pos > start + 1 && /[-/]/u.test(state.src.charAt(pos - 1))) { pos--; }

    const body = state.src.slice(start + 1, pos);
    if (!body || /^[\d_]+$/.test(body)) { return false; }

    if (!silent) {
      state.push('obsidian_tag_open', 'a', 1);
      state.push('text', '', 0).content = state.src.slice(start, pos);
      state.push('obsidian_tag_close', 'a', -1);
    }
    state.pos = pos;
    return true;
  });

  md.renderer.rules.obsidian_tag_open = () => '<a class="tag">';
  md.renderer.rules.obsidian_tag_close = () => '</a>';
};

module.exports.isTagChar = isTagChar;
