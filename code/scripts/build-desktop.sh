#!/usr/bin/env bash
# 构建桌面端发布产物。
#
# 产物位置：src-tauri/target/release/plainread.exe
#          src-tauri/target/release/bundle/   （安装包，视平台）
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "==> 首次运行，安装前端依赖"
  npm install
fi

# 先单独校验类型与契约，失败就早退——
# 比等到 Tauri 打包完再报错省几分钟。
echo "==> 校验 IPC 契约（Rust 侧生成 TS 绑定）"
cargo test -p plainread --manifest-path src-tauri/Cargo.toml --quiet

echo "==> 前端类型检查"
npm run typecheck

echo "==> 打包"
npm run tauri build

echo
echo "完成。产物位于 src-tauri/target/release/"
