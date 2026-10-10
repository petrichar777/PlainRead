#!/usr/bin/env bash
# 启动桌面开发环境（热重载）。
#
# 首次运行会编译整个 Tauri 依赖树，约 5–15 分钟；之后是增量编译。
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> 检查工具链"
command -v cargo >/dev/null || { echo "错误：未找到 cargo"; exit 1; }
command -v node  >/dev/null || { echo "错误：未找到 node";  exit 1; }

if [ ! -d node_modules ]; then
  echo "==> 首次运行，安装前端依赖"
  npm install
fi

echo "==> 启动 Tauri 开发模式"
npm run tauri dev
