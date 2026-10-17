//! 书库命令：书架列表、删除、重命名、导入。
//!
//! # 分层
//!
//! - `*_impl` 裸函数：不依赖 Tauri 运行时（测试直接调用）；
//! - `#[tauri::command]` 函数体：解参 + 转发，绝不写业务分支；
//! - `import_batch`：纯内核调用循环（无事件、无 AppHandle，可单测）；
//! - `run_import`：`import_batch` + 事件下发（`import://progress` 等三个事件）。
//!
//! 事件在 [`tauri::async_runtime::spawn_blocking`] 里发——导入是 CPU + IO 密集操作，
//! 必须离开 tokio worker 线程，否则 10MB 文件的切章会卡住整个异步运行时。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use reader_core::domain::{Book, BookId, ReadingProgress};
use reader_core::infra::pipeline::{import_file, ImportError, ImportOutcome, Stage};
use reader_core::infra::repo::{Library, StoreError};
use tauri_plugin_dialog::DialogExt;
use tauri_specta::Event;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::events::{ImportDuplicate, ImportFinished, ImportProgress, ImportStage};
use crate::ipc::dto::{BookSummary, ImportFailure, ImportResult};

/// 书库的共享状态。
///
/// [`data_dir`] 即 docs/02 §5.2 的 `<app_data>`：
/// Windows 上是 `%APPDATA%/PlainRead/`，`library.redb` 与 `books/<id>/` 都在它下面。
/// 启动时在 `setup` 里 `.open()` 并 `.manage()`，命令通过 `State` 取用。
#[derive(Clone)]
pub struct LibraryState {
    pub data_dir: PathBuf,
    pub library: Arc<Library>,
}

// redb 的 Database 不实现 Debug；状态里的路径才是排查时有用的信息
impl std::fmt::Debug for LibraryState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LibraryState")
            .field("data_dir", &self.data_dir)
            .finish_non_exhaustive()
    }
}

impl LibraryState {
    /// 打开（不存在则创建）书库，并确保 `books/` 目录就位。
    pub fn open(data_dir: PathBuf) -> Result<Self, StoreError> {
        std::fs::create_dir_all(data_dir.join("books"))?;
        let library = Library::open(&data_dir.join("library.redb"))?;
        Ok(Self {
            data_dir,
            library: Arc::new(library),
        })
    }
}

// ── 错误映射：内核错误 → IPC 契约错误码 ─────────────────────────────

/// 内核存储错误 → IPC 错误码。reading 等兄弟模块复用。
pub(crate) fn storage_err(e: StoreError) -> AppError {
    match e {
        StoreError::Io(io) => io.into(),
        StoreError::NotFound => AppError::not_found("书不在书库中"),
        StoreError::Corrupt(what) => {
            AppError::new(ErrorCode::Storage, "书库数据损坏").with_detail(what)
        }
        StoreError::Database(msg) => {
            AppError::new(ErrorCode::Storage, "书库读写失败").with_detail(msg)
        }
    }
}

impl From<ImportError> for AppError {
    fn from(e: ImportError) -> Self {
        match e {
            ImportError::Io(io) => io.into(),
            ImportError::Store(s) => storage_err(s),
        }
    }
}

// ── 摘要映射 ────────────────────────────────────────────────────────

/// 进度百分比（书架副标题用）。
///
/// 章节粒度的近似：读到第 i 章（0 起）≈ 已读完 i 章，即 `(i+1)/N`。
/// 章内字符偏移不参与——精确到字的百分比需要 per-chapter 字数缓存，
/// 书架摘要不值得为那点精度付出每本书一章一次的 IO；
/// M2 阅读页内自会显示精确进度。
pub(crate) fn progress_percent(book: &Book, progress: Option<ReadingProgress>) -> Option<u32> {
    progress.map(|p| {
        let total = u64::from(book.chapter_count.max(1));
        (((u64::from(p.chapter_index) + 1) * 100) / total).min(100) as u32
    })
}

pub(crate) fn summarize(book: &Book, progress: Option<ReadingProgress>) -> BookSummary {
    BookSummary {
        id: book.id.to_string(),
        title: book.display_title().to_string(),
        author: book.author.clone(),
        source_encoding: book.source_encoding.clone(),
        chapter_count: book.chapter_count,
        has_real_chapters: book.has_real_chapters,
        last_read_at: book.last_read_at.map(|t| t.millis()),
        progress_percent: progress_percent(book, progress),
    }
}

pub(crate) fn parse_book_id(book_id: &str) -> AppResult<BookId> {
    uuid::Uuid::parse_str(book_id)
        .map(BookId)
        .map_err(|_| AppError::invalid_input(format!("无效的书籍 id：{book_id}")))
}

// ── list_books ──────────────────────────────────────────────────────

/// 书架列表，按 `last_read_at` 降序（最近阅读在首位；从未读过的沉底）。
#[tauri::command]
#[specta::specta]
pub fn list_books(state: tauri::State<LibraryState>) -> AppResult<Vec<BookSummary>> {
    list_books_impl(&state)
}

pub(crate) fn list_books_impl(state: &LibraryState) -> AppResult<Vec<BookSummary>> {
    let rows = state
        .library
        .list_books_with_progress()
        .map_err(storage_err)?;
    let mut out: Vec<BookSummary> = rows
        .iter()
        .map(|(book, progress)| summarize(book, *progress))
        .collect();
    // 最近阅读在首位，未读沉底；同为未读时保持稳定（read 迭代序 ≈ 加入序）。
    // ⚠️ 这里的 None 分支曾因手写比较器里 a/b 解构互换而反向——
    // 读过的书反而沉到末尾（owner 实测发现）。sort_by_key + Reverse
    // 让"Some > None、Some 内部降序"由 Option 的自然序一次表达，不再有手写分支。
    out.sort_by_key(|s| std::cmp::Reverse(s.last_read_at));
    Ok(out)
}

// ── delete_book ─────────────────────────────────────────────────────

/// 删除书籍：**同时**清理 redb 记录与 `books/<book_id>/` 目录（docs/03 M1 验收）。
///
/// 删除是幂等的：记录已不在、目录已不存在都算成功——前端连点两下不应报错。
#[tauri::command]
#[specta::specta]
pub fn delete_book(book_id: String, state: tauri::State<LibraryState>) -> AppResult<()> {
    delete_book_impl(&state, &book_id)
}

fn delete_book_impl(state: &LibraryState, book_id: &str) -> AppResult<()> {
    let id = parse_book_id(book_id)?;
    state.library.delete_book(id).map_err(storage_err)?;

    let dir = state.data_dir.join("books").join(id.to_path_segment());
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        // 目录不存在：记录已删干净，视为成功（幂等）
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

// ── rename_book ─────────────────────────────────────────────────────

/// 重命名书籍，返回更新后的摘要。
#[tauri::command]
#[specta::specta]
pub fn rename_book(
    book_id: String,
    title: String,
    state: tauri::State<LibraryState>,
) -> AppResult<BookSummary> {
    rename_book_impl(&state, &book_id, &title)
}

fn rename_book_impl(state: &LibraryState, book_id: &str, title: &str) -> AppResult<BookSummary> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::invalid_input("书名不能为空"));
    }
    let id = parse_book_id(book_id)?;
    let book = state.library.update_title(id, title).map_err(|e| match e {
        StoreError::NotFound => AppError::not_found(format!("书 {book_id} 不在书库中")),
        other => storage_err(other),
    })?;
    let progress = state.library.get_progress(id).map_err(storage_err)?;
    Ok(summarize(&book, progress))
}

// ── 导入 ────────────────────────────────────────────────────────────

/// 一批导入的结果（含重复明细，供事件下发）。
#[derive(Debug)]
struct BatchOutcome {
    result: ImportResult,
    /// (incoming 文件名, 书架上已存在的书)
    duplicates: Vec<(String, BookSummary)>,
}

/// 批量导入循环：逐个文件走管线，单文件失败不拖垮整批（部分成功是常态）。
///
/// 不依赖 Tauri 运行时；阶段回调由调用方自由处置（发事件 / 收集断言）。
fn import_batch(
    state: &LibraryState,
    paths: &[PathBuf],
    mut on_stage: impl FnMut(&Path, u32, u32, Stage),
) -> AppResult<BatchOutcome> {
    if paths.is_empty() {
        return Err(AppError::invalid_input("未提供任何文件路径"));
    }
    let total = paths.len() as u32;
    let mut succeeded = Vec::new();
    let mut failed = Vec::new();
    let mut duplicates = Vec::new();

    for (index, path) in paths.iter().enumerate() {
        let file_name = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());

        match import_file(&state.data_dir, &state.library, path, &mut |stage| {
            on_stage(path, index as u32, total, stage)
        }) {
            Ok(ImportOutcome::Imported { book, .. }) => {
                succeeded.push(summarize(&book, None));
            }
            Ok(ImportOutcome::Duplicate(existing)) => {
                duplicates.push((file_name.clone(), summarize(&existing, None)));
                failed.push(ImportFailure {
                    file: file_name,
                    reason: format!("与《{}》内容相同，已跳过", existing.display_title()),
                });
            }
            Err(e) => {
                failed.push(ImportFailure {
                    file: file_name,
                    reason: e.to_string(),
                });
            }
        }
    }

    Ok(BatchOutcome {
        result: ImportResult { succeeded, failed },
        duplicates,
    })
}

/// `pick_and_import` / `import_paths` 的公共出口：批量导入 + 三个事件下发。
async fn run_import(
    app: tauri::AppHandle,
    state: LibraryState,
    paths: Vec<PathBuf>,
) -> AppResult<ImportResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let outcome = import_batch(&state, &paths, |path, index, total, stage| {
            let file = path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let _ = ImportProgress {
                file,
                index,
                total,
                stage: ImportStage::from(stage),
            }
            .emit(&app);
        })?;

        for (incoming, existing) in &outcome.duplicates {
            let _ = ImportDuplicate {
                existing: existing.clone(),
                incoming: incoming.clone(),
            }
            .emit(&app);
        }

        let _ = ImportFinished {
            succeeded: outcome.result.succeeded.clone(),
            failed: outcome.result.failed.clone(),
        }
        .emit(&app);

        Ok(outcome.result)
    })
    .await
    .map_err(|e| AppError::internal(format!("导入任务异常退出: {e}")))?
}

/// 调起系统文件选择器并导入所选 TXT（桌面原生对话框 / 安卓 SAF）。
///
/// 用户取消选择 = 空批次，返回空结果而不是错误。
#[tauri::command]
#[specta::specta]
pub async fn pick_and_import(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryState>,
) -> AppResult<ImportResult> {
    use tauri::Manager;

    // 为什么不用 `blocking_pick_files`：阻塞式 API 依赖
    // 「对话框线程 → sync_channel(0) → 调用线程」的三方会合，
    // Windows 上实测会让文件对话框卡死（owner 人工验收复现）。
    // 改用**回调 + 异步通道**：对话框由插件派发到主线程，结果经 channel 回来，
    // 本命令 `await` 之——全程无跨线程 rendezvous。
    let (tx, mut rx) = tauri::async_runtime::channel(1);

    let dialog = app.dialog().file().add_filter("TXT 文档", &["txt"]);
    // 显式归属主窗口：owned 对话框有正确的模态与输入路由，
    // 不会被主窗口压在下面造成"卡住"的错觉
    let dialog = match app.get_webview_window("main") {
        Some(window) => dialog.set_parent(&window),
        None => dialog,
    };
    dialog.pick_files(move |files| {
        // 用户取消时 files 为 None，同样经通道送回。
        //
        // 回调在插件自建的普通线程上触发（`tauri-plugin-dialog` 桌面端是
        // `std::thread::spawn(move || f(block_on(dialog)))`，`f` 求值时
        // `block_on` 已返回、tokio 上下文已退出），不是 async 上下文，
        // 所以有界通道的 `blocking_send` 在此安全。
        // 反过来若把这里改成 `tx.send(..).await` 语义上就不成立了——
        // 回调是同步闭包，且 `send` 的 future 在这里无人驱动。
        let _ = tx.blocking_send(files);
    });

    let picked = rx
        .recv()
        .await
        .ok_or_else(|| AppError::internal("文件选择器回调通道中断"))?;

    // 取消（None）→ 空批次，返回空结果而不是错误
    let paths: Vec<PathBuf> = picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|entry| match entry {
            tauri_plugin_dialog::FilePath::Path(p) => Some(p),
            // URL 形态只在移动端 SAF 出现；M4 接入时在此扩展拷贝逻辑
            tauri_plugin_dialog::FilePath::Url(_) => None,
        })
        .collect();

    run_import(app, state.inner().clone(), paths).await
}

/// 「打开方式」入口：直接导入给定路径的 TXT。
///
/// 安卓端由 `VIEW` intent-filter 送入路径（M4），桌面端目前没有调用方，
/// 但契约先行登记——两侧共用同一导入管线。
#[tauri::command]
#[specta::specta]
pub async fn import_paths(
    app: tauri::AppHandle,
    paths: Vec<String>,
    state: tauri::State<'_, LibraryState>,
) -> AppResult<ImportResult> {
    let paths: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    run_import(app, state.inner().clone(), paths).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use reader_core::domain::Timestamp;

    fn temp_state() -> (LibraryState, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let state = LibraryState::open(dir.path().to_path_buf()).expect("打开书库失败");
        (state, dir)
    }

    /// 在来源目录造一份多章 TXT 并导入，返回书籍。
    ///
    /// 内容里带上文件名：不同样本内容必须不同，否则 content_hash 查重会拦下第二份。
    fn import_sample(state: &LibraryState, source_dir: &Path, name: &str) -> Book {
        let source = source_dir.join(name);
        std::fs::write(
            &source,
            format!("第一章　{name}\n夜里下雨。\n\n第二章　春分\n天亮了。\n"),
        )
        .unwrap();
        match import_file(&state.data_dir, &state.library, &source, &mut |_| {}) {
            Ok(ImportOutcome::Imported { book, .. }) => book,
            other => panic!("导入失败: {other:?}"),
        }
    }

    #[test]
    fn list_books_is_empty_before_anything_is_imported() {
        let (state, _dir) = temp_state();
        assert!(list_books_impl(&state).unwrap().is_empty());
    }

    #[test]
    fn list_books_sorts_recently_read_first() {
        let (state, dir) = temp_state();
        let a = import_sample(&state, dir.path(), "甲.txt");
        let b = import_sample(&state, dir.path(), "乙.txt");

        // 让乙比甲新（导入序是甲在前）
        for (book, ts) in [(a, 1_000i64), (b, 2_000)] {
            let mut updated = state.library.get_book(book.id).unwrap().unwrap();
            updated.last_read_at = Some(Timestamp(ts));
            state
                .library
                .insert_book(&updated, &state.library.get_chapters(book.id).unwrap())
                .unwrap();
        }

        let list = list_books_impl(&state).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].title, "乙", "最近阅读的必须在首位");
        assert_eq!(list[0].progress_percent, None);
    }

    #[test]
    fn delete_removes_records_and_directory_together() {
        let (state, dir) = temp_state();
        let book = import_sample(&state, dir.path(), "待删.txt");
        let book_dir = state.data_dir.join("books").join(book.id.to_path_segment());
        assert!(book_dir.exists());

        delete_book_impl(&state, &book.id.to_string()).unwrap();

        assert!(!book_dir.exists(), "目录必须随记录一起清理");
        assert!(list_books_impl(&state).unwrap().is_empty());
    }

    #[test]
    fn delete_is_idempotent() {
        let (state, dir) = temp_state();
        let book = import_sample(&state, dir.path(), "幂等.txt");
        delete_book_impl(&state, &book.id.to_string()).unwrap();
        // 再删一次：不报错
        delete_book_impl(&state, &book.id.to_string()).unwrap();
    }

    #[test]
    fn delete_rejects_malformed_id() {
        let (state, _dir) = temp_state();
        let err = delete_book_impl(&state, "不是uuid").unwrap_err();
        assert!(matches!(err.code, ErrorCode::InvalidInput));
    }

    #[test]
    fn rename_updates_title_and_trims_whitespace() {
        let (state, dir) = temp_state();
        let book = import_sample(&state, dir.path(), "旧名.txt");

        let renamed = rename_book_impl(&state, &book.id.to_string(), "  新书名  ").unwrap();
        assert_eq!(renamed.title, "新书名");

        // 再读一次库，确认持久化
        let listed = list_books_impl(&state).unwrap();
        assert_eq!(listed[0].title, "新书名");
    }

    #[test]
    fn rename_rejects_blank_title() {
        let (state, dir) = temp_state();
        let book = import_sample(&state, dir.path(), "不改名.txt");
        let err = rename_book_impl(&state, &book.id.to_string(), "   ").unwrap_err();
        assert!(matches!(err.code, ErrorCode::InvalidInput));
    }

    #[test]
    fn rename_missing_book_is_not_found() {
        let (state, _dir) = temp_state();
        let err =
            rename_book_impl(&state, "00000000-0000-0000-0000-000000000000", "随便").unwrap_err();
        assert!(matches!(err.code, ErrorCode::NotFound));
    }

    #[test]
    fn import_batch_reports_partial_success_and_duplicates() {
        let (state, dir) = temp_state();
        let good = dir.path().join("好.txt");
        std::fs::write(
            &good,
            "第一章　惊蛰\n夜里下雨。\n\n第二章　春分\n天亮了。\n",
        )
        .unwrap();
        let bad = dir.path().join("不存在.txt"); // 指向不存在的路径 → IO 失败 → 单文件失败
                                                 // 注意：乱码字节文件不会被管线拒绝（解码是 lossy 的、设计如此），
                                                 // 所以"失败样本"用 IO 错误构造，而不是字节垃圾。

        let stages_seen = std::cell::RefCell::new(0);
        let outcome = import_batch(&state, &[good.clone(), bad.clone()], |_, _, _, _| {
            *stages_seen.borrow_mut() += 1;
        })
        .unwrap();

        // 好文件成功；坏文件进 failed 但不影响整批
        assert_eq!(outcome.result.succeeded.len(), 1);
        assert_eq!(outcome.result.succeeded[0].title, "好");
        assert_eq!(outcome.result.failed.len(), 1);
        assert_eq!(outcome.result.failed[0].file, "不存在.txt");
        assert!(*stages_seen.borrow() >= 4, "每个文件至少发四个阶段回调");

        // 同一好文件再导一次 → 查重命中
        let second = import_batch(&state, std::slice::from_ref(&good), |_, _, _, _| {}).unwrap();
        assert!(second.result.succeeded.is_empty());
        assert_eq!(second.duplicates.len(), 1);
        assert_eq!(second.result.failed[0].file, "好.txt");
        assert!(second.result.failed[0].reason.contains("内容相同"));
    }

    #[test]
    fn import_batch_rejects_empty_input() {
        let (state, _dir) = temp_state();
        let err = import_batch(&state, &[], |_, _, _, _| {}).unwrap_err();
        assert!(matches!(err.code, ErrorCode::InvalidInput));
    }

    #[test]
    fn progress_percent_is_chapter_approximation() {
        let mut book = import_sample(&temp_state().0, Path::new("."), "x.txt");
        // 上面那行只是为了拿一个 Book 结构的便利样本；下面手工设字段做纯函数断言
        book.chapter_count = 4;
        let mk = |idx: u32| ReadingProgress {
            book_id: book.id,
            chapter_index: idx,
            char_offset: 0,
            updated_at: Timestamp(0),
        };
        assert_eq!(progress_percent(&book, None), None);
        assert_eq!(progress_percent(&book, Some(mk(0))), Some(25));
        assert_eq!(progress_percent(&book, Some(mk(3))), Some(100));
        // 防御：chapter_count 为 0 时不除零
        book.chapter_count = 0;
        assert_eq!(progress_percent(&book, Some(mk(5))), Some(100));
    }
}
