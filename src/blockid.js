'use strict';

// Obsidian 块 ID：行尾的 ` ^block-id` 在预览里不显示，只留一个可跳转的锚点；
// 独占一行的 `^block-id`（写在列表或引用后面那种）整段隐藏。
// 锚点 id 去掉 caret，[[笔记#^block-id]] 的 href 也同步去掉，这样 getElementById 能命中。

const ID = '[A-Za-z0-9-]+';
const TRAILING_RE = new RegExp('\\s\\^(' + ID + ')$');
const STANDALONE_RE = new RegExp('^\\^(' + ID + ')$');

function anchor(id, block) {
  const tag = block ? 'div' : 'span';
  return `<${tag} class="obsidian-block-anchor" id="${id}"></${tag}>`;
}

module.exports = function obsidianBlockId(md) {
  // 放在 tasklist 之后：它会重新解析任务行的 children，必须等它跑完
  md.core.ruler.after('obsidian_task_list', 'obsidian_block_id', (state) => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== 'inline' || !token.children || !token.children.length) { continue; }

      const children = token.children;
      const last = children[children.length - 1];
      if (last.type !== 'text') { continue; }

      // 整个 text token 就是 ^id：可能是独占一行，也可能是紧跟上一行的懒 continuation
      // （`> 引用\n^id` 会被 markdown-it 并进同一段落）
      const standalone = STANDALONE_RE.exec(last.content);
      if (standalone) {
        const id = standalone[1];
        const onlyChild = children.length === 1;
        children.pop();
        const prev = children[children.length - 1];
        if (prev && (prev.type === 'softbreak' || prev.type === 'hardbreak')) { children.pop(); }
        const html = new state.Token('html_inline', '', 0);
        html.content = anchor(id, onlyChild);
        children.push(html);
        if (onlyChild) { hideParagraph(tokens, i); }
        continue;
      }

      const trailing = TRAILING_RE.exec(last.content);
      if (!trailing) { continue; }

      last.content = last.content.slice(0, trailing.index);
      const html = new state.Token('html_inline', '', 0);
      html.content = anchor(trailing[1], false);
      children.push(html);
    }
  });
};

function hideParagraph(tokens, index) {
  for (let i = index - 1; i >= 0; i--) {
    if (tokens[i].type === 'paragraph_close') { return; }
    if (tokens[i].type === 'paragraph_open') { tokens[i].hidden = true; break; }
  }
  for (let i = index + 1; i < tokens.length; i++) {
    if (tokens[i].type === 'paragraph_open') { return; }
    if (tokens[i].type === 'paragraph_close') { tokens[i].hidden = true; return; }
  }
}