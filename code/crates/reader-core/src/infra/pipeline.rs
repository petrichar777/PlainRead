//! 导入管线：文件 → 解码 → 规范化 → 切章 → 查重 → 落盘落库。
//!
//! 顺序即 [`Stage`] 的事件顺序，外壳把它映射成 `import://progress` 事件。
//!
//! 内存设计（验收红线：10MB 文件峰值增量 < 100MB）：
//! - 原始字节（≤10MB）→ 解码文本（UTF-8 至多 3 倍膨胀 ≈ 30MB）→ 规范化副本（≈30MB）
//! - 正文以规范化后的字节**整体落盘**，之后阅读永远按章节区间 seek 读——
//!   导入是唯一一次整书在内存的时刻，10MB 量级完全可控。

use std::path::Path;

use crate::domain::{Book, BookId, Chapter, Timestamp};
use crate::infra::chapterize;
use crate::infra::encoding;
use crate::infra::normalize;
use crate::infra::repo::{Library, StoreError};

/// 管线阶段，与外壳的 `ImportStage`（IPC 事件字段）一一对应。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    /// 读取原始字节并解码
    Decoding,
    /// 规范化
    Normalizing,
    /// 章节切分
    Chapterizing,
    /// 查重、写正文文件、写库
    Storing,
}

/// 导入结果。
#[derive(Debug)]
pub enum ImportOutcome {
    /// 成功入库
    Imported { book: Book, chapters: Vec<Chapter> },
    /// 与已有书内容完全相同（content_hash 命中），未入库
    Duplicate(Book),
}

/// 管线错误。
#[derive(Debug)]
pub enum ImportError {
    Io(std::io::Error),
    Store(StoreError),
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "文件读写失败: {e}"),
            Self::Store(e) => write!(f, "入库失败: {e}"),
        }
    }
}

impl std::error::Error for ImportError {}

impl From<std::io::Error> for ImportError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<StoreError> for ImportError {
    fn from(e: StoreError) -> Self {
        Self::Store(e)
    }
}

/// FNV-1a 64：无依赖、稳定（不随 Rust 版本变化），只用于内容查重。
pub fn content_hash(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// 从文件名提取书名：去扩展名；空名退化为原名。
fn title_from_path(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or(name.clone());
    if stem.trim().is_empty() {
        name
    } else {
        stem
    }
}

/// 执行导入。`on_stage` 在每个阶段开始时被调用（供外壳发进度事件）。
pub fn import_file(
    data_dir: &Path,
    library: &Library,
    source_path: &Path,
    on_stage: &mut dyn FnMut(Stage),
) -> Result<ImportOutcome, ImportError> {
    // ── 1. 解码 ──────────────────────────────────────────────
    on_stage(Stage::Decoding);
    let raw = std::fs::read(source_path)?;
    let decoded = encoding::decode(&raw);
    let encoding_name = decoded.encoding;
    let text = decoded.text;
    drop(raw);

    // ── 2. 规范化 ────────────────────────────────────────────
    on_stage(Stage::Normalizing);
    let normalized = normalize::normalize(&text);
    drop(text);

    // ── 3. 切章 ──────────────────────────────────────────────
    on_stage(Stage::Chapterizing);
    let outcome = chapterize::chapterize(&normalized);
    let chapters: Vec<Chapter> = outcome
        .chapters
        .iter()
        .enumerate()
        .map(|(i, raw)| Chapter {
            index: i as u32,
            title: raw.title.clone(),
            start: raw.start,
            end: raw.end,
        })
        .collect();

    // ── 4. 查重 + 落盘落库 ───────────────────────────────────
    on_stage(Stage::Storing);
    let hash = content_hash(normalized.as_bytes());
    if let Some(existing) = library.find_book_by_hash(hash)? {
        return Ok(ImportOutcome::Duplicate(existing));
    }

    let book = Book {
        id: BookId::new(),
        title: title_from_path(source_path),
        author: None,
        source_name: source_path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default(),
        source_encoding: encoding_name,
        byte_size: normalized.len() as u64,
        chapter_count: chapters.len() as u32,
        has_real_chapters: outcome.has_real_chapters,
        content_hash: hash,
        added_at: Timestamp::now(),
        last_read_at: None,
    };

    // 先写正文文件，再写库；写库失败则回滚文件（尽力而为）
    let book_dir = data_dir.join("books").join(book.id.to_path_segment());
    std::fs::create_dir_all(&book_dir)?;
    let content_path = book_dir.join("content.txt");
    std::fs::write(&content_path, normalized.as_bytes())?;

    if let Err(e) = library.insert_book(&book, &chapters) {
        let _ = std::fs::remove_dir_all(&book_dir);
        return Err(ImportError::Store(e));
    }

    Ok(ImportOutcome::Imported { book, chapters })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a_is_stable_and_sensitive() {
        assert_eq!(content_hash(b""), 0xcbf2_9ce4_8422_2325);
        assert_ne!(content_hash(b"a"), content_hash(b"b"));
        // 与标准 FNV-1a 64 测试向量一致
        assert_eq!(content_hash(b"foobar"), 0x85944171f73967e8);
    }

    #[test]
    fn title_extraction_strips_extension() {
        assert_eq!(title_from_path(Path::new("三体.txt")), "三体");
        assert_eq!(title_from_path(Path::new("剑来 第一册.TXT")), "剑来 第一册");
        // 无扩展名 / 隐藏文件
        assert_eq!(title_from_path(Path::new("无扩展名")), "无扩展名");
        assert_eq!(title_from_path(Path::new(".hidden")), ".hidden");
    }
}
