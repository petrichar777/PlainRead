#!/usr/bin/env bash
# 构建安卓 APK。
#
# 前置：scripts/check-android.sh 必须全部通过。
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> 安卓环境自检"
./scripts/check-android.sh

if [ ! -d node_modules ]; then
  echo "==> 首次运行，安装前端依赖"
  npm install
fi

if [ ! -d src-tauri/gen/android ]; then
  echo "==> 首次构建，生成安卓工程"
  npm run tauri android init
fi

echo "==> 打包 APK"
npm run tauri android build -- --apk

echo
echo "完成。产物位于 src-tauri/gen/android/app/build/outputs/apk/"
