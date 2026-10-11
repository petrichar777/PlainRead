//! 构建脚本。
//!
//! 除了 Tauri 的标准构建步骤，这里额外处理一个 **Windows 专有的测试坑**，
//! 详见 [`delayload_comctl32_for_windows_tests`]。

fn main() {
    tauri_build::build();
    delayload_comctl32_for_windows_tests();
}

/// 让 Windows 上的测试二进制能够启动。
///
/// # 症状
///
/// `cargo test` 编译通过，但测试进程**在执行任何 Rust 代码之前就退出**：
///
/// ```text
/// error: test failed, to rerun pass `--lib`
///   exit code: 0xc0000139, STATUS_ENTRYPOINT_NOT_FOUND
/// ```
///
/// 一条测试都不会跑，`export_bindings()` 自然也执行不到 ——
/// 前端 `src/ipc/bindings.ts` 因此永远生成不出来，`tsc` 随之报模块不存在。
///
/// # 根因
///
/// Tauri 依赖树里的 `tao` / `muda` 静态导入 `comctl32.dll` 里 **Common Controls v6
/// 专有**的入口点（`TaskDialogIndirect` 等）。要加载到 v6，可执行文件必须带一份
/// 声明了 v6 依赖的应用清单。
///
/// 而 `tauri_build::build()` 生成的清单只发给 **bin 目标**：
///
/// ```text
/// cargo:rustc-link-arg-bins=<OUT_DIR>/resource.lib
/// ```
///
/// 测试二进制拿不到清单，Windows 便退回 System32 里的 comctl32 **v5.82**，
/// 导入表里那些 v6 入口点解析失败 → 进程在加载阶段被终止。
///
/// # 为什么不用「给测试也发一份清单」
///
/// Cargo **没有**「只针对单元测试二进制」的链接指令：
/// `cargo:rustc-link-arg-tests` 只作用于 `tests/` 目录下的**集成测试**，
/// 对 lib 内 `#[cfg(test)]` 的单元测试无效（本包也不存在 `tests/` 目标，
/// 直接使用该指令会报 `invalid instruction ... does not have a test target`）。
/// 而用 `cargo:rustc-link-arg` 再塞一份清单，会让 bin 目标出现两份清单资源，
/// 有 `CVTRES: duplicate resource` 的风险。
///
/// # 采用的解法：延迟加载 comctl32
///
/// 把 comctl32 的导入改成**延迟加载**（delay-load）：导入表里不再有硬编码的
/// 入口点地址，解析推迟到**第一次真正调用**时。
///
/// | 目标 | 效果 |
/// |---|---|
/// | 测试二进制 | 单元测试根本不会调用那些 GUI 函数 → 永不解析 → 正常启动 |
/// | 主程序 | 带 v6 清单，SxS 照常解析到 comctl32 v6，对话框行为不变 |
///
/// 代价只有一次间接跳转，且只作用于 comctl32 的调用路径。
///
/// 这只在 Windows + MSVC 上有意义，其他目标是空操作。
fn delayload_comctl32_for_windows_tests() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    if target_os != "windows" || target_env != "msvc" {
        return;
    }

    println!("cargo:rustc-link-arg=/DELAYLOAD:comctl32.dll");
    println!("cargo:rustc-link-arg=delayimp.lib");
}
