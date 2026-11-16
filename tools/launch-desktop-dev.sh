#!/bin/bash
# 用侧载环境变量启动 Qoder CN Desktop，加载本地 Obsidian Markdown 预览插件。
#
# 前提：必须先完全退出正在运行的 Qoder CN（Cmd+Q）。
# 应用有单实例锁，不退出就启动的话新进程会把请求转交给旧实例，环境变量不会生效。
#
# 用法：bash tools/launch-desktop-dev.sh

set -euo pipefail

APP="/Applications/Qoder CN.app/Contents/MacOS/Qoder CN"
PLUGIN_DIR="${1:-$HOME/.qoder-cn/app/dev-extensions/obsidian-md}"

if [ ! -x "$APP" ]; then
  echo "找不到 Qoder CN Desktop：$APP" >&2
  exit 1
fi

if [ ! -f "$PLUGIN_DIR/.qoder-app-plugin/plugin.json" ]; then
  echo "插件未构建：$PLUGIN_DIR" >&2
  echo "先跑 node tools/build-desktop-plugin.cjs" >&2
  exit 1
fi

if pgrep -f "Qoder CN.app/Contents/MacOS/Qoder CN" >/dev/null 2>&1; then
  echo "Qoder CN 仍在运行。请先 Cmd+Q 完全退出，再跑本脚本。" >&2
  echo "（单实例锁会让新进程把请求转交旧实例，环境变量不生效）" >&2
  exit 1
fi

echo "侧载插件：$PLUGIN_DIR"
exec env \
  QODER_APP_PLUGIN_ALLOW_UNVERIFIED=true \
  QODER_APP_PLUGIN_DEV_DIRS="$PLUGIN_DIR" \
  "$APP"