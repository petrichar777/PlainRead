# ADR-005: 采用 Cargo 工作区，并将工程落盘到固定盘

## Status

**Accepted**（2026-10-11）—— 项目 owner 批准执行。

## Context

M0 桌面端功能验收通过后，暴露出一个与代码无关、却直接决定开发节奏的问题：**编译极慢**。

| 步骤 | 迁移前实测 |
|---|---|
| `src-tauri` 首次全量构建 | **39 分钟** |
| 改一行 Rust 后重新链接 | 5–6 分钟 |
| `cargo clippy --all-targets` 首次 | 35 分钟 |

诊断出**两个互相独立的根因**。

### 根因一：工程放在可移动盘上，且文件系统是 FAT32

`E:` 是**可移动驱动器**（U 盘，卷标 `thinkplus`），文件系统 **FAT32**。实测对照：

| 指标 | C: 固定盘（NVMe 级） | E: U盘/FAT32 | 差距 |
|---|---|---|---|
| 顺序写 256MB（+fsync） | 1140 MB/s | 20.4 MB/s | **56×** |
| 写 400 个 256KB 小文件 | 113 MB/s（2.2 ms/个） | 6.5 MB/s（38.4 ms/个） | **17×** |
| 大文件读 | — | 34 MB/s | — |
| 硬链接 | 支持 | **不支持** | — |

**FAT32 不支持硬链接**这一点尤其致命：cargo 的增量编译缓存依赖硬链接，
失败后只能退化为**逐文件复制**（构建日志里反复出现
`hard linking files in the incremental compilation cache failed`）。

真实编译 A/B（同一份 `reader-core` 源码、同一 CPU、共用 C 盘的 registry 缓存，
**唯一变量是 target 目录所在盘**）：

| 场景 | C: SSD | E: U盘 | 倍数 |
|---|---|---|---|
| 全新构建 | 23.0 s | 81.8 s | 3.6× |
| 增量重建 | 3.4 / 3.5 s | 23.0 / 27.0 s | **6.7× / 7.6×** |

规律：**越吃 I/O 的步骤，提速越大**。全量构建 CPU 占比高 → 3.6×；
增量重建 I/O 占比高（还叠加硬链接退化）→ 约 7×。

除性能外还有一个**数据安全**理由：U 盘无日志、易被拔出、闪存寿命有限，
不适合作为唯一副本存放源码与设计文档。

### 根因二：没有 Cargo 工作区

`src-tauri/` 与 `crates/reader-core/` 各自是独立的 Cargo 包，各有自己的
`Cargo.lock` 与 `target/`。由此产生三个问题：

1. **同一批依赖被编译两次**（`reader-core` 在两个 target 目录各编一份）；
2. **依赖版本可能漂移** —— 两份 lock 会各自解析，同一个传递依赖理论上能被解析成两个版本；
3. **命令必须带 `--manifest-path`** —— 从 `code/` 直接执行 `cargo test -p plainread`
   会报「找不到包」，而 `docs/` 与源码注释恰好都按不带 `--manifest-path` 的形式写，
   形成了文档与现实的偏差。

## Decision

**D1. 工程落盘位置从 `E:\Rust\ReadTool`（U 盘 / FAT32）迁到 `C:\项目\简阅`（固定盘）。**

搬迁只搬源码、配置、文档、`node_modules` 与 `.git`（合计约 470 MB），
**不搬 `target/`**（4.6 GB）—— 路径一变，cargo 的指纹即失效，搬过去也无法复用。

**D2. 在 `code/` 建立 Cargo 工作区**（虚拟清单 `code/Cargo.toml`），成员为
`src-tauri` 与 `crates/reader-core`，并移除各成员的 `Cargo.lock`，统一到根。

### 由此确定的两条硬约定

| 约定 | 原因 |
|---|---|
| **`target/` 在 `code/` 下**（不再是 `src-tauri/target/`） | workspace 的 target 与根清单同级。任何写死旧路径的脚本/文档都必须同步 |
| **`[profile.release]` 只能写在根 `Cargo.toml`** | cargo 只认 workspace 根的 profiles；写在成员清单里会被**静默忽略**，release 的 `lto` / `strip` / `panic = "abort"` 会失效，包体积直接变大 |

## Consequences

### 收益

- 日常增量编译预计快 **5–8 倍**；全量构建至少快 3–4 倍（推算，见下）。
- 增量缓存重新用上硬链接（NTFS 支持），不再退化为复制。
- 单一 lock、单一 target：依赖只编译一次，版本不再可能漂移。
- `cargo test -p plainread` / `cargo clippy --workspace` 可直接在 `code/` 下执行，
  文档与源码注释里的命令写法终于与现实一致。
- 源码不再放在可移动介质上。

### 代价与遗留

- **迁移后第一次构建仍是全量构建**（路径变更使缓存作废）。
  这笔成本无法规避，但**与 D2 的重建合并**，只付一次。
- 旧位置 `E:\Rust\ReadTool` **保留不动**，作为回退快照，由 owner 自行决定何时清理。
- 曾有一个游离目录 `E:\Rust\ReadTool\PlainRead\`（GitHub 建仓时误建的空壳，
  只有默认 LICENSE 与 .gitattributes，其 `origin/main` 即远端初始提交）。
  已备份为 `C:\项目\_archive\PlainRead-游离目录-2026-10-11.zip` 后删除。

### 未实测、留待验证的部分

对 `src-tauri`（400 个 crate、target 4.5 GB）的提速是**推算**，不是实测：

| 步骤 | 迁移前实测 | 迁移后预计 |
|---|---|---|
| `src-tauri` 首次全量构建 | 39 min | 约 8–13 min |
| 改一行后重新链接 | 5–6 min | 约 40–70 s |
| `cargo clippy --all-targets` 首次 | 35 min | 约 8–12 min |

推算依据：Tauri 构建的 I/O 体量是 `reader-core` 的约 50–100 倍，I/O 占比更高，
因此提速倍数应**高于**实测的 3.6×。迁移后的首次全量构建即为实测校准点。
