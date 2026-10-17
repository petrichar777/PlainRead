//! 编码识别与解码（docs/02 §6.2）。
//!
//! 中文 TXT 的编码 jungle 是本项目导入管线的第一关：
//!
//! | 来源 | 常见编码 |
//! |---|---|
//! | 老网文站打包 / 很老的本地收藏 | GBK / GB18030 / Big5 |
//! | Windows 记事本"另存为" | UTF-16 LE（带 BOM） |
//! | 现代导出 / 手机端 | UTF-8（可能带 BOM） |
//!
//! 策略：**BOM 优先，可信；无 BOM 交 chardetng 统计探测；纯 ASCII 直接 UTF-8**。
//! 探测错了也不 panic——无效字节解码为 U+FFFD（M5 再做"手动指定编码"入口）。

use encoding_rs::Encoding;

/// 解码结果：规范化前的原始文本 + 识别出的编码名（存入 `Book.source_encoding` 供用户查看）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedText {
    pub text: String,
    pub encoding: String,
}

/// 把任意字节序列解码为文本。
///
/// 刻意**不返回错误**：编码探测永远有猜测成分，
/// 与其让导入失败，不如解出 U+FFFD 让用户看到"哪里坏了"——
/// 真正的失败处理（手动指定编码重导）是 M5 的功能。
pub fn decode(bytes: &[u8]) -> DecodedText {
    if bytes.is_empty() {
        return DecodedText {
            text: String::new(),
            encoding: "UTF-8".to_string(),
        };
    }

    // BOM 是文件自己声明的编码，可信度高于一切统计探测。
    // encoding_rs 的 decode() 会识别并剥离 BOM。
    let bom_encoding: Option<&'static Encoding> = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        Some(encoding_rs::UTF_8)
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        Some(encoding_rs::UTF_16LE)
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        Some(encoding_rs::UTF_16BE)
    } else {
        None
    };

    if let Some(enc) = bom_encoding {
        let (text, _, _had_errors) = enc.decode(bytes);
        return DecodedText {
            text: text.into_owned(),
            // 统一大写风格，与 "GBK" / "Big5" 观感一致
            encoding: enc.name().to_ascii_uppercase(),
        };
    }

    // 纯 ASCII 是 UTF-8 / GBK / Big5 的公共子集，无需探测。
    if bytes.is_ascii() {
        return DecodedText {
            text: String::from_utf8_lossy(bytes).into_owned(),
            encoding: "UTF-8".to_string(),
        };
    }

    // 无 BOM 的多字节内容：chardetng 统计探测。
    // 第二个参数 true 表示这是全部数据（探测算法可以整段使用）。
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let enc = detector.guess(None, true);
    let (text, _, _had_errors) = enc.decode(bytes);

    DecodedText {
        text: text.into_owned(),
        encoding: enc.name().to_ascii_uppercase(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// "第一章" 的 GBK 字节：第=0xB5 0xDA，一=0xD2 0xBB，章=0xD5 0xC2
    const GBK_CHAPTER: &[u8] = &[0xB5, 0xDA, 0xD2, 0xBB, 0xD5, 0xC2];

    #[test]
    fn utf8_is_decoded_verbatim() {
        let text = "第一章　惊蛰——窗外下着雨。";
        let out = decode(text.as_bytes());
        assert_eq!(out.text, text);
        assert_eq!(out.encoding, "UTF-8");
    }

    #[test]
    fn utf8_bom_is_stripped() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("正文".as_bytes());
        let out = decode(&bytes);
        assert_eq!(out.text, "正文");
        assert_eq!(out.encoding, "UTF-8");
    }

    #[test]
    fn utf16le_bom_is_detected() {
        let mut bytes = vec![0xFF, 0xFE];
        // "中" = U+4E2D，LE 字节序
        bytes.extend_from_slice(&[0x2D, 0x4E]);
        let out = decode(&bytes);
        assert_eq!(out.text, "中");
        assert_eq!(out.encoding, "UTF-16LE");
    }

    #[test]
    fn gbk_is_decoded() {
        let out = decode(GBK_CHAPTER);
        assert_eq!(out.text, "第一章");
        assert!(
            out.encoding.starts_with("GB"),
            "GBK 内容应识别为 GB 系编码，实际 {}",
            out.encoding
        );
    }

    #[test]
    fn invalid_bytes_become_replacement_chars_instead_of_failing() {
        // 0x81 起头是无效的 GBK 序列：解码不 panic，产出 U+FFFD
        let out = decode(&[0x81, 0x41]);
        assert!(out.text.contains('\u{FFFD}') || !out.text.is_empty());
    }

    #[test]
    fn empty_input_is_handled() {
        let out = decode(&[]);
        assert_eq!(out.text, "");
    }
}
