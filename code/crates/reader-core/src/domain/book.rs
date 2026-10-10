//! 书籍与章节。

use serde::{Deserialize, Serialize};

use super::ids::BookId;
use super::progress::Timestamp;

/// 一本书。
///
/// 注意这里**不含正文**。正文单独落在 `books/<book_id>/content.txt`，
/// 按 [`Chapter`] 的字节区间按需读取——这是"永不整书入内存"原则的体现。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: BookId,
    pub title: String,
    pub author: Option<String>,
    /// 导入时的原始文件名（含扩展名），用于展示与查重提示。
    pub source_name: String,
    /// 原始文件的字符编码名，如 `"GBK"`。保留下来供用户查看或手动修正。
    pub source_encoding: String,
    /// 规范化后正文的字节数。
    pub byte_size: u64,
    pub chapter_count: u32,
    /// 是否成功切分出真实章节。`false` 表示走了"按字数均分"的兜底策略，
    /// UI 上应当有所区分（例如标题显示为"第 N 节"）。
    pub has_real_chapters: bool,
    /// 正文内容哈希，用于导入时查重。
    pub content_hash: u64,
    pub added_at: Timestamp,
    pub last_read_at: Option<Timestamp>,
}

impl Book {
    /// 展示用标题：正文标题为空时退化为原始文件名。
    pub fn display_title(&self) -> &str {
        if self.title.trim().is_empty() {
            &self.source_name
        } else {
            &self.title
        }
    }
}

/// 章节在书中的位置。
///
/// `start` / `end` 是**规范化正文中的字节偏移**，不是字符偏移。
/// 因为正文以 UTF-8 落盘，按字节区间切片可以做到零拷贝；
/// 而面向用户与进度存储时才用字符偏移（见 [`super::progress::ReadingProgress`]）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    /// 章在书中的序号，从 0 开始。
    pub index: u32,
    pub title: String,
    /// 起始字节偏移（含）。
    pub start: u64,
    /// 结束字节偏移（不含）。
    pub end: u64,
}

impl Chapter {
    /// 本章正文的字节长度。
    pub fn byte_len(&self) -> u64 {
        self.end.saturating_sub(self.start)
    }

    pub fn is_empty(&self) -> bool {
        self.end <= self.start
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_book() -> Book {
        Book {
            id: BookId::new(),
            title: "剑来".into(),
            author: Some("烽火戏诸侯".into()),
            source_name: "剑来.txt".into(),
            source_encoding: "GBK".into(),
            byte_size: 10_485_760,
            chapter_count: 1188,
            has_real_chapters: true,
            content_hash: 0xDEAD_BEEF,
            added_at: Timestamp(1_760_000_000_000),
            last_read_at: None,
        }
    }

    #[test]
    fn book_round_trips_through_json() {
        let book = sample_book();
        let json = serde_json::to_string(&book).unwrap();
        let back: Book = serde_json::from_str(&json).unwrap();
        assert_eq!(back, book);
    }

    #[test]
    fn book_json_uses_camel_case() {
        let json = serde_json::to_string(&sample_book()).unwrap();
        // 前端拿到的是 camelCase，这是 IPC 契约的一部分
        assert!(json.contains("\"sourceEncoding\""));
        assert!(json.contains("\"chapterCount\""));
        assert!(!json.contains("source_encoding"));
    }

    #[test]
    fn display_title_falls_back_to_source_name() {
        let mut book = sample_book();
        assert_eq!(book.display_title(), "剑来");
        book.title = "   ".into();
        assert_eq!(book.display_title(), "剑来.txt");
    }

    #[test]
    fn chapter_len_and_emptiness() {
        let chapter = Chapter {
            index: 0,
            title: "第一章 惊蛰".into(),
            start: 100,
            end: 4200,
        };
        assert_eq!(chapter.byte_len(), 4100);
        assert!(!chapter.is_empty());

        let empty = Chapter {
            index: 1,
            title: "空章".into(),
            start: 500,
            end: 500,
        };
        assert_eq!(empty.byte_len(), 0);
        assert!(empty.is_empty());
    }

    #[test]
    fn chapter_range_is_sliceable_against_real_text() {
        // 这条测试守住"不丢字"不变式的最基础形态：
        // 章节字节区间必须能安全地切出合法 UTF-8 子串。
        let text = "第一章 惊蛰\n窗外下着雨。\n第二章 谷雨\n雨停了。";
        let first = Chapter {
            index: 0,
            title: "第一章 惊蛰".into(),
            start: 0,
            end: "第一章 惊蛰\n窗外下着雨。\n".len() as u64,
        };
        let second = Chapter {
            index: 1,
            title: "第二章 谷雨".into(),
            start: first.end,
            end: text.len() as u64,
        };

        let s = &text[first.start as usize..first.end as usize];
        let t = &text[second.start as usize..second.end as usize];
        assert_eq!(format!("{s}{t}"), text, "按章节切片后拼接必须还原原文");
    }
}
