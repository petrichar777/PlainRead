//! 跨 IPC 边界的统一错误类型。
//!
//! # 为什么是结构体而不是 `String`
//!
//! 前端对错误的反应不是"把字符串显示出来"这么简单：
//!
//! - 磁盘写满 → 提示用户清理空间
//! - 导入的内容重复 → 需要弹出"是否覆盖"的选择
//! - 编码识别失败 → 需要给出"手动指定编码"的入口
//!
//! 靠匹配错误文案来做这些判断极其脆弱（改一个字就失效，且无法翻译）。
//! 因此错误必须带**机器可读的分类**。

use serde::Serialize;

/// 错误分类。前端用它决定处理方式，而不是解析文案。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    /// 文件系统读写失败
    Io,
    /// 目标不存在
    NotFound,
    /// 内容重复（导入查重命中）
    Duplicate,
    /// 编码识别或解码失败
    Encoding,
    /// 本地存储失败
    Storage,
    /// 入参非法
    InvalidInput,
    /// 其他内部错误
    Internal,
}

/// 错误载荷。
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    /// 面向用户的消息，应当是可读的完整句子。
    pub message: String,
    /// 面向排查的补充信息，例如出错的文件路径。
    #[specta(optional)]
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidInput, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{:?}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::new(ErrorCode::Io, "文件读写失败").with_detail(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::new(ErrorCode::InvalidInput, "数据格式不正确").with_detail(err.to_string())
    }
}

/// 命令的统一返回类型。
pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_serializes_with_code_and_message() {
        let err = AppError::new(ErrorCode::Encoding, "无法识别文件编码").with_detail("a.txt");
        let json = serde_json::to_value(&err).unwrap();

        assert_eq!(json["code"], "encoding");
        assert_eq!(json["message"], "无法识别文件编码");
        assert_eq!(json["detail"], "a.txt");
    }

    #[test]
    fn io_error_converts_and_keeps_detail() {
        let io = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
        let err: AppError = io.into();
        assert_eq!(err.code, ErrorCode::Io);
        assert!(err.detail.is_some(), "原始错误信息应当保留在 detail 里");
    }

    #[test]
    fn display_includes_code() {
        let err = AppError::not_found("书不存在");
        assert!(err.to_string().contains("NotFound"));
    }
}
