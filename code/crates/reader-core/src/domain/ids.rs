//! 标识符类型。
//!
//! 刻意不用裸 `Uuid`：领域里同时存在"书籍 ID"和"书签 ID"，
//! 用裸类型时把书签 ID 传给需要书籍 ID 的函数不会报错——
//! 这类 bug 在运行时才暴露，而且很难查。包一层新类型后变成编译错误。

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 书籍的唯一标识。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct BookId(pub Uuid);

impl BookId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }

    /// 用于文件系统路径：`books/<book_id>/`。
    ///
    /// 用 uuid 的简单形式（无连字符）可以让目录名短一点，
    /// 但保持与 `Display` 一致更省心，这里不做区分。
    pub fn to_path_segment(&self) -> String {
        self.0.simple().to_string()
    }
}

impl Default for BookId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for BookId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// 书签的唯一标识。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct BookmarkId(pub Uuid);

impl BookmarkId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}

impl Default for BookmarkId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for BookmarkId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn book_id_is_serialized_transparently() {
        let id = BookId::new();
        let json = serde_json::to_string(&id).unwrap();
        // 透明序列化：直接是 uuid 字符串，不是 {"0": "..."}
        assert_eq!(json, format!("\"{}\"", id));
        let back: BookId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, id);
    }

    #[test]
    fn new_ids_are_unique() {
        assert_ne!(BookId::new(), BookId::new());
        assert_ne!(BookmarkId::new(), BookmarkId::new());
    }

    #[test]
    fn path_segment_has_no_dashes() {
        let id = BookId::new();
        assert!(!id.to_path_segment().contains('-'));
        assert_eq!(id.to_path_segment().len(), 32);
    }
}
