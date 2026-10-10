//! 领域模型。
//!
//! 这里的类型是项目的**事实来源**：它们描述"一本书是什么"、"阅读进度是什么"，
//! 与 UI 如何展示、数据如何存储无关。

pub mod book;
pub mod ids;
pub mod progress;
pub mod settings;

pub use book::{Book, Chapter};
pub use ids::{BookId, BookmarkId};
pub use progress::{Bookmark, ReadingProgress, Timestamp};
pub use settings::{FontChoice, PageTurnMode, ReaderSettings, ThemeId};
