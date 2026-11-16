'use strict';

// Obsidian 注释 %%...%%：阅读视图里整段隐藏。
// 在 inline 规则之前做文本手术，跨行注释也能一次去掉；围栏代码不产生 inline token，
// 行内反引号由下面的扫描跳过。
function strip(text) {
  let out = '';
  let i = 0;

  while (i < text.length) {
    if (text[i] === '`') {
      const ticks = /^`+/.exec(text.slice(i))[0];
      const close = text.indexOf(ticks, i + ticks.length);
      if (close === -1) { out += text[i]; i++; continue; }
      out += text.slice(i, close + ticks.length);
      i = close + ticks.length;
      continue;
    }
    if (text.startsWith('%%', i)) {
      const end = text.indexOf('%%', i + 2);
      if (end === -1) { out += text[i]; i++; continue; }
      i = end + 2;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

module.exports = function obsidianComment(md) {
  // 块注释：整行以 %% 开头且本行未闭合时，一直吞到下一处以 %% 开头的行。
  // 表格等块级语法会先匹配到 `%%| …` 这一行，所以规则要排在最前。
  md.block.ruler.before('blockquote', 'obsidian_comment_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (state.src.charCodeAt(start) !== 0x25 || state.src.charCodeAt(start + 1) !== 0x25) {
      return false;
    }
    if (state.src.slice(start + 2, max).includes('%%')) { return false; }

    let nextLine = startLine + 1;
    while (nextLine < endLine) {
      const text = state.src
        .slice(state.bMarks[nextLine] + state.tShift[nextLine], state.eMarks[nextLine])
        .trim();
      if (text.startsWith('%%')) {
        if (silent) { return true; }
        state.line = nextLine + 1;
        return true;
      }
      nextLine++;
    }
    return false; // 没有闭合，按普通文本处理
  });

  md.core.ruler.before('inline', 'obsidian_comment', (state) => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== 'inline' || !token.content.includes('%%')) { continue; }

      const alone = strip(token.content).trim() === '';
      token.content = strip(token.content).replace(/[ \t]{2,}/g, ' ').trim();

      if (alone && tokens[i - 1] && tokens[i - 1].type === 'paragraph_open' &&
          tokens[i + 1] && tokens[i + 1].type === 'paragraph_close') {
        tokens[i - 1].hidden = true;
        token.content = '';
        tokens[i + 1].hidden = true;
      }
    }
  });
};
