# 简阅 · PlainRead — 工程根

这是 `PlainRead` 的代码目录。项目整体介绍见 [上级 README](../README.md)，设计与决策记录见 [`../docs/`](../docs/README.md)。

---

## 三层结构

```
code/
├─ Cargo.toml              ★ workspace 根（虚拟清单，聚合下面两个 Rust 成员）
├─ src/                    前端（HTML / TypeScript / React）—— 可整体替换
│  ├─ ipc/bindings.ts      ★ 由 tauri-specta 从 Rust 自动生成，勿手改
│  ├─ styles/main.css      设计令牌（CSS 变量）+ Tailwind 入口
│  └─ App.tsx              M0 链路自检页（M1 起被书架页取代）
├─ src-tauri/              外壳：Tauri 2，桌面与移动共用
│  └─ src/
│     ├─ commands/         ★ IPC 的唯一出口（唯一能写逻辑的地方也很少）
│     ├─ ipc/              DTO 与「内核类型 → DTO」映射
│     ├─ error.rs          统一错误类型（带机器可读分类）
│     └─ lib.rs            契约登记 + 应用装配
├─ crates/reader-core/     内核：领域 / 编码 / 切章 / 存储 / 导入管线
└─ target/                 构建产物（workspace 级，**在根目录而非 src-tauri/**）
```

**依赖方向是单向的**：`src`（前端）→ `src-tauri`（外壳）→ `reader-core`（内核）。
内核**不依赖任何 UI 框架**（依赖树里不能出现 tauri / egui / web），
这样它才能在没有窗口、没有 GPU 的环境里被完整单元测试，也才能在换 UI 技术栈时一行不改。

> **两个 workspace 相关的坑**（见 [docs/adr/ADR-005](../../docs/adr/ADR-005-采用Cargo工作区与工程落盘固定盘.md)）：
> ① `target/` 在 `code/` 下，**不是** `src-tauri/target/`；
> ② `[profile.release]` 必须写在根 `Cargo.toml`，写在成员清单里会被 cargo **静默忽略**。

---

## 环境要求

| 组件 | 版本 | 用途 |
|---|---|---|
| Rust | 1.77+（本机 1.97.1） | 内核与外壳 |
| Visual Studio 2022（含 MSVC） | — | Windows 链接器 |
| Node.js | 20+（本机 22.22.2） | 前端构建 |
| WebView2 Runtime | — | 桌面端 WebView（Win10/11 通常已内置） |

安卓构建还需 JDK 17+ / Android SDK 35 / NDK 27.2.x / adb，
执行 `./scripts/setup-android.sh` 可获得逐项指引。

---

## 常用命令

前端（在 `code/` 下）：

| 命令 | 作用 |
|---|---|
| `npm install` | 安装前端依赖 |
| `npm run tauri dev` | 启动桌面开发模式（热重载） |
| `npm run gen:bindings` | 重新生成 `src/ipc/bindings.ts`（改了 Rust 命令后必跑） |
| `npm run typecheck` | `tsc --noEmit` 类型检查 |
| `npm run build` | 生成绑定 → 类型检查 → 产出 `dist/` |

内核与外壳（Rust，在 `code/` 下 —— workspace 根，无需 `--manifest-path`）：

| 命令 | 作用 |
|---|---|
| `cargo test -p reader-core` | 跑内核全部单测（含两条不变式的守卫测试） |
| `cargo test -p plainread --lib` | 跑外壳测试，并**顺带重新生成前端绑定** |
| `cargo test --workspace` | 一次跑完两个成员 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 静态检查（CI 门禁） |
| `cargo fmt --all` | 格式化 |

脚本（`scripts/`）：

| 脚本 | 作用 |
|---|---|
| `dev-desktop.sh` | 检查工具链后启动桌面开发模式 |
| `build-desktop.sh` | 契约校验 → 类型检查 → 打包桌面产物 |
| `check-android.sh` | 安卓环境自检（只读，无副作用；可用于 CI 门禁） |
| `setup-android.sh` | 安卓环境准备（自动补 Rust 目标 + 打印手动步骤） |
| `build-android.sh` | 生成安卓工程 → 打包 APK |

> Windows 上用 Git Bash 执行，例如 `./scripts/setup-android.sh`。

---

## IPC 契约工作流（重要）

前后端的类型安全靠 **tauri-specta** 自动生成，不靠手写：

1. 在 `src-tauri/src/commands/` 写好命令，并在 `src-tauri/src/lib.rs` 的
   `specta_builder()` 里**登记一次**；
2. 运行 `npm run gen:bindings`（或任意一次 `cargo test`，或启动 `npm run tauri dev`）；
3. `src/ipc/bindings.ts` 更新 —— 前端立刻获得带类型的 `commands.xxx()` 调用封装。

**因此有一条硬规矩**：改动了任何命令的签名或返回结构后，
必须重新生成绑定并确认 `npm run typecheck` 通过。
绑定文件是**生成物但需要提交**——`cargo test` 会重写它，
CI 用 `git diff --exit-code` 就能发现「改了 Rust 类型却忘了同步前端契约」。

新增命令的正确写法参考 `src-tauri/src/commands/app.rs`：
命令体只做「解析参数 → 调内核 → 映射成 DTO」，业务判断一律下沉到 `reader-core`。

---

## 必须守住的不变式

改动分页、进度、章节读取相关代码时，这两条不能破：

1. **不丢字** —— `load_chapter` 返回的文本，与正文文件中该章的字节区间**逐字符一致**。
2. **进度往返** —— 存进度只存「章节号 + 字符偏移」，**永不存页码 / 滚动百分比**；
   前端锚点算法须满足 `charOffsetToPage(pageToCharOffset(i)) === i`。

另有两条工程约束：

3. **IPC 必须粗粒度** —— 一次调用返回整章；翻页不产生 IPC。
4. **永不整书入内存** —— 只按 `Chapter.start..end` 字节区间读单章。

---

## 已验证的状态（2026-10-11）

工程已从 U 盘（`E:` / FAT32）迁到固定盘 `C:\项目\简阅` 并引入 workspace，见 [ADR-005](../../docs/adr/ADR-005-采用Cargo工作区与工程落盘固定盘.md)。

| 检查 | 结果 |
|---|---|
| `cargo test --workspace` | ✅ 29 项通过（内核 16 + 外壳 13） |
| `npm run typecheck` | ✅ 零错误 |
| `npm run lint` | ✅ 零告警 |
| `npm run build` | ✅ 产出 `dist/`（JS 227 kB / CSS 14.5 kB） |
| `cargo clippy --workspace --all-targets -- -D warnings` | ✅ 零告警 |
| `cargo fmt --all --check` | ✅ 干净 |
| 契约链路 | ✅ 改动 Rust DTO 字段后重新生成绑定，前端 `tsc` 立即报错 |
| 桌面人工验收 | ✅ **owner 实测通过**（2026-10-11）：`npm run tauri dev` 窗口正常、IPC 胶囊绿色、内核自检与中文往返符合预期 |

**构建耗时（迁移前 → 迁移后）**

| 步骤 | U 盘 / FAT32 | 固定盘 + workspace |
|---|---|---|
| 完整工作区构建（依赖 + 测试二进制） | 39 min | **3 min 26 s**（约 11×） |
| `cargo clippy --all-targets` | 约 35 min | **1 min 55 s** |

**范围变更**：按 [ADR-006](../../docs/adr/ADR-006-桌面优先安卓延后.md)，
**1.0 只交付桌面端，安卓整体延后至 1.x**——M0 以桌面侧完成为准关闭（见
[03-里程碑与验收清单](../../docs/03-里程碑与验收清单.md)），当前进入 **M1 导入管线与书库**。

**延后至 1.x**：

- 安卓全链路（`android init` / `dev` / `build --apk` / 真机安装）——
  `scripts/` 下的安卓脚本与本指南的安装步骤**原样保留**，届时直接续用。

### 搭建过程中踩到并已修复的坑（细节见 docs/04 §6）

| 现象 | 根因 | 修法 |
|---|---|---|
| `cargo test` 启动即崩 `0xc0000139` | 测试二进制拿不到 Common Controls v6 清单，comctl32 v5 缺 `TaskDialogIndirect` | `build.rs` 发 `/DELAYLOAD:comctl32.dll` |
| 契约导出失败（整个前端编不过） | specta 默认禁止把 `i64` 导出到 TS（精度） | 逐字段 `#[specta(type = Option<Number>)]` |
| 契约测试假失败 | 两个测试并行、靠副作用互相依赖 | 合并为自包含测试；导出路径改绝对路径 |
| 编译奇慢（39 min） | 工程在 **U 盘 + FAT32**（无硬链接 → 增量缓存退化为复制） | 迁到固定盘 `C:\项目\简阅`（见 ADR-005） |
