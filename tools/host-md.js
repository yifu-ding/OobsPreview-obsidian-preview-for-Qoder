'use strict';

// 离线还原宿主的 markdown 管线：VS Code / Qoder CN IDE 的 markdown 引擎会在
// 第三方插件之外自己注册 front_matter 块规则，properties.js 只负责渲染它。
// 审计与样例核对都必须带上这条规则，否则 frontmatter 相关检查是空转。

const path = require('path');
const MarkdownIt = require('markdown-it');

const ROOT = path.join(__dirname, '..');
const SRC = (name) => require(path.join(ROOT, 'src', name));

function frontMatterRule(md) {
  md.block.ruler.before('hr', 'front_matter', (state, startLine, endLine, silent) => {
    if (startLine !== 0) { return false; }

    const open = state.src.slice(state.bMarks[0] + state.tShift[0], state.eMarks[0]).trim();
    if (open !== '---') { return false; }

    for (let line = 1; line < endLine; line++) {
      const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trim();
      if (text !== '---' && text !== '...') { continue; }
      if (silent) { return true; }

      const token = state.push('front_matter', '', 0);
      token.hidden = true;
      token.map = [0, line + 1];
      token.meta = state.src.slice(state.eMarks[0] + 1, state.bMarks[line] + state.tShift[line]);
      state.line = line + 1;
      return true;
    }
    return false;
  });
}

function createHostMarkdown(ctx) {
  const md = new MarkdownIt({ html: true, linkify: true });
  frontMatterRule(md);
  return md
    .use(require('markdown-it-footnote'))
    .use(SRC('highlight'))
    .use(SRC('comment'))
    .use(SRC('tag'))
    .use(SRC('callout'))
    .use(SRC('tasklist'))
    .use(SRC('blockid'))
    .use(SRC('properties'))
    .use(SRC('wikilink'), ctx);
}

module.exports = { createHostMarkdown, frontMatterRule };