#!/usr/bin/env node
'use strict';

// 把 Desktop app plugin 组装到侧载目录。
// 用法：node tools/build-desktop-plugin.mjs [目标目录]
// 默认目标：~/.qoder-cn/app/dev-extensions/obsidian-md

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const target = path.resolve(process.argv[2] || path.join(os.homedir(), '.qoder-cn', 'app', 'dev-extensions', 'obsidian-md'));

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) { copyDir(src, dest); }
    else if (entry.isFile()) { fs.copyFileSync(src, dest); }
  }
}

// 视图在 Shadow DOM 里，body 选择器匹配不到，全部改写到视图根元素。
function scopeCss(css) {
  let count = 0;
  const scoped = css.replace(/(^|[\s,}])body(?![\w-])/gm, (match, lead) => {
    count++;
    return lead + '.om-preview';
  });
  return { scoped, count };
}

const pluginDir = path.join(target, '.qoder-app-plugin');
const nodeDir = path.join(target, 'dist', 'node');
const browserDir = path.join(target, 'dist', 'browser');
fs.mkdirSync(pluginDir, { recursive: true });
fs.mkdirSync(nodeDir, { recursive: true });
fs.mkdirSync(browserDir, { recursive: true });

fs.copyFileSync(path.join(ROOT, 'desktop', 'plugin.json'), path.join(pluginDir, 'plugin.json'));
fs.copyFileSync(path.join(ROOT, 'desktop', 'node-main.cjs'), path.join(nodeDir, 'main.cjs'));
copyDir(path.join(ROOT, 'src'), path.join(nodeDir, 'src'));
copyDir(path.join(ROOT, 'node_modules'), path.join(target, 'node_modules'));

const { scoped, count } = scopeCss(fs.readFileSync(path.join(ROOT, 'media', 'obsidian.css'), 'utf8'));
const css = fs.readFileSync(path.join(ROOT, 'desktop', 'theme.css'), 'utf8') + '\n' + scoped;
const view = fs.readFileSync(path.join(ROOT, 'desktop', 'browser-view.cjs'), 'utf8');
if (!view.includes("'__OM_STYLES__'")) { throw new Error('browser-view.cjs 缺少 __OM_STYLES__ 占位符'); }
fs.writeFileSync(path.join(browserDir, 'view.cjs'), view.replace("'__OM_STYLES__'", JSON.stringify(css)));

const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
console.log('目标目录: ' + target);
console.log('插件: ' + manifest.id + '@' + manifest.version);
console.log('body 选择器改写: ' + count + ' 处');
console.log('样式: ' + css.length + ' 字节');
console.log('\n启动（需要新进程，环境变量只在启动时读取）:');
console.log('  QODER_APP_PLUGIN_ALLOW_UNVERIFIED=true \\');
console.log('  QODER_APP_PLUGIN_DEV_DIRS="' + target + '" \\');
console.log('  open -na "Qoder CN"');