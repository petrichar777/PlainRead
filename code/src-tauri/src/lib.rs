//! 简阅 · PlainRead 的 Tauri 外壳（桌面端与移动端共用）。
//!
//! # 职责边界
//!
//! 这个 crate 刻意保持很窄，只做三件事：
//!
//! 1. **注册 IPC 契约** —— 命令与事件，见 [`commands`] 与 [`ipc`]。
//! 2. **承载平台差异** —— 文件选择、沉浸全屏、屏幕常亮（M1 起在 `platform` 模块填充）。
//! 3. **接线** —— 把内核的能力暴露给前端。
//!
//! **业务逻辑不写在这里。** 这里出现的代码应当只是"接线"，
//! 任何一段有 if/else 分支的业务判断都应该下沉到 `reader-core`——
//! 那样它才能被单元测试，也才能在两端的构建里共用。

mod commands;
mod error;
mod ipc;

pub use error::{AppError, AppResult, ErrorCode};

use tauri_specta::{collect_commands, Builder};

/// 生成的 TypeScript 绑定文件路径（相对于 `src-tauri/`）。
pub const BINDINGS_PATH: &str = "../src/ipc/bindings.ts";

/// 构造 IPC 契约。
///
/// 单独抽成函数是为了让"生成 TypeScript 类型"这件事同时有两个触发点：
///
/// - **应用启动时**（debug 构建）——编码过程中契约始终是最新的；
/// - **`cargo test` 时**——CI 里用一条命令就能校验前后端契约是否同步。
///
/// 新增命令时**只需要在这里登记一次**，前端立刻获得带类型的调用封装。
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::app::app_info,
        commands::app::echo,
    ])
}

/// 生成 TypeScript 绑定到 [`BINDINGS_PATH`]。
pub fn export_bindings() -> Result<(), Box<dyn std::error::Error>> {
    specta_builder().export(
        specta_typescript::Typescript::default().header(
            "// @ts-nocheck\n\
             // 本文件由 tauri-specta 从 Rust 类型自动生成，请勿手动修改。\n\
             // 重新生成：在工程根执行 `cargo test -p plainread`，或启动 `npm run tauri dev`。\n",
        ),
        BINDINGS_PATH,
    )?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 开发构建下每次启动都刷新绑定，
    // 避免前后端契约在编码过程中悄悄漂移（漂移到运行时才发现的代价很高）。
    #[cfg(debug_assertions)]
    if let Err(err) = export_bindings() {
        eprintln!("[plainread] 生成 TypeScript 绑定失败：{err}");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(specta_builder().invoke_handler())
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 契约同步校验。
    ///
    /// 任何一次 `cargo test` 都会重新生成绑定文件。
    /// 如果 Rust 侧改了类型却忘了提交生成产物，CI 里的 `git diff --exit-code`
    /// 会立刻发现——这是防止契约漂移最省事的一道闸门。
    #[test]
    fn export_bindings_should_succeed() {
        export_bindings().expect("导出 TypeScript 绑定失败");
    }

    #[test]
    fn bindings_file_is_written_where_the_frontend_expects_it() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(BINDINGS_PATH);
        assert!(path.exists(), "绑定文件不存在：{}", path.display());

        let content = std::fs::read_to_string(&path).expect("读取绑定文件失败");
        assert!(
            content.contains("appInfo") || content.contains("app_info"),
            "绑定文件里应当能找到 appInfo 命令"
        );
    }
}
