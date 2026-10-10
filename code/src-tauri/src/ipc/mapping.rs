//! 内核领域类型 → IPC DTO 的映射。
//!
//! 这些 `From` 实现是"内部实现"与"对外承诺"之间那道闸门。
//! 内核改字段时，编译器会在这里报错——**这正是我们要的效果**：
//! 改动被迫在这里被显式地审视一次，而不是无声地泄漏给前端。

use reader_core::{Book, BookId, Timestamp};

use super::dto::BookSummary;

impl From<&Book> for BookSummary {
    fn from(book: &Book) -> Self {
        Self {
            id: book.id.to_string(),
            // 用 display_title：正文标题为空时退化为文件名，
            // 避免前端收到空标题后还要自己判断一次。
            title: book.display_title().to_string(),
            author: book.author.clone(),
            source_encoding: book.source_encoding.clone(),
            chapter_count: book.chapter_count,
            has_real_chapters: book.has_real_chapters,
            last_read_at: book.last_read_at.map(Timestamp::millis),
        }
    }
}

/// M0 自检用的示例书籍。
///
/// ⚠️ **这是 M0（骨架验证）的临时数据，M1 接入真实书库后应当删除。**
///
/// 它存在的唯一目的：证明内核的领域类型能穿过 IPC 边界、变成前端可用的形状。
/// 数值取得偏小是刻意的——自检信息不该让人误以为是真实统计。
pub fn demo_book() -> Book {
    let now = Timestamp::now();
    Book {
        id: BookId::new(),
        title: "示例书籍（M0 自检）".to_string(),
        author: Some("简阅".to_string()),
        source_name: "sample-gbk.txt".to_string(),
        source_encoding: "GBK".to_string(),
        byte_size: 128_000,
        chapter_count: 12,
        has_real_chapters: true,
        content_hash: 0x5EED_1234,
        added_at: now,
        last_read_at: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn book_maps_to_summary() {
        let book = demo_book();
        let summary = BookSummary::from(&book);

        assert_eq!(summary.id, book.id.to_string());
        assert_eq!(summary.title, "示例书籍（M0 自检）");
        assert_eq!(summary.chapter_count, 12);
        assert!(summary.has_real_chapters);
        assert_eq!(summary.last_read_at, None);
    }

    #[test]
    fn summary_falls_back_to_source_name_when_title_blank() {
        let mut book = demo_book();
        book.title = String::new();
        let summary = BookSummary::from(&book);
        assert_eq!(summary.title, book.source_name);
    }
}
