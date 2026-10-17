//! Rust → 前端的事件契约（docs/02-架构设计.md §4.3）。
//!
//! # 为什么导入进度用事件而不是命令返回值
//!
//! 导入是耗时操作（10 MB 文件解码 + 切章可能数百毫秒到数秒），
//! 必须**异步推送**让界面实时更新；其余操作都是"请求—响应"式，用命令即可，
//! **不滥用事件**。
//!
//! 事件与命令一样是契约的一部分：类型改动会立刻反映到 `bindings.ts`，
//! 前端编译期就能发现漂移。

use serde::{Deserialize, Serialize};

use crate::ipc::dto::{BookSummary, ImportFailure};
use reader_core::infra::pipeline::Stage;

impl From<Stage> for ImportStage {
    fn from(stage: Stage) -> Self {
        match stage {
            Stage::Decoding => Self::Decoding,
            Stage::Normalizing => Self::Normalizing,
            Stage::Chapterizing => Self::Chapterizing,
            Stage::Storing => Self::Storing,
        }
    }
}

/// 导入管线的阶段。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ImportStage {
    /// 编码识别与解码
    Decoding,
    /// 文本规范化
    Normalizing,
    /// 章节切分
    Chapterizing,
    /// 落盘（content.txt + redb）
    Storing,
}

/// 单个文件的导入进度。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    /// 正在导入的文件名（不含路径，展示用）。
    pub file: String,
    /// 0 起的批内序号。
    pub index: u32,
    /// 本批文件总数。
    pub total: u32,
    pub stage: ImportStage,
}

/// 一批导入的最终结果汇总。前端收到后应刷新书架。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct ImportFinished {
    pub succeeded: Vec<BookSummary>,
    pub failed: Vec<ImportFailure>,
}

/// 疑似重复提示：`content_hash` 命中书架上的已有书籍。
///
/// 前端据此弹出"疑似重复"的确认，而不是默默导入第二份。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct ImportDuplicate {
    /// 书架上已存在的书。
    pub existing: BookSummary,
    /// 正在导入的文件名。
    pub incoming: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_serializes_as_camel_case() {
        assert_eq!(
            serde_json::to_string(&ImportStage::Chapterizing).unwrap(),
            r#""chapterizing""#
        );
    }

    #[test]
    fn progress_payload_shape_is_stable() {
        let json = serde_json::to_value(ImportProgress {
            file: "剑来.txt".into(),
            index: 0,
            total: 3,
            stage: ImportStage::Decoding,
        })
        .unwrap();

        assert_eq!(json["file"], "剑来.txt");
        assert_eq!(json["stage"], "decoding");
        // 契约字段一旦改名，这里的断言与前端绑定会同时失败，强迫同步决策。
        assert_eq!(
            json.as_object().unwrap().len(),
            4,
            "字段数量变化属于契约变更"
        );
    }
}
