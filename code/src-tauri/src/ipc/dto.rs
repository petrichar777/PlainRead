//! IPC 契约中的数据结构（DTO）。
//!
//! # 为什么不直接用内核的领域类型
//!
//! 两个原因，第二个才是主要的：
//!
//! **原因一（次要）：依赖方向。**
//! 内核的 `Book` / `Chapter` 没有派生 `specta::Type`，这是刻意的。
//! 让 `reader-core` 依赖 specta，等于把 IPC 关注点渗进领域层，
//! 而内核的立身之本恰恰是"不知道 IPC 是什么"。
//!
//! **原因二（主要）：契约的演进节奏不该被内核绑架。**
//! 前端其实只关心「书籍摘要」这几个字段，而内核的 `Book`
//! 未来可能为了存储效率拆字段、并字段、改类型。
//! 如果前端直接消费内核类型，**任何一次内核重构都会自动变成前端的破坏性变更**——
//! 而后端重构本来不该让前端知道。
//!
//! 代价是每个类型要手写一遍映射。这个代价是划算的：
//! 它把"内部实现"和"对外承诺"解耦开，而这份承诺的稳定性
//! 正是让前后端能各自独立演进的唯一依据。

use serde::{Deserialize, Serialize};

use reader_core::ThemeId;

/// 应用与环境信息。
///
/// 建议长期保留：排查"是环境问题还是代码问题"时，这是第一手信息。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    /// 运行平台，取自 `std::env::consts::OS`（如 `"windows"` / `"android"`）。
    pub platform: String,
    /// 内核自检结果。
    pub probe: CoreProbe,
}

/// 内核自检结果。
///
/// 存在的意义：证明「内核 → 外壳 → 前端」这条完整数据通路是通的。
/// 它同时覆盖了三种典型的类型形态——结构体、枚举、枚举数组——
/// 以便在 M0 就把类型生成的边界情况暴露出来，而不是等到 M1 才发现。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CoreProbe {
    /// 内核 crate 的版本号。
    pub core_version: String,
    /// 由内核的 `Book` 领域类型映射而来。
    pub sample_book: BookSummary,
    /// 由内核的 `ThemeId` 枚举映射而来，用于验证枚举会生成 TS 联合类型。
    pub available_themes: Vec<Theme>,
    pub default_font_size: f32,
    pub default_line_height: f32,
}

/// 书籍摘要。
///
/// `id` 是字符串而非 uuid 类型：JSON 里 uuid 本来就是字符串，
/// TS 侧保持 `string` 最省心——TS 没有原生 UUID 类型，
/// 也不值得为此引入依赖。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BookSummary {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub source_encoding: String,
    pub chapter_count: u32,
    pub has_real_chapters: bool,
    /// Unix 毫秒；从未读过时为 `null`。
    ///
    /// # 为什么要写 `#[specta(type = ...)]`
    ///
    /// specta **默认禁止**把 `i64` 这类「BigInt 风格」的整数导出到 TypeScript：
    /// JS 的 `number` 是 f64，超过 2^53 的整数会被 `JSON.parse` 静默截断。
    /// 不写覆盖的话，导出会直接失败（`Specta forbids exporting BigInt-style types`），
    /// 而绑定文件是前端编译的硬依赖 —— 等于整个前端都编不过。
    ///
    /// 这里显式接受 f64 语义：毫秒时间戳当前约 `1.8e12`，
    /// 距 2^53（约 `9.0e15`）还有三个数量级的余量，映射成 `number` 是无损的。
    ///
    /// 之所以**逐字段**写而不是全局放行，是因为这个决定应当**在它发生的那个字段上可见**：
    /// 将来若真的出现需要完整 64 位精度的字段（例如内容哈希），
    /// 它会因为缺少这行覆盖而在构建期报错，被迫显式决策 ——
    /// 而不是被一条全局规则悄悄降级成 f64。
    #[specta(type = Option<specta_typescript::Number>)]
    pub last_read_at: Option<i64>,
    /// 阅读进度百分比（0–100，已读部分）；从未读过时为 `null`。
    ///
    /// 书架副标题「继续阅读 · x%」的数据来源（docs/05 §3.1）。
    /// 由仓储层在 `list_books` 时 join `progress` 表算出——
    /// M0 的自检数据没有进度，恒为 `None`。
    #[specta(optional)]
    pub progress_percent: Option<u32>,
}

/// 导入失败的单个文件。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    /// 失败的文件名（不含路径，展示用）。
    pub file: String,
    /// 面向用户的原因，应当是可读的完整句子。
    pub reason: String,
}

/// 一批导入的汇总结果。
///
/// 部分成功是常态（一次拖入多个文件），所以返回「成功 + 失败」两个列表
/// 而不是"全部成功才返回"。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub succeeded: Vec<BookSummary>,
    pub failed: Vec<ImportFailure>,
}

/// 主题。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    White,
    Paper,
    Night,
}

impl From<ThemeId> for Theme {
    fn from(value: ThemeId) -> Self {
        match value {
            ThemeId::White => Self::White,
            ThemeId::Paper => Self::Paper,
            ThemeId::Night => Self::Night,
        }
    }
}

/// `echo` 命令的返回。
///
/// 除了验证参数能被正确传递，它还顺带验证了 **UTF-8 在 IPC 边界上的正确性**：
/// 中文的字符数与字节数不相等，两个数都对才算真的没坏。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EchoReply {
    /// 原样回传的文本。
    pub text: String,
    /// 字符数（Unicode 标量值个数）。
    pub char_count: u32,
    /// UTF-8 字节数。
    pub byte_length: u32,
}

impl EchoReply {
    pub fn new(text: String) -> Self {
        let char_count = text.chars().count() as u32;
        let byte_length = text.len() as u32;
        Self {
            text,
            char_count,
            byte_length,
        }
    }
}

/// 章节目录项（不含正文）。
///
/// 正文永远不进目录响应——`open_book` 一次给全书章节标题，
/// 正文按章经 [`ChapterDto`] 拉取，维持"永不整书入内存"。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChapterMetaDto {
    /// 章序号（0 起），与 [`ChapterDto::index`] 同一取值域。
    pub index: u32,
    pub title: String,
}

/// `open_book` 的返回：进书时一次拿全的会话数据。
///
/// docs/02 §4.2：元信息 + 章节列表 + 上次进度。
/// （「已合并阅读设置」是 M3 接入设置表后追加的字段——加字段对 TS 是非破坏性的。）
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BookSessionDto {
    pub book: BookSummary,
    pub chapters: Vec<ChapterMetaDto>,
    /// 从未读过时为 `null`，前端从第 0 章开始。
    pub progress: Option<ProgressDto>,
}

/// 阅读进度（IPC 形态）。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProgressDto {
    pub chapter_index: u32,
    /// 章内**字符**偏移（不是字节偏移），锚点语义见内核 `ReadingProgress` 文档。
    pub char_offset: u32,
    /// Unix 毫秒。64 位整数的 TS 导出考量见 [`BookSummary::last_read_at`]。
    #[specta(type = specta_typescript::Number)]
    pub updated_at: i64,
}

/// `load_chapter` 的返回：整章正文。
///
/// # 为什么一次返回整章文本
///
/// 章是阅读的自然事务单元（≤ 数万字，几百 KB 级），
/// 一次取回后翻页/滚动就是纯前端操作，零 IPC 抖动。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChapterDto {
    pub index: u32,
    pub title: String,
    /// 规范化正文（与 `content.txt` 对应字节区间逐字符一致）。
    pub text: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echo_reply_counts_chinese_correctly() {
        // 4 个汉字：UTF-8 下 12 字节
        let reply = EchoReply::new("你好世界".to_string());
        assert_eq!(reply.char_count, 4);
        assert_eq!(reply.byte_length, 12);
    }

    #[test]
    fn echo_reply_handles_empty_and_emoji() {
        assert_eq!(EchoReply::new(String::new()).char_count, 0);
        // 带组合与 emoji 的文本：只保证不 panic 且字节数自洽
        let reply = EchoReply::new("a🦀中".to_string());
        assert_eq!(reply.char_count, 3);
        assert_eq!(reply.byte_length, "a🦀中".len() as u32);
    }

    #[test]
    fn theme_maps_from_core_enum() {
        assert_eq!(Theme::from(ThemeId::Night), Theme::Night);
        assert_eq!(Theme::from(ThemeId::Paper), Theme::Paper);
        assert_eq!(Theme::from(ThemeId::White), Theme::White);
    }

    #[test]
    fn theme_serializes_as_camel_case_for_the_frontend() {
        assert_eq!(serde_json::to_string(&Theme::Night).unwrap(), r#""night""#);
    }
}

/// 一条书签（M3-1）。
///
/// 位置语义与进度完全一致：**章号 + 章内字符偏移**，永不存页码
/// （页码随字号/屏宽漂移，字符偏移不随排版参数变化）。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkDto {
    pub id: String,
    pub chapter_index: u32,
    pub char_offset: u32,
    /// 位置附近的正文摘录，用于在列表里辨认"这条是哪儿"。
    pub excerpt: String,
    /// Unix 毫秒。64 位整数的 TS 导出考量见 [`BookSummary::last_read_at`]。
    #[specta(type = specta_typescript::Number)]
    pub created_at: i64,
}

impl From<&reader_core::domain::Bookmark> for BookmarkDto {
    fn from(b: &reader_core::domain::Bookmark) -> Self {
        Self {
            id: b.id.as_uuid().to_string(),
            chapter_index: b.chapter_index,
            char_offset: b.char_offset,
            excerpt: b.excerpt.clone(),
            created_at: b.created_at.millis(),
        }
    }
}
