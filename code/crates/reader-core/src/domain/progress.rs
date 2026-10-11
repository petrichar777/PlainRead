//! 阅读进度与书签。

use serde::{Deserialize, Serialize};

use super::ids::{BookId, BookmarkId};

/// Unix 毫秒时间戳。
///
/// 刻意不用 `std::time::SystemTime`：它在 IPC 与存储两端都需要额外约定，
/// 而毫秒整数在前端天然就是 `number`，序列化后无歧义。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Timestamp(pub i64);

impl Timestamp {
    /// 当前时间。系统时钟早于 epoch 时退化为 0，不 panic。
    pub fn now() -> Self {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        Self(millis)
    }

    pub fn millis(self) -> i64 {
        self.0
    }
}

/// 阅读进度。
///
/// # 为什么存「字符偏移」而不是页码
///
/// 这是本项目最关键的一个设计决定：
///
/// | 候选 | 问题 |
/// |---|---|
/// | 页码 | 换字号、换字体、旋转屏幕后页码全变，进度直接错位 |
/// | 滚动百分比 | 同上，且依赖渲染完成后的布局，不可靠 |
/// | **字符偏移** | 语义稳定，跨设备、跨字号、跨"分页/滚动"模式都一致 |
///
/// 不论 UI 是自绘分页还是 WebView 里的 CSS 多列，
/// 只要锚点是"章内第 N 个字符"，就永远能回到同一句话。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    pub book_id: BookId,
    pub chapter_index: u32,
    /// 章内**字符**偏移（不是字节偏移）。
    pub char_offset: u32,
    pub updated_at: Timestamp,
}

/// 书签。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: BookmarkId,
    pub book_id: BookId,
    pub chapter_index: u32,
    pub char_offset: u32,
    /// 位置附近的摘录，用于在书签列表里辨认"这条是哪儿"。
    pub excerpt: String,
    pub created_at: Timestamp,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_is_transparent_and_ordered() {
        let t = Timestamp(1_760_000_000_000);
        assert_eq!(serde_json::to_string(&t).unwrap(), "1760000000000");
        assert!(Timestamp(1) < Timestamp(2));
    }

    #[test]
    fn timestamp_now_is_sane() {
        // 2020-01-01 之后（毫秒），且不为 0（0 意味着取时间失败）
        let now = Timestamp::now();
        assert!(
            now.millis() > 1_577_836_800_000,
            "疑似系统时钟异常: {now:?}"
        );
    }

    #[test]
    fn progress_round_trips() {
        let progress = ReadingProgress {
            book_id: BookId::new(),
            chapter_index: 42,
            char_offset: 1234,
            updated_at: Timestamp::now(),
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"charOffset\""));
        assert!(json.contains("\"chapterIndex\""));
        let back: ReadingProgress = serde_json::from_str(&json).unwrap();
        assert_eq!(back, progress);
    }

    #[test]
    fn progress_is_copy() {
        // 进度会被频繁读取，Copy 可以省掉大量 clone 与借用纠缠
        fn assert_copy<T: Copy>() {}
        assert_copy::<ReadingProgress>();
        assert_copy::<Timestamp>();
    }
}
