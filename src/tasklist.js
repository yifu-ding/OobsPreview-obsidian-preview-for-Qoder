'use strict';

// Obsidian / Tasks style task markers: - [?], - [/], - [!], - [S], - [M] ...
// markdown-it has no task-list support in this preview, so every marker is
// turned into Obsidian's DOM:
//   <li class="task-list-item" data-task="?"><input class="task-list-item-checkbox" ...>rest

const MARKER_RE = /^ ?\[([^\][\n])\](?:[ \t]|\n|$)/;

module.exports = function obsidianTaskList(md) {
  md.core.ruler.after('obsidian_callout', 'obsidian_task_list', (state) => {
    const Token = state.Token;
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'list_item_open') { continue; }

      // tight lists put `inline` straight after the item; loose ones wrap it in a paragraph
      let inline = tokens[i + 1];
      let inlineIndex = i + 1;
      if (inline && inline.type === 'paragraph_open') {
        inline = tokens[i + 2];
        inlineIndex = i + 2;
      }
      if (!inline || inline.type !== 'inline') { continue; }

      const match = MARKER_RE.exec(inline.content);
      if (!match) { continue; }

      const marker = match[1];
      const checked = marker === 'x' || marker === 'X';
      const task = marker === ' ' ? ' ' : marker;

      tokens[i].attrSet('class', 'task-list-item');
      tokens[i].attrSet('data-task', task);

      inline.content = inline.content.slice(match[0].length);
      inline.children = [];
      md.inline.parse(inline.content, md, state.env, inline.children);

      const input = new Token('html_inline', '', 0);
      input.content = '<input type="checkbox" class="task-list-item-checkbox" data-task="' +
        escapeAttr(task) + '"' + (checked ? ' checked' : '') + ' disabled>';
      tokens.splice(inlineIndex, 0, input);
      i = inlineIndex + 1;
    }
  });
};

function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
