# 简阅 · PlainRead

<img src="docs/Logo.png" alt="简阅 · PlainRead" width="132">

一套 Rust 代码，同时跑在 **Windows 桌面 / 安卓手机 / 安卓平板** 上的小说阅读器。

1.0 只做一件事：干净地读 `.txt`。**无广告、无账号、无网络请求，离线优先。**

> 📌 **版本范围**：1.0 只交付 **Windows 桌面端**；安卓（手机 / 平板）延后至 1.0 之后的版本迭代，
> 见 [ADR-006](docs/adr/ADR-006-桌面优先安卓延后.md)。

- 工程代号：`PlainRead`（仓库、包名、crate 名统一为 `plainread`）
- 内核：`reader-core`，与 UI 框架完全解耦
- 外壳：Tauri 2；界面：React + TypeScript + Vite + Tailwind CSS

## 目录结构

```
.
├─ code/     # 工程根：Tauri 2 + React 前端 + Rust 内核
└─ docs/     # 可行性 / 架构 / 里程碑 / 环境 / UI 规范 + ADR
```

## 快速开始

```bash
cd code
npm install
npm run tauri dev        # 桌面开发模式（热重载）
```

打包与安卓构建见 `code/scripts/`。

## 文档

全部设计与决策记录在 [`docs/`](docs/)，入口是 [`docs/README.md`](docs/README.md)：

| 文档 | 内容 |
|---|---|
| [01-可行性分析](docs/01-可行性分析.md) | 范围界定、技术选型矩阵、风险矩阵 |
| [02-架构设计](docs/02-架构设计.md) | 分层架构、IPC 契约、领域模型、阅读器实现、构建打包 |
| [03-里程碑与验收清单](docs/03-里程碑与验收清单.md) | M0–M5 拆解 + 可勾选验收标准 |
| [04-环境准备与M0前置检查](docs/04-环境准备与M0前置检查.md) | 本机工具链检查 + 安卓环境安装 |
| [05-UI设计规范系统](docs/05-UI设计规范系统.md) | 设计令牌、四屏规格、组件库、手势矩阵 |
| [adr/](docs/adr/) | 架构决策记录（ADR-001 ~ ADR-006） |
