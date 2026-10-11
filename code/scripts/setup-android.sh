#!/usr/bin/env bash
# 安卓环境准备脚本。
#
# 与 check-android.sh 的分工：
#   check-android.sh  —— **只检查**，用于 CI 与构建前置门禁，不产生任何副作用
#   setup-android.sh  —— **能自动化的就自动化，不能的打印出来**（本脚本）
#
# 为什么不是全自动：Android SDK / NDK 的安装涉及 GUI 安装程序与授权确认，
# 必须由本机所有者操作，脚本只能把「可脚本化的部分」做掉、把「必须手动的部分」
# 讲清楚。对应文档：docs/04-环境准备与M0前置检查.md
#
# 幂等：重复执行不会破坏已就绪的环境。
set -uo pipefail

cd "$(dirname "$0")/.."

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# 本项目钉死的 NDK 版本。不同 NDK 的链接行为不一致，
# 团队与 CI 必须统一，所以在这里把主版本写死供人工核对。
NDK_PINNED_MAJOR="27.2"

# ─────────────────────────────────────────────────────────────
# 第一步：可自动化的部分 —— Rust 交叉编译目标
# ─────────────────────────────────────────────────────────────
step "补装 Rust 交叉编译目标"

TARGETS=(aarch64-linux-android x86_64-linux-android)
if ! command -v rustup >/dev/null 2>&1; then
  bad "未找到 rustup，无法自动补装交叉编译目标"
  echo "     请先安装 Rust 工具链：https://rustup.rs"
else
  installed="$(rustup target list --installed 2>/dev/null || true)"
  for t in "${TARGETS[@]}"; do
    if printf '%s\n' "$installed" | grep -qx "$t"; then
      ok "$t 已安装"
    else
      echo "  → 正在安装 $t …"
      if rustup target add "$t"; then
        ok "$t 安装完成"
      else
        bad "$t 安装失败（检查网络或 rustup 镜像配置）"
      fi
    fi
  done
fi

# ─────────────────────────────────────────────────────────────
# 第二步：检测剩余的手动项
# ─────────────────────────────────────────────────────────────
step "检测需手动安装的组件"

manual=0

if command -v java >/dev/null 2>&1; then
  ok "$(java -version 2>&1 | head -1)"
else
  bad "JDK 未安装（Tauri 安卓构建要求 JDK 17+）"; manual=$((manual + 1))
fi

if [ -n "${ANDROID_HOME:-}" ] && [ -d "${ANDROID_HOME}" ]; then
  ok "ANDROID_HOME=$ANDROID_HOME"
else
  bad "ANDROID_HOME 未设置或目录不存在"; manual=$((manual + 1))
fi

ndk_ok=0
if [ -n "${ANDROID_NDK_HOME:-}" ] && [ -d "${ANDROID_NDK_HOME}" ]; then
  ok "ANDROID_NDK_HOME=$ANDROID_NDK_HOME"
  case "$(basename "$ANDROID_NDK_HOME")" in
    "$NDK_PINNED_MAJOR"*) ndk_ok=1 ;;
    *) warn "NDK 版本与钉死的 $NDK_PINNED_MAJOR.x 不一致：$(basename "$ANDROID_NDK_HOME")" ;;
  esac
else
  bad "ANDROID_NDK_HOME 未设置或目录不存在"; manual=$((manual + 1))
fi

if command -v adb >/dev/null 2>&1; then
  ok "$(command -v adb)"
else
  bad "adb 未找到（来自 Android SDK Platform-Tools）"; manual=$((manual + 1))
fi

# ─────────────────────────────────────────────────────────────
# 结果
# ─────────────────────────────────────────────────────────────
if [ "$manual" -eq 0 ]; then
  step "安卓环境已就绪"
  echo "  下一步：npm run tauri android init   # 生成 src-tauri/gen/android/"
  echo "  或直接打包：./scripts/build-android.sh"
  exit 0
fi

cat <<EOF

────────────────────────────────────────────────────────────
还有 $manual 项需要你手动完成（涉及 GUI 安装程序与授权确认）：

  1. 安装 Android Studio（自带 SDK Manager）
     https://developer.android.com/studio

  2. 在 SDK Manager 里勾选安装：
       · Android SDK Platform          → 35
       · Android SDK Build-Tools       → 最新
       · NDK (Side by side)            → ${NDK_PINNED_MAJOR}.x（钉死具体版本，勿用 latest）
       · Android SDK Platform-Tools    → 最新（提供 adb）
       · Android SDK Command-line Tools→ 最新（提供 sdkmanager）
       · （可选）Android Emulator + 系统镜像 API 35 / x86_64

  3. 配置环境变量（Windows 建议写入**系统环境变量**，
     而不是只写在某个 shell 配置里 —— 否则从 IDE 或 Tauri CLI
     启动时可能读不到）：

       ANDROID_HOME      = %LOCALAPPDATA%\\Android\\Sdk
       ANDROID_NDK_HOME  = %ANDROID_HOME%\\ndk\\${NDK_PINNED_MAJOR}.<具体版本号>
       PATH             += %ANDROID_HOME%\\platform-tools
                           %ANDROID_HOME%\\cmdline-tools\\latest\\bin

  完成后重新运行本脚本，或运行 ./scripts/check-android.sh 自检。
────────────────────────────────────────────────────────────
EOF

exit 1
