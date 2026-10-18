//! 阅读命令：打开书、读章节、存进度（docs/02 §4.2 阅读域）。
//!
//! # 分层
//!
//! 与 [`crate::commands::library`] 同构：`*_impl` 裸函数可脱离 Tauri 运行时单测；
//! `#[tauri::command]` 只做解参转发。
//!
//! # 数据流（"永不整书入内存"在阅读侧的形态）
//!
//! ```text
//! open_book   → 元信息 + 章节目录（不含正文）+ 上次进度
//! load_chapter → 按章节字节区间 seek 读正文（≤ 数百 KB）
//! save_progress → 进度 + last_read_at 同事务落盘（repo::record_reading）
//! ```

use reader_core::domain::ReadingProgress;
use reader_core::infra::textfile::read_range;

use crate::commands::library::{parse_book_id, storage_err, summarize, LibraryState};
use crate::error::{AppError, AppResult};
use crate::ipc::dto::{BookmarkDto, BookSessionDto, ChapterDto, ProgressDto};

/// 书籍正文文件的磁盘位置（导入管线写入的约定布局：`books/<id>/content.txt`）。
fn content_path(data_dir: &std::path::Path, book_id: reader_core::BookId) -> std::path::PathBuf {
    data_dir
        .join("books")
        .join(book_id.to_path_segment())
        .join("content.txt")
}

pub(crate) fn open_book_impl(state: &LibraryState, book_id: &str) -> AppResult<BookSessionDto> {
    let id = parse_book_id(book_id)?;
    let book = state
        .library
        .get_book(id)
        .map_err(storage_err)?
        .ok_or_else(|| AppError::not_found(format!("书 {book_id} 不在书库中")))?;
    let chapters = state.library.get_chapters(id).map_err(storage_err)?;
    let progress = state.library.get_progress(id).map_err(storage_err)?;

    Ok(BookSessionDto {
        book: summarize(&book, progress),
        chapters: chapters.iter().map(Into::into).collect(),
        // ReadingProgress 是 Copy，move 进 summarize 后仍可再用
        progress: progress.map(|p| ProgressDto::from(&p)),
    })
}

pub(crate) fn load_chapter_impl(
    state: &LibraryState,
    book_id: &str,
    index: u32,
) -> AppResult<ChapterDto> {
    let id = parse_book_id(book_id)?;
    let chapters = state.library.get_chapters(id).map_err(storage_err)?;
    let chapter = chapters.iter().find(|c| c.index == index).ok_or_else(|| {
        AppError::invalid_input(format!(
            "章节序号 {index} 越界：本书共 {} 章",
            chapters.len()
        ))
    })?;

    let text = read_range(
        &content_path(&state.data_dir, id),
        chapter.start,
        chapter.end,
    )
    .map_err(|e| {
        AppError::new(crate::error::ErrorCode::Storage, "读取章节正文失败")
            .with_detail(e.to_string())
    })?;

    Ok(ChapterDto {
        index,
        title: chapter.title.clone(),
        text,
    })
}

pub(crate) fn save_progress_impl(
    state: &LibraryState,
    book_id: &str,
    chapter_index: u32,
    char_offset: u32,
) -> AppResult<()> {
    let id = parse_book_id(book_id)?;
    let book = state
        .library
        .get_book(id)
        .map_err(storage_err)?
        .ok_or_else(|| AppError::not_found(format!("书 {book_id} 不在书库中")))?;

    if chapter_index >= book.chapter_count {
        return Err(AppError::invalid_input(format!(
            "章节序号 {chapter_index} 越界：本书共 {} 章",
            book.chapter_count
        )));
    }

    state
        .library
        .record_reading(&ReadingProgress {
            book_id: id,
            chapter_index,
            char_offset,
            updated_at: reader_core::Timestamp::now(),
        })
        .map_err(storage_err)?;
    Ok(())
}

/// 打开一本书：元信息 + 章节目录 + 上次进度，一次拿全。
#[tauri::command]
#[specta::specta]
pub async fn open_book(
    state: tauri::State<'_, LibraryState>,
    book_id: String,
) -> AppResult<BookSessionDto> {
    open_book_impl(state.inner(), &book_id)
}

/// 读取整章正文（按字节区间 seek，零整书加载）。
#[tauri::command]
#[specta::specta]
pub async fn load_chapter(
    state: tauri::State<'_, LibraryState>,
    book_id: String,
    index: u32,
) -> AppResult<ChapterDto> {
    load_chapter_impl(state.inner(), &book_id, index)
}

/// 保存阅读进度（前端防抖调用；同时刷新 `last_read_at`）。
#[tauri::command]
#[specta::specta]
pub async fn save_progress(
    state: tauri::State<'_, LibraryState>,
    book_id: String,
    chapter_index: u32,
    char_offset: u32,
) -> AppResult<()> {
    save_progress_impl(state.inner(), &book_id, chapter_index, char_offset)
}

// ── 书签（M3-1，ADR-007 决策 1：增量扩契约）────────────────────────

/// 摘录上限（字符数，不是字节）。列表里一行放得下，也不至于变成正文副本。
const EXCERPT_MAX_CHARS: usize = 60;

fn parse_bookmark_id(raw: &str) -> AppResult<reader_core::domain::BookmarkId> {
    uuid::Uuid::parse_str(raw)
        .map(reader_core::domain::BookmarkId)
        .map_err(|_| AppError::invalid_input(format!("无效的书签 id：{raw}")))
}

/// 把客户端送来的摘录收拾干净：压掉换行/连续空白，按**字符**截断。
///
/// 客户端给的是当前页首的一小段正文，但契约不能假设它一定干净
/// ——摘录会直接进列表展示，带换行会把行高撑坏。
fn tidy_excerpt(raw: &str) -> String {
    let flat = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out: String = flat.chars().take(EXCERPT_MAX_CHARS).collect();
    if flat.chars().count() > EXCERPT_MAX_CHARS {
        out.push('…');
    }
    out
}

pub(crate) fn add_bookmark_impl(
    state: &LibraryState,
    book_id: &str,
    chapter_index: u32,
    char_offset: u32,
    excerpt: &str,
) -> AppResult<BookmarkDto> {
    let id = parse_book_id(book_id)?;
    let chapters = state.library.get_chapters(id).map_err(storage_err)?;
    if !chapters.iter().any(|c| c.index == chapter_index) {
        return Err(AppError::invalid_input(format!(
            "章节序号 {chapter_index} 越界：本书共 {} 章",
            chapters.len()
        )));
    }

    // 同一位置重复加签 = 幂等返回已有那条，而不是堆两条一模一样的
    let existing = state.library.list_bookmarks(id).map_err(storage_err)?;
    if let Some(found) = existing
        .iter()
        .find(|b| b.chapter_index == chapter_index && b.char_offset == char_offset)
    {
        return Ok(BookmarkDto::from(found));
    }

    let bookmark = reader_core::domain::Bookmark {
        id: reader_core::domain::BookmarkId::new(),
        book_id: id,
        chapter_index,
        char_offset,
        excerpt: tidy_excerpt(excerpt),
        created_at: reader_core::domain::Timestamp::now(),
    };
    state
        .library
        .insert_bookmark(&bookmark)
        .map_err(storage_err)?;
    Ok(BookmarkDto::from(&bookmark))
}

/// 删除书签。**幂等**：不存在也返回 Ok(false)，前端连点两下不应报错。
pub(crate) fn remove_bookmark_impl(state: &LibraryState, bookmark_id: &str) -> AppResult<bool> {
    let id = parse_bookmark_id(bookmark_id)?;
    state.library.remove_bookmark(id).map_err(storage_err)
}

pub(crate) fn list_bookmarks_impl(
    state: &LibraryState,
    book_id: &str,
) -> AppResult<Vec<BookmarkDto>> {
    let id = parse_book_id(book_id)?;
    let list = state.library.list_bookmarks(id).map_err(storage_err)?;
    Ok(list.iter().map(BookmarkDto::from).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn add_bookmark(
    state: tauri::State<'_, LibraryState>,
    book_id: String,
    chapter_index: u32,
    char_offset: u32,
    excerpt: String,
) -> AppResult<BookmarkDto> {
    add_bookmark_impl(
        state.inner(),
        &book_id,
        chapter_index,
        char_offset,
        &excerpt,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn remove_bookmark(
    state: tauri::State<'_, LibraryState>,
    bookmark_id: String,
) -> AppResult<bool> {
    remove_bookmark_impl(state.inner(), &bookmark_id)
}

#[tauri::command]
#[specta::specta]
pub async fn list_bookmarks(
    state: tauri::State<'_, LibraryState>,
    book_id: String,
) -> AppResult<Vec<BookmarkDto>> {
    list_bookmarks_impl(state.inner(), &book_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use reader_core::infra::pipeline::{import_file, ImportOutcome};
    use std::path::Path;

    /// 与 library::tests 同款基建：临时书库 + 造书导入。
    fn temp_state() -> (LibraryState, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let state = LibraryState::open(dir.path().to_path_buf()).expect("打开书库失败");
        (state, dir)
    }

    fn import_sample(state: &LibraryState, source_dir: &Path, name: &str) -> String {
        let source = source_dir.join(name);
        // 章标记行里不能带".txt"：句点属于句末标点，会触发 L1 防误判守卫
        // （把"第一章 xxx.txt"当正文句拒收）。标题用去掉扩展名的文件名。
        let mark = name.trim_end_matches(".txt");
        std::fs::write(
            &source,
            format!("第一章　{mark}\n夜里下雨。\n\n第二章　春分\n天亮了。\n"),
        )
        .unwrap();
        match import_file(&state.data_dir, &state.library, &source, &mut |_| {}) {
            Ok(ImportOutcome::Imported { book, .. }) => book.id.to_string(),
            other => panic!("导入失败: {other:?}"),
        }
    }

    #[test]
    fn open_book_returns_chapters_without_text() {
        let (state, dir) = temp_state();
        let id = import_sample(&state, dir.path(), "会话书.txt");

        let session = open_book_impl(&state, &id).unwrap();
        assert_eq!(session.book.title, "会话书");
        assert_eq!(session.chapters.len(), 2); // 正文以"第一章"开头，无开篇章
        assert!(session.progress.is_none(), "从未读过");
        // 目录里绝不能带正文
        assert!(session.chapters.iter().all(|c| !c.title.contains("夜里")));
    }

    #[test]
    fn load_chapter_returns_exact_text_and_rejects_out_of_range() {
        let (state, dir) = temp_state();
        let id = import_sample(&state, dir.path(), "取书.txt");

        let ch0 = load_chapter_impl(&state, &id, 0).unwrap();
        assert_eq!(ch0.title, "第一章　取书");
        assert!(ch0.text.contains("夜里下雨"));
        assert!(!ch0.text.contains("天亮了"), "章与章之间必须切开");
        let ch1 = load_chapter_impl(&state, &id, 1).unwrap();
        assert_eq!(ch1.title, "第二章　春分");
        // 两章拼接 == 规范化正文（"不丢字"最基础形态）
        let joined = format!("{}{}", ch0.text, ch1.text);
        assert!(joined.contains("夜里下雨"));
        assert!(joined.contains("天亮了"));
        assert_eq!(joined.matches("夜里下雨").count(), 1);

        let err = load_chapter_impl(&state, &id, 9).unwrap_err();
        assert!(matches!(err.code, crate::error::ErrorCode::InvalidInput));
    }

    #[test]
    fn save_progress_persists_and_fills_last_read_at() {
        let (state, dir) = temp_state();
        let id = import_sample(&state, dir.path(), "进度书.txt");

        save_progress_impl(&state, &id, 1, 5).unwrap();

        let session = open_book_impl(&state, &id).unwrap();
        let progress = session.progress.expect("进度已保存");
        assert_eq!((progress.chapter_index, progress.char_offset), (1, 5));
        assert_eq!(session.book.progress_percent, Some(100)); // (1+1)/2 章
        assert!(
            session.book.last_read_at.is_some(),
            "record_reading 触碰最近阅读"
        );

        let err = save_progress_impl(&state, &id, 9, 0).unwrap_err();
        assert!(matches!(err.code, crate::error::ErrorCode::InvalidInput));
        let err = save_progress_impl(&state, "not-a-uuid", 0, 0).unwrap_err();
        assert!(matches!(err.code, crate::error::ErrorCode::InvalidInput));
        let err = save_progress_impl(&state, &uuid::Uuid::new_v4().to_string(), 0, 0).unwrap_err();
        assert!(matches!(err.code, crate::error::ErrorCode::NotFound));
    }

    #[test]
    fn open_book_reports_missing_book_as_not_found() {
        let (state, _dir) = temp_state();
        let err = open_book_impl(&state, &uuid::Uuid::new_v4().to_string()).unwrap_err();
        assert!(matches!(err.code, crate::error::ErrorCode::NotFound));
    }

    /// owner 实测路径的复刻：读两本书 → 回书架 → 最近读的必须排首位且副标题带进度。
    /// 这条测试守住"阅读行为必须反映到书架"的端到端语义。
    #[test]
    fn reading_updates_shelf_order_and_subtitle() {
        let (state, dir) = temp_state();
        let a = import_sample(&state, dir.path(), "甲书.txt");
        let b = import_sample(&state, dir.path(), "乙书.txt");

        // 只读乙书到第 1 章（0 起）；甲书从未读过
        save_progress_impl(&state, &b, 1, 0).unwrap();

        let list = crate::commands::library::list_books_impl(&state).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, b, "最近阅读的书必须排首位");
        assert_eq!(list[0].progress_percent, Some(100));
        assert!(list[0].last_read_at.is_some());
        assert_eq!(list[1].id, a);
        assert_eq!(list[1].progress_percent, None);
    }

    // ── 书签（M3-1）────────────────────────────────────────────────

    #[test]
    fn bookmark_roundtrip_add_list_remove() {
        let (state, dir) = temp_state();
        let book = import_sample(&state, dir.path(), "书签书.txt");

        let a = add_bookmark_impl(&state, &book, 0, 0, "夜里下雨。").unwrap();
        let b = add_bookmark_impl(&state, &book, 1, 3, "天亮了。").unwrap();

        let list = list_bookmarks_impl(&state, &book).unwrap();
        assert_eq!(list.len(), 2);
        // 按阅读位置排序：第 0 章在前
        assert_eq!(list[0].chapter_index, 0);
        assert_eq!(list[1].chapter_index, 1);
        assert_eq!(list[0].excerpt, "夜里下雨。");

        assert!(remove_bookmark_impl(&state, &a.id).unwrap());
        let rest = list_bookmarks_impl(&state, &book).unwrap();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].id, b.id);
    }

    #[test]
    fn bookmark_same_position_is_idempotent() {
        let (state, dir) = temp_state();
        let book = import_sample(&state, dir.path(), "去重书.txt");

        let first = add_bookmark_impl(&state, &book, 0, 0, "夜里下雨。").unwrap();
        let again = add_bookmark_impl(&state, &book, 0, 0, "换一段摘录也不新建").unwrap();
        assert_eq!(first.id, again.id, "同一位置重复加签必须返回同一条");
        assert_eq!(list_bookmarks_impl(&state, &book).unwrap().len(), 1);
        // 幂等返回意味着摘录保持首次的值，不会被后来的覆盖
        assert_eq!(again.excerpt, "夜里下雨。");
    }

    #[test]
    fn bookmark_remove_is_idempotent() {
        let (state, dir) = temp_state();
        let book = import_sample(&state, dir.path(), "幂等书.txt");
        let bm = add_bookmark_impl(&state, &book, 0, 0, "夜里下雨。").unwrap();

        assert!(remove_bookmark_impl(&state, &bm.id).unwrap());
        // 连点第二下：不报错，返回 false
        assert!(!remove_bookmark_impl(&state, &bm.id).unwrap());
        assert!(list_bookmarks_impl(&state, &book).unwrap().is_empty());
    }

    #[test]
    fn bookmark_rejects_out_of_range_chapter() {
        let (state, dir) = temp_state();
        let book = import_sample(&state, dir.path(), "越界书.txt");
        let err = add_bookmark_impl(&state, &book, 9, 0, "x").unwrap_err();
        assert!(matches!(err.code, crate::error::ErrorCode::InvalidInput));
    }

    #[test]
    fn bookmark_excerpt_is_flattened_and_truncated() {
        let (state, dir) = temp_state();
        let book = import_sample(&state, dir.path(), "摘录书.txt");

        // 换行/连续空白压成**一个空格**（对中英混排都安全），首尾空白去掉
        let short = add_bookmark_impl(&state, &book, 0, 0, "  夜里\n下雨。  ").unwrap();
        assert_eq!(short.excerpt, "夜里 下雨。", "首尾空白去掉、换行压成单空格");

        let long: String = "字".repeat(200);
        let truncated = add_bookmark_impl(&state, &book, 1, 0, &long).unwrap();
        assert_eq!(truncated.excerpt.chars().count(), 61, "60 字 + 省略号");
        assert!(truncated.excerpt.ends_with('…'));
    }

    #[test]
    fn deleting_book_removes_its_bookmarks() {
        let (state, dir) = temp_state();
        let book = import_sample(&state, dir.path(), "删书.txt");
        add_bookmark_impl(&state, &book, 0, 0, "夜里下雨。").unwrap();

        let id = crate::commands::library::parse_book_id(&book).unwrap();
        state.library.delete_book(id).unwrap();
        // 书没了，书签查询返回空而不是报错
        assert!(list_bookmarks_impl(&state, &book).unwrap().is_empty());
    }
}
