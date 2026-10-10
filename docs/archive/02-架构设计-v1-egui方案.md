# 02 · 架构设计

> 前置阅读：[01-可行性分析.md](01-可行性分析.md)
> 本文假设技术路线已确认为 **egui + cosmic-text + redb**（见 [ADR-001](adr/ADR-001-UI与渲染技术路线.md)）。

---

## 1. 架构目标与原则

| 目标 | 具体含义 | 为什么对本项目重要 |
|---|---|---|
| **排版内核可单测** | 分页是纯函数：`(文本, 参数) → 页边界`，不需要 GPU / 窗口 | 阅读器的核心正确性在分页，必须能自动化验证 |
| **UI 可替换** | 排版、存储、领域逻辑不依赖 egui | 框架迭代快，未来换 Slint 时只动 UI 层 |
| **平台差异只在一处** | 所有平台相关能力收拢到 `Platform` trait | 安卓的文件选择、安全区不污染业务代码 |
| **大文件永不整书入内存** | 一切按章节寻址，章节索引是唯一全局结构 | 10 MB 长篇 + 中低端安卓机 |
| **进度不因排版变化而丢失** | 进度存「章节 + 字符偏移」，不存页码 | 换字号、换设备、换字体后仍回到同一句话 |

### 明确拒绝的做法（反过度设计）

- ❌ 不引入 async runtime —— 本地文件与本地 KV 都是阻塞 IO，用 `std::thread` + channel 足够
- ❌ 不做插件化 / 多格式解析器抽象 —— 1.0 只有 TXT，抽象是为第二个格式准备的，等它出现再说
- ❌ 不引入 DI 容器 / 复杂 trait 分层 —— 用具体类型 + 少量 trait 边界
- ❌ 不做 WASM 目标 —— 虽然 egui 支持，但会污染依赖选择，1.0 不买单

---

## 2. 分层架构

依赖方向**严格单向向下**。`reader-core` 一行 egui 代码都不该有。

```
┌──────────────────────────────────────────────────────────┐
│  壳层 Shell          app-desktop  /  app-android          │  窗口、生命周期、android_main
└───────────────────────────┬──────────────────────────────┘
                            │ 组装
┌───────────────────────────▼──────────────────────────────┐
│  UI 层               reader-ui                            │  egui 组件、主题、手势、字形图集渲染
│                      （只依赖 core 的领域类型与用例接口）      │
└───────────────────────────┬──────────────────────────────┘
                            │ 调用用例
┌───────────────────────────▼──────────────────────────────┐
│  应用层         reader-core::app                          │  用例编排：导入 / 打开 / 翻页 / 保存进度
├──────────────────────────────────────────────────────────┤
│  领域层         reader-core::domain                       │  实体与不变量：Book / Chapter / Progress
├──────────────────────────────────────────────────────────┤
│  基础设施       reader-core::infra                        │  仓储、编码、规范化、切章、分页引擎
└───────────────────────────┬──────────────────────────────┘
                            │ 端口
┌───────────────────────────▼──────────────────────────────┐
│  平台契约         reader-platform::Platform (trait)        │  文件选择、数据目录、安全区、字体、常亮
└──────────────────────────────────────────────────────────┘
                            ▲
                            │ 适配器实现
              DesktopPlatform / AndroidPlatform
```

**一个关键的依赖注记**：`reader-core` 依赖 `reader-platform` 的 **trait 定义**，而不依赖它的实现。`app-*` 负责把具体实现注入进去。这是典型的端口—适配器（六边形）结构，好处是 `reader-core` 的测试可以塞一个 `FakePlatform`。

---

## 3. Crate 划分

```
readtool/
├─ Cargo.toml                     # workspace，统一锁定依赖版本
├─ crates/
│  ├─ reader-core/                # 领域 + 用例 + 基础设施（无 UI，可跑在任意平台）
│  │  └─ src/
│  │     ├─ domain/               # 实体、值对象、不变量
│  │     ├─ app/                  # 用例编排（LibraryService / ReaderService）
│  │     └─ infra/
│  │        ├─ encoding.rs        # 编码探测与解码
│  │        ├─ normalize.rs       # 文本规范化
│  │        ├─ chapterize.rs      # 章节切分
│  │        ├─ paginate.rs        # 分页引擎（纯函数）
│  │        ├─ layout_cache.rs    # 分页缓存
│  │        ├─ repo/              # redb 仓储
│  │        └─ textfile.rs        # 按字节区间读取章节
│  ├─ reader-platform/            # Platform trait + DesktopPlatform
│  ├─ reader-ui/                  # egui 组件、主题、手势、字形图集
│  ├─ app-desktop/                # eframe 启动壳（bin）
│  └─ app-android/                # android_main + JNI 桥（cdylib）
├─ android/                       # Gradle 工程（Kotlin 胶水、清单、图标）
├─ scripts/                       # 构建脚本
└─ docs/
```

`app-android` 的产物形态与桌面不同：`crate-type = ["cdylib"]`，导出 `android_main`，由 Java 层通过 JNI 加载 `.so`。

---

## 4. 领域模型

```rust
pub struct BookId(pub Uuid);

pub struct Book {
    pub id: BookId,
    pub title: String,
    pub author: Option<String>,
    pub source_name: String,        // 原始文件名，用于展示与查重
    pub source_encoding: String,    // 原始编码名，如 "GBK"（保留供用户查看/修正）
    pub byte_size: u64,             // 规范化后正文的字节数
    pub chapter_count: u32,
    pub has_real_chapters: bool,    // 是否成功切出章节（否则是均分兜底）
    pub content_hash: u64,          // 用于导入查重
    pub added_at: Timestamp,
    pub last_read_at: Option<Timestamp>,
}

pub struct Chapter {
    pub index: u32,
    pub title: String,
    pub start: u64,                 // 规范化正文中的字节偏移（含）
    pub end: u64,                   // 字节偏移（不含）
}

pub struct ReadingProgress {
    pub book_id: BookId,
    pub chapter_index: u32,
    pub char_offset: u32,           // ★ 章内字符偏移（不是字节）
    pub updated_at: Timestamp,
}

pub struct Bookmark {
    pub id: Uuid,
    pub book_id: BookId,
    pub chapter_index: u32,
    pub char_offset: u32,
    pub excerpt: String,            // 后文前 30 字，便于识别
    pub created_at: Timestamp,
}
```

### 为什么进度存「字符偏移」而不是「页码」或「字节偏移」

| 候选 | 问题 |
|---|---|
| 页码 | 换字号、换字体、旋转屏幕后页码全变，进度直接错位 |
| 字节偏移 | 与 UTF-8 编码绑定，做文本预处理（如插入禁则控制符）后会漂移 |
| **字符偏移** | ✅ 语义稳定，跨设备跨字号一致；章内转字节偏移只是一次 O(n) 遍历（一章几千字，可忽略） |

### 阅读设置

```rust
pub struct ReaderSettings {
    pub font_family: String,        // 系统字体族名，或用户导入字体的路径
    pub font_size: f32,             // 逻辑像素
    pub line_height: f32,           // 倍数，如 1.6
    pub letter_spacing: f32,        // 字距，逻辑像素
    pub margin_h: f32,              // 左右页边距
    pub margin_v: f32,              // 上下页边距
    pub indent_first_line: bool,    // 首行缩进两字
    pub theme: ThemeId,             // Paper / White / Night
    pub page_turn: PageTurnMode,    // TapZones / Swipe / Both
    pub keep_screen_on: bool,
}
```

设置分**全局默认**与**每书覆盖**两层，后者为 `Option<覆盖值>`，读时合并。

---

## 5. 数据模型与存储布局

### 5.1 磁盘布局

```
<app_data>/
├─ library.redb                    # 全部元数据
├─ books/
│  └─ <book_id>/
│     ├─ content.txt               # 规范化 UTF-8 正文（唯一事实源）
│     └─ meta.json                 # 冗余副本，便于人工排查问题
├─ fonts/                          # 用户导入字体（可选）
└─ cache/
   └─ layout/                      # 分页缓存（可随时删除并重建）
```

`<app_data>` 的取值由平台适配器给出：

| 平台 | 路径 |
|---|---|
| Windows | `%APPDATA%/ReadTool/` |
| Linux / macOS | `~/.local/share/ReadTool/`（或标准对应目录） |
| Android | `/data/data/<pkg>/files/`（应用私有，无需任何存储权限） |

### 5.2 redb 表结构

| 表 | Key | Value | 访问模式 |
|---|---|---|---|
| `books` | `BookId` (16B) | `Book`（postcard） | 列表页全扫，量小（数百本） |
| `chapters` | `BookId` (16B) | `Vec<Chapter>`（postcard 整块） | **一次读整本** |
| `progress` | `BookId` | `ReadingProgress` | 单点读写，高频 |
| `bookmarks` | `Uuid` | `Bookmark` | 单点读写 |
| `bm_by_book` | `(BookId, Uuid)` | `()` | 二级索引，按书列书签 |
| `settings` | `&str` | `postcard` | 单点读写 |

**章节为什么整块存而不是逐章一行？**

3000 章的索引约 `3000 × 40B ≈ 120 KB`，序列化后一次读入耗时在毫秒级。而"打开书"这个动作**必然需要完整章节列表**（目录页要显示、跳转要查找、跨章翻页要取下一章）。整块存 = 一次读盘换全部需求，比逐行查询更贴合实际访问模式，还省掉了 3000 次 B+Tree 查找。

### 5.3 写入策略

- **进度写入**：内存中最新值 + **3 秒防抖**落盘；同时在这些时机**立即强制落盘**：切到后台、应用退出、切换书籍、屏幕关闭。防抖的意义是避免"每翻一页写一次盘"（安卓上既耗电又有 IO 抖动）。
- **书签写入**：即时落盘（低频操作，用户预期即时生效）。
- **分页缓存**：可重建，写入失败不报错，静默降级为内存缓存。

---

## 6. 分页引擎（本项目最核心的 300 行）

这是整个项目里**唯一值得反复打磨**的模块。

### 6.1 接口

```rust
pub struct LayoutSpec {
    pub font_family: String,
    pub font_size: f32,
    pub line_height: f32,
    pub letter_spacing: f32,
    pub indent_first_line: bool,
    pub viewport_w: f32,            // 已扣除左右页边距与安全区
    pub viewport_h: f32,            // 已扣除上下页边距与安全区
    pub cjk_line_break_rules: bool, // 是否启用禁则预处理
}

pub struct PageBoundary {
    pub start_char: u32,            // 页首字符偏移（含）
    pub end_char: u32,              // 页尾字符偏移（不含）
}

/// 纯函数：无 IO、无 GPU、无全局状态 → 可单测、可并行、可缓存
pub fn paginate(text: &str, spec: &LayoutSpec, fonts: &FontSystem)
    -> PaginationResult;

pub struct PaginationResult {
    pub pages: Vec<PageBoundary>,
    /// 仅在启用禁则预处理时非空：预处理文本偏移 → 原文本偏移 的稀疏映射
    pub offset_map: Vec<(u32, u32)>,
}
```

**签名里刻意没有 `&mut self`、没有 `Context`、没有 `TextureCache`** —— 这是为了让它能在 `cargo test` 里跑，也能在后台线程里跑（导入时预排首章）。

### 6.2 算法步骤

1. 建立 `cosmic_text::Buffer`，设置 `Metrics { font_size, line_height }` 与字距。
2. 换行策略用 `Wrap::WordOrGlyph`：
   - 汉字之间天然可断 → 走 Word 分支即可；
   - 长英文单词/URL 超宽 → 回退到按字形断，不会溢出。
3. 首行缩进：给段落首行加 `x_offset`（不建议插入全角空格，会污染文本）。
4. 禁用断行点（禁则）：见 6.3。
5. `buffer.layout_runs()` 逐行取出行信息，累加行高得到每行的纵向区间。
6. 按 `viewport_h` 切页：下一行放不下即开新页，记录该页首行起点与末行终点。
7. 把字节偏移转成字符偏移，产出 `PageBoundary`。

### 6.3 中文标点禁则（避头尾）

**问题**：中文排版不允许 `，。！？、；：）》」』】` 出现在行首，也不允许 `（《「『【` 出现在行尾。

**方案 A（推荐）**：预处理阶段在这些标点前插入 `U+2060 WORD JOINER`（零宽不换行控制符），使其与前一个字符绑定为不可断单元。

- 优点：不改变可见宽度，对排版引擎透明；
- 代价：文本长度变化 → 需要一份**稀疏偏移映射表**（只记录插入了控制符的位置，一章通常几百项），随分页缓存一起存储。
- 由于控制符插入是**确定性**的，映射表可随时重建，不需要持久化为事实源。

**方案 B（降级）**：不做禁则，接受偶尔标点落行首。实现成本为零，观感明显更差。

> **实施建议**：把禁则实现为一个**可独立开关、可独立交付**的子任务挂在 M3，不阻塞 M2 的分页主链路。先用方案 B 打通全流程，再切换到方案 A。

### 6.4 缓存

```rust
pub struct LayoutKey {
    pub book_id: BookId,
    pub chapter_index: u32,
    pub spec_hash: u64,   // 字体指纹 + 字号 + 行距 + 字距 + 缩进 + 视口尺寸 + 禁则开关
}
```

- **内存**：LRU，保留当前章 ±2 章（翻页预取，跨章无卡顿）。
- **磁盘**：`cache/layout/`，key 含**字体指纹**（字体路径 + 文件大小 + mtime 的哈希）——系统字体变了自动失效，不会出现"换了字体还用旧分页"的错位。
- 命中即用；未命中则后台线程重排，先渲染"正在排版"占位。

### 6.5 进度 ↔ 页码的双向映射

```rust
// 保存：当前页 → 字符偏移
let offset = pages[current].start_char;

// 恢复：字符偏移 → 页码（二分查找）
let page = pages.partition_point(|p| p.end_char <= saved_offset);
```

这两行是整个"进度永不丢失"特性的实现。因为 `PageBoundary` 是字符偏移，而进度也存字符偏移，**排版参数变了只需重排 + 二分查找，进度语义完全不变**。

### 6.6 必须成立的两条不变式（写成 property test）

> **不变式 1（不丢字）**：把所有页对应的文本片段按序拼接，必须**逐字符等于**规范化后的章节原文。
> **不变式 2（进度往返）**：对任意页 `i`，`page_of(pages[i].start_char) == i`。

这两条测试能在重构分页逻辑时第一时间抓出回归，比人工翻页检查可靠得多。

---

## 7. 渲染管线

```
章节文本 ──► cosmic-text Buffer ──► LayoutRun[] ──► PageBoundary[]
                                                        │
                                        取当前页的字形集合 │
                                                        ▼
                                        SwashCache 光栅化 → 字形位图
                                                        │
                                                        ▼
                                        egui::TextureHandle（字形图集）
                                                        │
                                                        ▼
                                        egui::Mesh（每字形一个 textured quad）
                                                        │
                                                        ▼
                                              Painter 一次 draw call
```

**要点**

| 项 | 设计 |
|---|---|
| 字形图集 | 起始 256×256 单通道，按需翻倍至 2048×2048；超出则重置并按当前页需求重填 |
| 绘制批次 | 整页合并成 **1 个 Mesh**，避免每字一次 draw call |
| 重绘策略 | 静止时 `request_repaint_after(Duration::from_secs(1))`（几乎不耗电）；翻页动画期间 60fps |
| 动画 | 1.0 用**平移 + 淡入**（约 180ms）；仿真卷页留到 2.0 |
| 跨页过渡 | 动画期间同时渲染上一页与当前页两层纹理 |

**性能预算**：一页约 400–600 个字形 → 每帧约 600 个 quad。对任何 2018 年后的 GPU 都是无压力负载；瓶颈反而在**布局计算**（已由缓存与预取解决）。

---

## 8. 平台抽象层（Ports & Adapters）

```rust
pub trait Platform: Send + Sync {
    fn app_data_dir(&self) -> PathBuf;

    /// 阻塞调用，返回**本地可直接读取**的路径。
    /// 桌面：弹出原生文件对话框。
    /// 安卓：走 SAF，并把 content:// 内容复制到缓存目录后返回路径。
    fn pick_import_files(&self) -> Vec<PathBuf>;

    /// 刘海 / 状态栏 / 导航栏占位（逻辑像素）
    fn safe_area(&self) -> Insets;

    /// 系统字体搜索目录
    fn system_font_dirs(&self) -> Vec<PathBuf>;

    fn set_keep_screen_on(&self, on: bool);
    fn toast(&self, msg: &str);
    fn clipboard_set(&self, text: &str);
    fn is_mobile(&self) -> bool;
}
```

| 实现 | 依赖 | 说明 |
|---|---|---|
| `DesktopPlatform` | `directories` + `rfd` | 直接返回真实路径 |
| `AndroidPlatform` | `jni` + Kotlin 桥 | SAF 结果异步回传，`pick_import_files` 内部用 channel 等待 |
| `FakePlatform`（测试） | — | 返回固定临时目录与预置样本路径，让 core 的集成测试不依赖真实对话框 |

**统一约定**：`pick_import_files` 返回的路径**一定是一次性可读的本地文件**。安卓侧的 URI→文件复制由适配器内部消化，上层代码完全感知不到 `content://` 的存在 —— 这是这条抽象线存在的主要价值。

---

## 9. 核心流程

### 9.1 冷启动

```
读取 settings（主题、字号）
   ↓
读取 books 表 → 按 last_read_at 排序
   ↓
渲染书架（网格 / 列表按窗口宽度自适应）
   ↓
后台线程：异步加载"最近阅读"封面占位与章节数校验
```

### 9.2 导入（最复杂的一条链路）

```
用户点「导入」
   ↓ Platform::pick_import_files()             [阻塞，UI 显示"选择文件中"]
得到本地路径列表
   ↓ 后台线程逐文件处理，UI 显示进度
   ↓ 1. 读前 64 KB
   ↓ 2. BOM 检查（UTF-8 / UTF-16LE / UTF-16BE）
   ↓ 3. 无 BOM → chardetng 猜测
   ↓ 4. encoding_rs 全量解码 → String
   ↓ 5. 规范化（见下）
   ↓ 6. 章节切分
   ↓ 7. 计算 content_hash，与已有书对比 → 提示"疑似重复"
   ↓ 8. 写 books/<id>/content.txt
   ↓ 9. 写 redb（books + chapters）
   ↓ 10. 预排首章（可选，让首次打开秒开）
完成 → 书架刷新，新书置顶
```

**规范化规则**（顺序固定，不可随意调整）

| # | 规则 | 说明 |
|---|---|---|
| 1 | `\r\n` / `\r` → `\n` | 统一换行 |
| 2 | 去除 BOM `U+FEFF` | 首尾都要 |
| 3 | 去除零宽字符 `U+200B..U+200D`、`U+2060` | 避免污染断行 |
| 4 | 每行 `trim_end` 行尾空白 | 保留行首缩进（可能是作者格式） |
| 5 | 连续 ≥3 个空行压缩为 1 个 | 保留段落节奏，去掉大段空白 |
| 6 | **不做**简繁转换、**不做**全半角转换 | 尊重原文，转换会破坏内容 |

### 9.3 打开书

```
读 progress（或首章）
   ↓ 从 chapters 表取整本章节列表
   ↓ 读 cache/layout 命中？
   ├─ 命中 → 直接取 pages，二分定位页码 → 渲染
   └─ 未命中 → 读取该章字节区间（textfile::read_range）
                ↓ paginate()
                ↓ 写缓存
                ↓ 渲染
   ↓ 后台预取 上一章 / 下一章 的分页结果
```

**注意这里没有"把整本书读进内存"这一步** —— 只有 `read_range(start, end)` 读取当前章（通常 3–10 KB）。

---

## 10. 安卓落地细节

### 10.1 技术参数

| 项 | 取值 | 理由 |
|---|---|---|
| Activity | **GameActivity** | 比 NativeActivity 的输入与 IME 支持更好；egui 有 `android-game-activity` feature |
| 渲染后端 | **glow（OpenGL ES 3.0）** | 老设备 Vulkan 支持不全，GLES 兼容性最广 |
| `minSdk` | **26**（Android 8.0） | 覆盖面足够，且 `robius-file-picker` 要求 26 |
| `targetSdk` | 35 | 当前商店要求 |
| ABI | `arm64-v8a` + `x86_64`（上架前补 `armeabi-v7a`） | 控制 APK 体积 |

### 10.2 沉浸与安全区

这是安卓上**最容易做出"廉价感"的地方**，必须认真处理：

| 问题 | 处理 |
|---|---|
| 状态栏遮挡正文 | 通过 `WindowInsets` 取 top inset，转成逻辑像素后计入页面上下内边距 |
| 挖孔屏 / 刘海 | 同上，使用 `displayCutout` inset 的较大值 |
| 底部手势条 | 通过 bottom inset 增加下边距 |
| 全屏切换 | `WindowInsetsControllerCompat.hide(systemBars)` / `show()`，用 `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` |
| 旋转 / 折叠 | 监听配置变化 → 重新计算视口 → 分页缓存 key 变化 → 自动重排（进度因存字符偏移而不丢） |

### 10.3 触摸手势映射

| 手势 | 行为 |
|---|---|
| 点击左 1/3 | 上一页 |
| 点击中 1/3 | 呼出 / 隐藏菜单（含进度、目录、设置入口） |
| 点击右 1/3 | 下一页 |
| 左右滑动 | 翻页（与点击分区二选一，可在设置里切换） |
| 双指捏合 | 实时调整字号（松手后重排并缓存） |
| 长按正文 | 选中该段 → 复制 / 加书签 |
| 系统返回键 | 阅读页 → 书架；书架页 → 退出应用 |

### 10.4 文件导入的两个入口

1. **应用内按钮**：调 `robius-file-picker` → 系统文档选择器 → `content://` 自动落缓存 → 上层拿到路径。
2. **系统「打开方式」**：在 `AndroidManifest.xml` 注册：

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <data android:mimeType="text/plain" />
</intent-filter>
```

用户在文件管理器里长按 TXT → 打开方式 → 本应用，**无需任何权限弹窗**，这是体验最好的路径。

> 兜底：若 `robius-file-picker` 与 `android-activity` 集成不顺，改自写 Kotlin 桥（`registerForActivityResult(ActivityResultContracts.OpenDocument())` + JNI 回传），约 100 行，`Platform` trait 接口不变。

### 10.5 生命周期

| 回调 | 动作 |
|---|---|
| `onPause` / `onStop` | **立即**落盘进度与设置（不依赖防抖） |
| `onDestroy` | 强制 flush redb |
| 内存紧张 | 丢弃分页缓存（可从磁盘/重算恢复），保留当前章 |

---

## 11. 构建与打包

### 11.1 依赖版本锁定

```toml
# Cargo.toml (workspace)
[workspace.dependencies]
eframe       = "=0.36"      # 锁小版本，避免 API 漂移
egui         = "=0.36"
cosmic-text  = "0.14"
redb         = "2.6"
postcard     = { version = "1", features = ["alloc"] }
chardetng    = "1.0"
encoding_rs  = "0.8"
fontdb       = "0.23"
jni          = "0.21"       # 仅 Android
rfd          = "0.17"       # 仅桌面
directories  = "6"
```

### 11.2 Release 配置

```toml
[profile.release]
opt-level = 3
lto = "thin"
codegen-units = 1
strip = true
panic = "abort"             # 显著减小体积
```

### 11.3 构建命令

**桌面**

```bash
cargo build --release -p app-desktop
```

**Android**

```bash
# 1. 一次性环境准备
rustup target add aarch64-linux-android x86_64-linux-android armv7-linux-androideabi
cargo install cargo-ndk
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018   # 钉死版本

# 2. 编译 Rust 产物到 jniLibs
cargo ndk -t arm64-v8a -t x86_64 --platform 26 \
  -o android/app/src/main/jniLibs build --release

# 3. Gradle 打包
cd android && ./gradlew assembleDebug      # 或 assembleRelease
```

### 11.4 Gradle 关键配置

```kotlin
android {
    namespace = "dev.readtool"
    compileSdk = 35
    ndkVersion = "27.2.12479018"      // 与 CI、本地保持一致
    defaultConfig {
        minSdk = 26
        targetSdk = 35
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }
    sourceSets["main"].jniLibs.srcDirs += "src/main/jniLibs"
}
dependencies {
    implementation("com.google.androidgamesdk:games-activity:3.0.5")
}
```

### 11.5 建议的脚本化目录

```
scripts/
├─ setup-android.sh     # 安装 target / cargo-ndk，检查 NDK 版本
├─ build-desktop.sh     # 桌面构建
├─ build-android.sh     # 交叉编译 + Gradle 打包
└─ run-android.sh       # 安装到已连接设备并启动，附带 logcat 过滤
```

---

## 12. 测试策略

| 层次 | 对象 | 方式 | 自动化 |
|---|---|---|---|
| 单元 | 编码识别 | 样本：UTF-8 / GBK / GB18030 / UTF-16LE / Big5 各一份，断言解码文本与识别出的编码名 | ✅ |
| 单元 | 文本规范化 | 输入含 `\r\n`、BOM、零宽字符、多余空行 → 断言输出 | ✅ |
| 单元 | 章节切分 | 语料快照测试：给定样本 → 期望章节数与标题数组 | ✅ |
| 单元 | **分页** | 固定文本 + 固定 spec → 断言页数、每页首字符；并验证两条不变式 | ✅ |
| 单元 | 进度映射 | `char_offset` ↔ `page_index` 往返一致性（property test） | ✅ |
| 集成 | 仓储 | 临时目录 redb，全表 CRUD 往返 | ✅ |
| 集成 | 导入全链路 | `FakePlatform` + 样本文件 → 断言落盘结果与库记录 | ✅ |
| 手工 | 真机 | 安全区、手势、常亮、旋转、深浅色、大字号 | ❌ |

**测试语料建议**（放在 `crates/reader-core/tests/assets/`）

| 样本 | 覆盖点 |
|---|---|
| `utf8_short.txt` | 基础路径 |
| `gbk_typical.txt` | 简体老文件，最常见的真实场景 |
| `gb18030_rare.txt` | 生僻字，验证 GB18030 而非仅 GBK |
| `utf16le_bom.txt` | BOM 分支 |
| `no_chapter.txt` | 切不出章节 → 均分兜底 |
| `chapter_false_positive.txt` | 含"第一章"的正文句子，验证不误判 |
| `huge_10mb.txt` | 大文件性能与内存（放在性能测试，不进常规 CI） |

---

## 13. 目标目录结构

```
E:/Rust/ReadTool/
├─ Cargo.toml
├─ rust-toolchain.toml
├─ .cargo/config.toml
├─ crates/
│  ├─ reader-core/
│  ├─ reader-platform/
│  ├─ reader-ui/
│  ├─ app-desktop/
│  └─ app-android/
├─ android/
│  ├─ settings.gradle.kts
│  ├─ app/
│  │  ├─ build.gradle.kts
│  │  └─ src/main/
│  │     ├─ AndroidManifest.xml
│  │     ├─ java/dev/readtool/     # Kotlin 胶水
│  │     ├─ jniLibs/               # cargo-ndk 产物落点
│  │     └─ res/                   # 图标、主题
├─ scripts/
└─ docs/
```

---

## 14. 架构决策速查

| 问题 | 决策 | 理由位置 |
|---|---|---|
| 用哪个 UI 框架 | egui 0.36 | [ADR-001](adr/ADR-001-UI与渲染技术路线.md) |
| 用哪个排版库 | cosmic-text | [ADR-001](adr/ADR-001-UI与渲染技术路线.md) |
| 用哪个数据库 | redb | [ADR-002](adr/ADR-002-存储与索引格式.md) |
| 章节索引怎么存 | 每书一个序列化 blob | [ADR-002](adr/ADR-002-存储与索引格式.md) |
| 进度怎么表示 | 章节号 + 字符偏移 | §4 |
| 分页结果怎么缓存 | 以「字体指纹+排版参数+视口」为 key | §6.4 |
| 中文禁则怎么做 | 插入 U+2060 + 稀疏偏移映射 | §6.3 |
| 大文件怎么处理 | 字节区间按需读取，永不整书入内存 | §9.3 |
| 平台差异怎么隔离 | `Platform` trait（端口—适配器） | §8 |
