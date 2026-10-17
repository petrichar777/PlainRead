//! 按字节区间读正文（docs/02 §6.5）。
//!
//! 书的正文落在 `books/<book_id>/content.txt`（规范化 UTF-8 文本）。
//! 章节只是这个文件上的字节区间，读章 = seek + 定长读，
//! **不**需要把整本书（可能是 10MB）载进内存——内存红线（峰值增量 < 100MB）的关键。
//!
//! 区间来自切分器，边界都停在行首（换行符之后），必然落在 UTF-8 字符边界上。

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// 读取 `[start, end)` 字节区间并解码为 UTF-8 字符串。
///
/// 区间跨在多字节字符中间是**数据 bug**（切分器不可能产出这种区间），
/// 这里显式报错而不是静默 lossy——宁可在开发期炸出来。
pub fn read_range(path: &Path, start: u64, end: u64) -> std::io::Result<String> {
    debug_assert!(end >= start, "章节区间倒挂: [{start}, {end})");
    let len = usize::try_from(end - start).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("区间 [{start}, {end}) 超出地址空间"),
        )
    })?;

    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut buf = vec![0u8; len];
    file.read_exact(&mut buf)?;

    String::from_utf8(buf).map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("章节区间 [{start}, {end}) 未落在 UTF-8 字符边界上: {e}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(content: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("content.txt");
        std::fs::write(&path, content).unwrap();
        (dir, path)
    }

    #[test]
    fn reads_exact_byte_range() {
        let (_dir, path) = temp_file("hello 世界");
        // "hello " = 6 字节，"世" = 3 字节
        let text = read_range(&path, 6, 9).unwrap();
        assert_eq!(text, "世");
    }

    #[test]
    fn reads_whole_file() {
        let content = "第一章\n正文两行。\n完";
        let (_dir, path) = temp_file(content);
        let text = read_range(&path, 0, content.len() as u64).unwrap();
        assert_eq!(text, content);
    }

    #[test]
    fn empty_range_yields_empty_string() {
        let (_dir, path) = temp_file("abc");
        assert_eq!(read_range(&path, 1, 1).unwrap(), "");
    }

    #[test]
    fn range_on_char_boundary_check() {
        // 手工构造一个故意跨字符的区间 → 应报错而非悄悄替换
        let (_dir, path) = temp_file("世界");
        let err = read_range(&path, 1, 4).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    }
}
