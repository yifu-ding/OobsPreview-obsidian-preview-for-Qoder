'use strict';

// Obsidian Properties: render the YAML front matter that the preview engine
// otherwise drops. It registers `front_matter` as an html_block whose `.meta`
// carries the raw YAML between the `---` fences.

const yaml = require('js-yaml');

const SPECIAL_KEYS = ['tags', 'aliases', 'cssclasses'];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scalarText(value) {
  if (value === null || value === undefined || value === '') { return ''; }
  if (value === true) { return '✓'; }
  if (value === false) { return '✗'; }
  if (value instanceof Date) { return value.toISOString().slice(0, 10); }
  return String(value);
}

function renderValue(key, value, render) {
  const list = Array.isArray(value) ? value : [value];

  if (key === 'tags') {
    return list.map((tag) => `<a class="tag">#${escapeHtml(String(tag).replace(/^#/, ''))}</a>`).join('');
  }
  if (key === 'aliases' || key === 'cssclasses') {
    return list.map((item) => `<span class="frontmatter-plain">${render(scalarText(item))}</span>`).join('');
  }

  if (list.length === 1 && !Array.isArray(value)) {
    const single = list[0];
    if (single === null || typeof single !== 'object') {
      const text = scalarText(single);
      return text === '' ? '<span class="frontmatter-empty">空</span>' : `<span>${render(text)}</span>`;
    }
  }

  return `<ul class="frontmatter-list">${list.map((item) => `<li>${renderItem(item, render)}</li>`).join('')}</ul>`;
}

function renderItem(item, render) {
  if (item === null || item === undefined) { return ''; }
  if (Array.isArray(item)) {
    return `<ul class="frontmatter-list">${item.map((sub) => `<li>${renderItem(sub, render)}</li>`).join('')}</ul>`;
  }
  if (typeof item === 'object') {
    return `<ul class="frontmatter-kv">${Object.entries(item).map(
      ([k, v]) => `<li><b>${escapeHtml(k)}</b> ${renderItem(typeof v === 'object' && v !== null ? v : scalarText(v), render)}</li>`
    ).join('')}</ul>`;
  }
  return render(scalarText(item));
}

function renderProperties(yamlText, inline) {
  // 属性值里的 [[链接]]、#标签、==高亮== 在 Obsidian 里也是渲染的，不能只当纯文本转义
  const render = inline || escapeHtml;
  const text = (yamlText || '').trim();
  if (!text) { return ''; }

  let data;
  try {
    data = yaml.load(text);
  } catch (err) {
    return `<div class="frontmatter-container is-error" data-parse-error="${escapeHtml(err.message)}"><span>属性解析失败</span></div>`;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) { return ''; }

  const entries = Object.entries(data);
  if (!entries.length) { return ''; }

  const ordered = [
    ...entries.filter(([key]) => SPECIAL_KEYS.includes(key)),
    ...entries.filter(([key]) => !SPECIAL_KEYS.includes(key))
  ];

  const rows = ordered.map(([key, value]) =>
    '<tr class="frontmatter-property-container">' +
    `<td class="frontmatter-property-name"><span>${escapeHtml(key)}</span></td>` +
    `<td class="frontmatter-property-value">${renderValue(key, value, render)}</td>` +
    '</tr>'
  ).join('');

  return '<div class="frontmatter-container">' +
    '<div class="frontmatter-container-header">' +
    '<span>属性</span><span class="frontmatter-container-header-icon"></span></div>' +
    `<table class="frontmatter-properties-table"><tbody>${rows}</tbody></table>` +
    '</div>\n';
}

module.exports = function obsidianProperties(md) {
  md.renderer.rules.front_matter = (tokens, idx, options, env) =>
    renderProperties(tokens[idx].meta, (text) => md.renderInline(text, env));
};

module.exports.renderProperties = renderProperties;
