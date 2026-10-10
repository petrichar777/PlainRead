#!/usr/bin/env bash
# 安卓环境自检脚本。
#
# 这个脚本**只检查、不安装**。安卓 SDK 的安装涉及 GUI 安装程序与授权确认，
# 必须由本机所有者操作。
#
# 对应文档：docs/04-环境准备与M0前置检查.md
set -uo pipefail

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

missing=0
note_missing() { missing=$((missing + 1)); }

echo "==> 检查 JDK"
if command -v java >/dev/null 2>&1; then
  java_ver="$(java -version 2>&1 | head -1)"
  ok "$java_ver"
else
  bad "未找到 java（Tauri 安卓构建需要 JDK 17+）"; note_missing
fi

echo "==> 检查 Android SDK"
if [ -n "${ANDROID_HOME:-}" ] && [ -d "${ANDROID_HOME}" ]; then
  ok "ANDROID_HOME=$ANDROID_HOME"
else
  bad "ANDROID_HOME 未设置或目录不存在"; note_missing
fi

echo "==> 检查 Android NDK"
if [ -n "${ANDROID_NDK_HOME:-}" ] && [ -d "${ANDROID_NDK_HOME}" ]; then
  ok "ANDROID_NDK_HOME=$ANDROID_NDK_HOME"
else
  bad "ANDROID_NDK_HOME 未设置或目录不存在"; note_missing
fi

echo "==> 检查 adb"
if command -v adb >/dev/null 2>&1; then
  ok "$(command -v adb)"
else
  bad "未找到 adb（来自 Android SDK Platform-Tools）"; note_missing
fi

echo "==> 检查 Rust 交叉编译目标"
installed_targets="$(rustup target list --installed 2>/dev/null || true)"
for t in aarch64-linux-android x86_64-linux-android; do
  if printf '%s\n' "$installed_targets" | grep -qx "$t"; then
    ok "$t"
  else
    bad "$t 未安装"; note_missing
  fi
done

echo
if [ "$missing" -eq 0 ]; then
  echo "安卓环境已就绪，可以执行："
  echo "  npm run tauri android dev"
else
  echo "还缺 $missing 项。安装步骤见 docs/04-环境准备与M0前置检查.md"
  echo
  echo "快速补 Rust 目标："
  echo "  rustup target add aarch64-linux-android x86_64-linux-android"
  exit 1
fi
