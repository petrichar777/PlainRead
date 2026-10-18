//! 简阅 · PlainRead 的 Tauri 外壳（桌面端与移动端共用）。
//!
//! # 职责边界
//!
//! 这个 crate 刻意保持很窄，只做三件事：
//!
//! 1. **注册 IPC 契约** —— 命令与事件，见 [`commands`] 与 [`ipc`]。
//! 2. **承载平台差异** —— 沉浸全屏、屏幕常亮（M4 起在 `platform` 模块填充；
//!    文件选择已在 M1 经 `tauri-plugin-dialog` 解决，见 `commands::library`）。
//! 3. **接线** —— 把内核的能力暴露给前端。
//!
//! **业务逻辑不写在这里。** 这里出现的代码应当只是"接线"，
//! 任何一段有 if/else 分支的业务判断都应该下沉到 `reader-core`——
//! 那样它才能被单元测试，也才能在两端的构建里共用。

mod commands;
mod error;
mod events;
mod ipc;

pub use error::{AppError, AppResult, ErrorCode};

use std::path::{Path, PathBuf};

use tauri::Manager;
use tauri_specta::{collect_commands, collect_events, Builder};

/// 生成的 TypeScript 绑定文件路径（相对于 `src-tauri/`）。
pub const BINDINGS_PATH: &str = "../src/ipc/bindings.ts";

/// 绑定文件的**绝对**路径。
///
/// 刻意用 `CARGO_MANIFEST_DIR` 而不是把 [`BINDINGS_PATH`] 原样交给导出器：
/// 后者会被解释为「相对于进程当前目录」，而当前目录在 `cargo test`、
/// `tauri dev`、IDE 里跑测试时并不一致 —— 一旦对不上，症状是
/// 「导出报告成功，但文件出现在别处」，极难排查。
///
/// 这个路径只在开发期被使用（导出只在 debug 构建发生），
/// 那时源码目录必然存在，所以取绝对路径是安全的。
fn bindings_output_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(BINDINGS_PATH)
}

/// 构造 IPC 契约。
///
/// 单独抽成函数是为了让"生成 TypeScript 类型"这件事同时有两个触发点：
///
/// - **应用启动时**（debug 构建）——编码过程中契约始终是最新的；
/// - **`cargo test` 时**——CI 里用一条命令就能校验前后端契约是否同步。
///
/// 新增命令时**只需要在这里登记一次**，前端立刻获得带类型的调用封装。
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::app::app_info,
            commands::app::echo,
            commands::library::list_books,
            commands::library::pick_and_import,
            commands::library::import_paths,
            commands::library::delete_book,
            commands::library::rename_book,
            commands::reading::open_book,
            commands::reading::load_chapter,
            commands::reading::save_progress,
            commands::reading::add_bookmark,
            commands::reading::remove_bookmark,
            commands::reading::list_bookmarks,
        ])
        // 事件与命令同属契约：导入进度等载荷类型的改动同样会同步到 bindings.ts
        .events(collect_events![
            events::ImportProgress,
            events::ImportFinished,
            events::ImportDuplicate,
        ])
}

/// 生成 TypeScript 绑定到 [`BINDINGS_PATH`]。
pub fn export_bindings() -> Result<(), Box<dyn std::error::Error>> {
    specta_builder().export(
        specta_typescript::Typescript::default().header(
            "// @ts-nocheck\n\
             // 本文件由 tauri-specta 从 Rust 类型自动生成，请勿手动修改。\n\
             // 重新生成：在 code/ 目录执行 `npm run gen:bindings`。\n",
        ),
        bindings_output_path(),
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

    // specta builder 需要同时喂给 invoke_handler（命令路由）
    // 和 mount_events（事件注册表）——后者漏掉的话，
    // 命令全部正常、但任何事件 emit 都会 panic
    // （"EventRegistry not found in Tauri state"）。
    let specta = specta_builder();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(specta.invoke_handler())
        .setup(move |app| {
            // 事件注册：Rust → 前端推送（import://progress 等）的必备装配。
            // 单测构造不出 AppHandle，这一步只能在这里守——
            // 所以注释就是它的回归测试。
            specta.mount_events(app);

            // 书库根目录：docs/02 §5.2 的 <app_data>。
            // 打开/创建 library.redb 与 books/ 目录，交给所有命令共享。
            // 注意：现在书库文件会在首次启动时落地（此前刻意留空壳）——
            // 仓储层已真实接入，空壳的顾虑被"library.redb 本来就该存在"取代。
            let data_dir = app.path().app_data_dir()?;
            let state = commands::library::LibraryState::open(data_dir)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            app.manage(state);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 契约导出 + 落点校验。
    ///
    /// # 为什么两件事必须在同一个测试里
    ///
    /// 它们曾经是两个独立的 `#[test]`：一个负责导出，一个负责断言文件存在。
    /// 结果出现了「导出明明成功、断言却报文件不存在」的假失败 ——
    /// 因为 Rust 测试默认**并行执行**，检查存在性的那个测试
    /// 完全可能抢在写文件的测试之前跑完。测试之间靠副作用互相依赖是脆弱的，
    /// 合并成一个自包含的测试才是对的。
    ///
    /// 这个测试同时是 CI 的契约同步闸门：
    /// 它每次都会重写绑定文件，所以在 CI 里跑完 `cargo test` 之后再执行
    /// `git diff --exit-code`，就能检出「改了 Rust 类型却忘了提交前端绑定」。
    #[test]
    fn export_bindings_should_succeed_and_land_where_the_frontend_imports_it() {
        export_bindings().expect("导出 TypeScript 绑定失败");

        let path = bindings_output_path();
        assert!(path.exists(), "绑定文件不存在：{}", path.display());

        let content = std::fs::read_to_string(&path).expect("读取绑定文件失败");
        assert!(
            content.contains("appInfo"),
            "绑定文件里应当能找到 appInfo 命令"
        );
    }
}
