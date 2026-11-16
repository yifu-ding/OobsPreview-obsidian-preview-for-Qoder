#!/bin/bash
# OobsPreview 启动器：带 Obsidian 预览插件启动 Qoder CN。
# 双击运行；若 Qoder CN 已在运行，会先询问是否退出并以预览模式重启。
# 注意：重启会关闭当前所有 Qoder CN 窗口（包括进行中的对话）。

APP="Qoder CN"
DEV_DIR="$HOME/.qoder-cn/app/dev-extensions/obsidian-md"

if [ ! -f "$DEV_DIR/.qoder-app-plugin/plugin.json" ]; then
  echo "错误：找不到预览插件构建产物：$DEV_DIR"
  echo "请先在项目目录运行 npm run desktop 构建。"
  read -r -p "按回车关闭…" _
  exit 1
fi

if pgrep -x "$APP" >/dev/null 2>&1; then
  echo "Qoder CN 正在运行。预览插件只在启动时加载，需要重启才能生效。"
  read -r -p "退出并以预览模式重启？(y/N) " ans
  case "$ans" in
    y|Y)
      osascript -e 'quit app "Qoder CN"'
      for _ in $(seq 1 30); do
        pgrep -x "$APP" >/dev/null 2>&1 || break
        sleep 0.5
      done
      if pgrep -x "$APP" >/dev/null 2>&1; then
        echo "Qoder CN 未能退出，请手动 Cmd+Q 后重试。"
        read -r -p "按回车关闭…" _
        exit 1
      fi
      ;;
    *)
      echo "已保留当前实例（若它不是预览模式启动的，预览不会生效）。"
      exit 0
      ;;
  esac
fi

export QODER_APP_PLUGIN_ALLOW_UNVERIFIED=true
export QODER_APP_PLUGIN_DEV_DIRS="$DEV_DIR"
open -na "$APP"
echo "已启动 Qoder CN（OobsPreview 预览已启用）。本窗口可以关闭。"