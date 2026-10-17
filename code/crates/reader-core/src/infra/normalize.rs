//! 文本规范化（docs/02 §6.3）。
//!
//! 目标：**把"来源各异"的原始文本洗成"格式一致"的正文**，只做无损的格式归一，
//! 不做任何内容改写——不转全半角、不转简繁（那是用户的阅读偏好，M3 设置的事）。
//!
//! | 规则 | 原因 |
//! |---|---|
//! | `\r\n` / `\r` → `\n` | Windows 旧文件与 Unix 混杂，切章与渲染只认一种换行 |
//! | 删零宽字符（U+FEFF / U+200B / U+00AD / U+200E / U+200F / U+2060） | 网文站反爬注入的水印，肉眼不可见但污染排版与字数 |
//! | U+2028 / U+2029 → `\n` | Unicode 行/段分隔符，浏览器 `white-space` 处理与 `\n` 不一致 |
//! | 行尾空白去除 | 拖拽选书时无意义，且影响"不丢字"对比的观感 |
//! | 连续空行压缩为最多 1 行 | 网文正文常见 3–5 连空行，翻页体验稀碎 |
//! | 去首尾空行 | 导入文件常有开门/收尾空行 |
//!
//! "不丢字"不变式以**规范化后的文本**为基准：章节区间、进度锚点全部定义在它上面。

/// 判断是否为应当删除的零宽/不可见字符。
fn is_invisible(c: char) -> bool {
    matches!(
        c,
        '\u{FEFF}' // BOM / ZWNBSP
        | '\u{200B}' // ZWSP
        | '\u{00AD}' // 软连字符
        | '\u{200E}' // LRM
        | '\u{200F}' // RLM
        | '\u{2060}' // WORD JOINER
    )
}

/// 规范化入口。
pub fn normalize(input: &str) -> String {
    // 1. 删零宽字符；行/段分隔符先归一为 \n
    let cleaned: String = input
        .chars()
        .filter(|c| !is_invisible(*c))
        .map(|c| match c {
            '\u{2028}' | '\u{2029}' => '\n',
            other => other,
        })
        .collect();

    // 2. CRLF / CR → LF
    let unified = cleaned.replace("\r\n", "\n").replace('\r', "\n");

    // 3. 逐行处理：去行尾空白；连续空行压缩为 1；去首尾空行
    let mut out_lines: Vec<&str> = Vec::new();
    let mut blank_run = 0usize;
    for line in unified.split('\n') {
        let trimmed_end = line.trim_end_matches([' ', '\t']);
        if trimmed_end.is_empty() {
            blank_run += 1;
            // 空行最多保留 1 个（用"看前一行是否已是空行"实现，避免反复 push/pop）
            if blank_run == 1 {
                out_lines.push("");
            }
        } else {
            blank_run = 0;
            out_lines.push(trimmed_end);
        }
    }

    // 去首尾空行
    while out_lines.first().is_some_and(|l| l.is_empty()) {
        out_lines.remove(0);
    }
    while out_lines.last().is_some_and(|l| l.is_empty()) {
        out_lines.pop();
    }

    out_lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crlf_and_cr_become_lf() {
        assert_eq!(normalize("a\r\nb\rc\nd"), "a\nb\nc\nd");
    }

    #[test]
    fn zero_width_chars_are_removed() {
        let dirty = "正\u{FEFF}文\u{200B}啊\u{00AD}哦\u{200E}嗯\u{2060}哇";
        assert_eq!(normalize(dirty), "正文啊哦嗯哇");
    }

    #[test]
    fn unicode_line_separators_become_newlines() {
        assert_eq!(normalize("a\u{2028}b\u{2029}c"), "a\nb\nc");
    }

    #[test]
    fn trailing_whitespace_per_line_is_trimmed() {
        assert_eq!(normalize("正文 \t \n下一行"), "正文\n下一行");
    }

    #[test]
    fn blank_line_runs_collapse_to_one() {
        assert_eq!(normalize("段一\n\n\n\n\n段二"), "段一\n\n段二");
        assert_eq!(
            normalize("段一\n\n段二"),
            "段一\n\n段二",
            "正常段距不受影响"
        );
    }

    #[test]
    fn leading_and_trailing_blank_lines_are_removed() {
        assert_eq!(normalize("\n\n \n正文\n\n\n"), "正文");
    }

    #[test]
    fn leading_indentation_is_preserved() {
        // 全角空格缩进是中文排版的语义，不能动
        assert_eq!(normalize("　　段首缩进。"), "　　段首缩进。");
    }

    #[test]
    fn content_is_never_reworded() {
        // 全半角、简繁、标点一律不动（那是阅读偏好，M3 设置的事）
        let raw = "他说：“１２３”，The quick brown fox!";
        assert_eq!(normalize(raw), raw);
    }

    #[test]
    fn empty_input_yields_empty_output() {
        assert_eq!(normalize(""), "");
        assert_eq!(normalize("\n\n\r\n"), "");
    }
}
