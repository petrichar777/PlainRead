//! 导入管线全链路集成测试：语料文件 → 管线 → 落盘落库 → 按章读回。
//!
//! 语料见 `tests/assets/`（由 `gen-assets.ps1` 生成，勿手工编辑）：
//! 同一份简体多章内容以 5 种编码落地，交叉验证解码一致；
//! Big5 繁体单独一份；无章节长文验证 L4 兜底与误判陷阱。

use std::path::{Path, PathBuf};

use reader_core::infra::encoding::decode;
use reader_core::infra::normalize::normalize;
use reader_core::infra::pipeline::{import_file, ImportOutcome, Stage};
use reader_core::infra::repo::Library;
use reader_core::infra::textfile::read_range;

fn asset(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("assets")
        .join(name)
}

fn read_asset(name: &str) -> Vec<u8> {
    std::fs::read(asset(name)).unwrap()
}

/// 五份编码语料的共同断言：解出的文本 == UTF-8 基准语料。
/// （gb18030 语料标题行多了"㐀"，单独断言。）
fn assert_decodes_to_reference(name: &str, expected_encoding_prefix: &str) -> String {
    let raw = read_asset(name);
    let out = decode(&raw);
    let reference = String::from_utf8(read_asset("chapters-utf8.txt")).unwrap();
    assert_eq!(out.text, reference, "{name} 解码结果与 UTF-8 基准不一致");
    assert!(
        out.encoding.starts_with(expected_encoding_prefix),
        "{name} 识别编码 = {}，期望前缀 {expected_encoding_prefix}",
        out.encoding
    );
    out.text
}

#[test]
fn utf8_corpus_decodes_verbatim() {
    let raw = read_asset("chapters-utf8.txt");
    let out = decode(&raw);
    assert_eq!(out.encoding, "UTF-8");
    assert!(out.text.contains("第一章　惊蛰"));
}

#[test]
fn utf8_bom_corpus_decodes_and_strips_bom() {
    assert_decodes_to_reference("chapters-utf8-bom.txt", "UTF-8");
}

#[test]
fn gbk_corpus_decodes_to_reference() {
    assert_decodes_to_reference("chapters-gbk.txt", "GB");
}

#[test]
fn utf16le_corpus_decodes_to_reference() {
    let raw = read_asset("chapters-utf16le.txt");
    let out = decode(&raw);
    let reference = String::from_utf8(read_asset("chapters-utf8.txt")).unwrap();
    assert_eq!(out.text, reference);
    assert_eq!(out.encoding, "UTF-16LE");
}

#[test]
fn gb18030_corpus_decodes_including_4byte_char() {
    let raw = read_asset("chapters-gb18030.txt");
    let out = decode(&raw);
    assert!(out.text.contains('㐀'), "GB18030 4 字节区字符应正确解出");
    assert!(out.text.contains("第一章　惊蛰"));
    assert!(out.encoding.starts_with("GB"), "实际 {}", out.encoding);
}

#[test]
fn big5_corpus_decodes_traditional() {
    let raw = read_asset("chapters-big5.txt");
    let out = decode(&raw);
    assert!(out.text.contains("第一章　驚蟄"), "Big5 繁体应正确解出");
    assert!(
        out.encoding.to_uppercase().contains("BIG5"),
        "实际 {}",
        out.encoding
    );
}

#[test]
fn prose_corpus_falls_back_to_l4() {
    let raw = read_asset("prose-no-chapters.txt");
    let out = decode(&raw);
    let outcome = reader_core::infra::chapterize::chapterize(&out.text);
    assert!(!outcome.has_real_chapters, "陷阱行不应被判为章节标记");
    assert_eq!(outcome.chapters.len(), 1);
}

#[test]
fn import_pipeline_end_to_end() {
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(&dir.path().join("library.redb")).unwrap();

    let mut stages: Vec<Stage> = Vec::new();
    let outcome = import_file(
        dir.path(),
        &library,
        &asset("chapters-utf8.txt"),
        &mut |s| stages.push(s),
    )
    .unwrap();

    // 阶段事件顺序完整
    assert_eq!(
        stages,
        vec![
            Stage::Decoding,
            Stage::Normalizing,
            Stage::Chapterizing,
            Stage::Storing
        ]
    );

    let ImportOutcome::Imported { book, chapters } = outcome else {
        panic!("首次导入不应该是重复");
    };

    // 书籍元数据
    assert_eq!(book.title, "chapters-utf8");
    assert_eq!(book.source_name, "chapters-utf8.txt");
    assert_eq!(book.source_encoding, "UTF-8");
    assert_eq!(book.chapter_count, 6, "开篇 + 五章");
    assert!(book.has_real_chapters);
    assert!(book.byte_size > 0);

    // 正文文件落盘
    let content_path = dir
        .path()
        .join("books")
        .join(book.id.to_path_segment())
        .join("content.txt");
    assert!(content_path.exists());

    // "不丢字"不变式：各章读出拼接 == 规范化全文
    let normalized_reference =
        normalize(&String::from_utf8(read_asset("chapters-utf8.txt")).unwrap());
    let mut joined = String::new();
    for ch in &chapters {
        joined.push_str(&read_range(&content_path, ch.start, ch.end).unwrap());
    }
    assert_eq!(joined, normalized_reference);

    // 章节标题来自标记行
    assert_eq!(chapters[0].title, "开篇");
    assert_eq!(chapters[1].title, "第一章　惊蛰");
    assert_eq!(chapters[5].title, "第五章　立夏");

    // 落库可查
    let listed = library.list_books().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, book.id);
    assert_eq!(library.get_chapters(book.id).unwrap().len(), 6);

    // ── 同一文件再导一次 → 查重命中 ──
    let second = import_file(
        dir.path(),
        &library,
        &asset("chapters-utf8.txt"),
        &mut |_| {},
    )
    .unwrap();
    match second {
        ImportOutcome::Duplicate(existing) => assert_eq!(existing.id, book.id),
        ImportOutcome::Imported { .. } => panic!("重复导入应被拦截"),
    }
    assert_eq!(library.list_books().unwrap().len(), 1, "重复导入不入库");
}

#[test]
fn gbk_file_imports_with_correct_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(&dir.path().join("library.redb")).unwrap();

    let outcome = import_file(
        dir.path(),
        &library,
        &asset("chapters-gbk.txt"),
        &mut |_| {},
    )
    .unwrap();
    let ImportOutcome::Imported { book, .. } = outcome else {
        panic!("GBK 语料首次导入不应重复");
    };

    // 验收红线：GBK 旧 TXT 导入不乱码、source_encoding = GB 系
    assert!(
        book.source_encoding.starts_with("GB"),
        "实际 {}",
        book.source_encoding
    );

    // 按章读回，中文完好
    let chapters = library.get_chapters(book.id).unwrap();
    let content_path = dir
        .path()
        .join("books")
        .join(book.id.to_path_segment())
        .join("content.txt");
    let second_text = read_range(&content_path, chapters[2].start, chapters[2].end).unwrap();
    assert!(second_text.contains("第二章　春分"));
    assert!(!second_text.contains('\u{FFFD}'), "不允许乱码替换符");
}
