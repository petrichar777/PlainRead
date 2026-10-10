//! 应用信息与自检命令。
//!
//! 这两个命令是 M0 的**链路验证载荷**：
//!
//! - [`echo`] 验证参数能双向穿过 IPC 边界，且 UTF-8 没被破坏；
//! - [`app_info`] 验证内核的领域类型能一路走到前端。
//!
//! [`app_info`] 建议长期保留；[`echo`] 在 M1 有了真实业务命令后可以删掉。

use reader_core::ThemeId;

use crate::error::AppResult;
use crate::ipc::dto::{AppInfo, CoreProbe, EchoReply, Theme};
use crate::ipc::mapping::demo_book;

/// 返回应用与内核的自检信息。
#[tauri::command]
#[specta::specta]
pub fn app_info() -> AppResult<AppInfo> {
    let settings = reader_core::ReaderSettings::default();
    let book = demo_book();

    Ok(AppInfo {
        name: env!("CARGO_PKG_NAME").to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        probe: CoreProbe {
            core_version: reader_core::VERSION.to_string(),
            sample_book: (&book).into(),
            // 走一遍 From 映射，而不是直接硬编码枚举值。
            // 这样一旦 ThemeId 新增变体，这里的 match 就会编译失败，
            // 提醒我们同步契约——而不是等到前端渲染出空白。
            available_themes: [ThemeId::White, ThemeId::Paper, ThemeId::Night]
                .into_iter()
                .map(Theme::from)
                .collect(),
            default_font_size: settings.font_size,
            default_line_height: settings.line_height,
        },
    })
}

/// 原样回传文本，并报告其字符数与字节数。
#[tauri::command]
#[specta::specta]
pub fn echo(text: String) -> AppResult<EchoReply> {
    Ok(EchoReply::new(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reports_core_version_and_probe() {
        let info = app_info().expect("app_info 不应失败");

        assert_eq!(info.name, "plainread");
        assert!(!info.probe.core_version.is_empty());
        assert_eq!(info.probe.available_themes.len(), 3);
        assert!(info.probe.default_font_size > 0.0);
        assert!(info.probe.default_line_height > 1.0);
    }

    #[test]
    fn app_info_probe_book_comes_from_core() {
        let info = app_info().unwrap();
        // demo_book() 的固定值，能对上就说明跨 crate 通路是通的
        assert_eq!(info.probe.sample_book.chapter_count, 12);
        assert_eq!(info.probe.sample_book.source_encoding, "GBK");
    }

    #[test]
    fn echo_round_trips_chinese() {
        let reply = echo("第一章　惊蛰".to_string()).unwrap();
        assert_eq!(reply.text, "第一章　惊蛰");
        assert_eq!(reply.char_count, "第一章　惊蛰".chars().count() as u32);
        assert_eq!(reply.byte_length, "第一章　惊蛰".len() as u32);
    }
}
