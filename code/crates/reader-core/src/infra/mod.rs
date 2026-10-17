//! 基础设施层：编码识别、规范化、章节切分、redb 存储、导入管线。
//!
//! 与 [`crate::domain`]（"是什么"）相对，这一层回答"怎么做到"：
//! 全部是纯 Rust 实现，不依赖任何 UI / Tauri 概念，可独立单测。

pub mod chapterize;
pub mod encoding;
pub mod normalize;
pub mod pipeline;
pub mod repo;
pub mod textfile;

pub use chapterize::{chapterize, ChapterizeOutcome, RawChapter};
pub use encoding::{decode, DecodedText};
pub use normalize::normalize;
pub use pipeline::{import_file, ImportError, ImportOutcome, Stage};
pub use repo::{Library, StoreError};
pub use textfile::read_range;
