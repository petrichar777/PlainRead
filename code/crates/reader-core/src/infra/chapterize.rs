//! 章节切分（docs/02 §6.4：L1–L4 四级策略 + 误判保护）。
//!
//! # 四级策略（从强到弱，命中即止）
//!
//! | 级 | 依据 | 门槛 |
//! |---|---|---|
//! | L1 | `第N章/回/节/卷/部/篇`、`Chapter N` | 行级门槛极严，通过即全数采信 |
//! | L2 | `N、` / `N.` / `N：` 等数字编号行 | ≥ 5（数字样式太容易撞正文，门槛更高） |
//! | L3 | `序章 / 楔子 / 引子 / 尾声 / 终章 / 番外…` 独立行 | ≥ 1 |
//! | L4 | 兜底：按固定字数切块，标题"第 N 节" | ——（`has_real_chapters = false`）|
//!
//! L2 / L3 为主策略时，L1 标记一并并入（"楔子 + 第一章"混排的书真实存在）。
//!
//! # 误判保护（M1 验收红线："含『第一章』字样的正文句不被误判"）
//!
//! 一行要成为标题，必须**同时**满足：
//!
//! 1. 整行 ≤ 30 字——标题是短行，正文句几乎不会这么短；
//! 2. 标记必须**起始于行首**（去首尾空白后）；
//! 3. 标记之后的余文里**没有句末标点**（。！？；…）——"第一章的内容很重要。"不是标题；
//! 4. L2 的 `N.` / `N，` 后不能紧跟数字（"3.5 毫米"、"2026.1.1"不是编号）。
//!
//! # 字节偏移
//!
//! [`RawChapter`] 的 `start` / `end` 是**规范化文本中的字节偏移**（含头不含尾），
//! 各章区间恰好无缝铺满全文——这是"不丢字"不变式的切分面：
//! 所有章节读出拼接 == 规范化全文。

/// 标题行最大长度（字符数）。超过它，再像标题也是正文。
pub const TITLE_MAX_CHARS: usize = 30;
/// L2（数字编号）生效门槛：数字样式太容易撞正文，门槛更高。
pub const L2_MIN_MARKS: usize = 5;
/// L4 兜底切块的目标字数。
pub const L4_CHUNK_CHARS: usize = 8000;

/// 原始章节：规范化文本上的字节区间 + 标题。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawChapter {
    pub title: String,
    pub start: u64,
    pub end: u64,
}

/// 切分结果。`has_real_chapters = false` 表示走了 L4 兜底，
/// UI 上应当有所区分（如显示"第 N 节"而非真实章节名）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChapterizeOutcome {
    pub chapters: Vec<RawChapter>,
    pub has_real_chapters: bool,
}

/// 带字节偏移的行。
struct Line<'a> {
    /// 行首字节偏移（含前导空白）
    start: usize,
    /// 行尾字节偏移（不含换行符）
    end: usize,
    text: &'a str,
}

fn lines_with_offsets(text: &str) -> Vec<Line<'_>> {
    let mut out = Vec::new();
    let mut start = 0usize;
    for (i, ch) in text.char_indices() {
        if ch == '\n' {
            out.push(Line {
                start,
                end: i,
                text: &text[start..i],
            });
            start = i + 1;
        }
    }
    if start < text.len() {
        out.push(Line {
            start,
            end: text.len(),
            text: &text[start..],
        });
    }
    out
}

/// 句末/句中强标点：标题里几乎不出现，出现即正文。
fn has_sentence_punct(s: &str) -> bool {
    s.chars()
        .any(|c| matches!(c, '。' | '！' | '？' | '；' | '…' | '!' | '?' | ';' | '.'))
}

/// 中文数字 + 阿拉伯数字（"十二"、"1024"、"〇"）
fn is_cjk_numeral(c: char) -> bool {
    matches!(
        c,
        '零' | '〇' | '一' | '二' | '三' | '四' | '五' | '六' | '七' | '八' | '九' | '十'
            | '百' | '千' | '万' | '亿' | '两' | '０'..='９' | '0'..='9'
    )
}

/// 标题行的余文检查：短、无句末标点。
fn tail_is_title_like(tail: &str) -> bool {
    let tail = tail.trim();
    // 空余文（整行就是"第一章"）当然合法
    if tail.is_empty() {
        return true;
    }
    !has_sentence_punct(tail) && tail.chars().count() <= TITLE_MAX_CHARS
}

/// L1：`第N章/回/节/卷/部/篇` 与 `Chapter N`。
fn is_l1_mark(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.chars().count() > TITLE_MAX_CHARS || trimmed.is_empty() {
        return false;
    }

    if let Some(rest) = trimmed.strip_prefix('第') {
        let numeral_len = rest.chars().take_while(|c| is_cjk_numeral(*c)).count();
        if numeral_len == 0 {
            return false;
        }
        // 字符计数 → 字节偏移（"一"占 3 字节，直接按字符数切片会炸在字符边界）
        let numeral_byte_len: usize = rest.chars().take(numeral_len).map(char::len_utf8).sum();
        let after_numeral = &rest[numeral_byte_len..];
        let Some(after_unit) =
            after_numeral.strip_prefix(['章', '回', '节', '卷', '部', '篇', '集'])
        else {
            return false;
        };
        return tail_is_title_like(after_unit);
    }

    // Chapter 12 / CHAPTER XII（大小写不敏感，后接空白 + 编号）。
    // to_ascii_lowercase 只映射 ASCII，字节长度不变。
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("chapter") {
        let original_rest = &trimmed["chapter".len()..];
        let after_space = original_rest.trim_start();
        if after_space.len() == original_rest.len() {
            return false; // "chapterhouse" 这种连写不是章节
        }
        let number_len = after_space
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .count();
        if number_len == 0 {
            return false;
        }
        let number_byte_len: usize = after_space
            .chars()
            .take(number_len)
            .map(char::len_utf8)
            .sum();
        return tail_is_title_like(&after_space[number_byte_len..]);
    }

    false
}

/// L2：`N、` / `N.` / `N：` 等数字编号行。
fn is_l2_mark(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.chars().count() > TITLE_MAX_CHARS || trimmed.is_empty() {
        return false;
    }
    let digit_len = trimmed.chars().take_while(|c| c.is_ascii_digit()).count();
    if digit_len == 0 || digit_len > 4 {
        return false;
    }
    let Some(delimiter) = trimmed[digit_len..].chars().next() else {
        return false; // 纯数字行：可能是页码、年份，不切
    };
    if !matches!(
        delimiter,
        '、' | '.' | '．' | '：' | ':' | '，' | ',' | ' ' | '　'
    ) {
        return false;
    }
    let tail = &trimmed[digit_len + delimiter.len_utf8()..];
    // "3.5 毫米"、"2026.1.1"：编号后紧跟数字是数据不是标题
    if tail.starts_with(|c: char| c.is_ascii_digit()) {
        return false;
    }
    tail_is_title_like(tail)
}

/// L3：约定俗成的独立标记词。
fn is_l3_mark(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.chars().count() > TITLE_MAX_CHARS {
        return false;
    }
    const KEYWORDS: [&str; 8] = [
        "序章", "楔子", "引子", "序幕", "尾声", "终章", "后记", "结语",
    ];
    if KEYWORDS.contains(&trimmed) {
        return true;
    }
    // "番外"可带短后缀（番外一 / 番外·生日）
    if let Some(rest) = trimmed.strip_prefix("番外") {
        return tail_is_title_like(rest) && rest.trim().chars().count() <= 10;
    }
    false
}

/// 标题文本：整行修剪（上限 50 字符，防御异常超长行）。
fn title_of(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= 50 {
        trimmed.to_string()
    } else {
        trimmed.chars().take(50).collect()
    }
}

/// 按标记行切分；首个标记之前若还有内容（书名页/简介），成"开篇"章。
fn split_at_marks(text: &str, marks: &[usize], titles: &[String]) -> Vec<RawChapter> {
    debug_assert_eq!(marks.len(), titles.len());
    let mut out = Vec::with_capacity(marks.len() + 1);
    if let Some(&first) = marks.first() {
        if first > 0 {
            out.push(RawChapter {
                title: "开篇".to_string(),
                start: 0,
                end: first as u64,
            });
        }
    }
    for (i, &start) in marks.iter().enumerate() {
        let end = marks.get(i + 1).copied().unwrap_or(text.len());
        out.push(RawChapter {
            title: titles[i].clone(),
            start: start as u64,
            end: end as u64,
        });
    }
    out
}

/// L4 兜底：按目标字数切块，边界对齐到行尾（绝不切开一行/一个字）。
fn chunk_by_chars(text: &str) -> Vec<RawChapter> {
    let total_chars = text.chars().count();
    if total_chars == 0 {
        return vec![RawChapter {
            title: "全文".to_string(),
            start: 0,
            end: 0,
        }];
    }
    if total_chars <= L4_CHUNK_CHARS {
        return vec![RawChapter {
            title: "全文".to_string(),
            start: 0,
            end: text.len() as u64,
        }];
    }

    let mut out = Vec::new();
    let mut chapter_start = 0usize;
    let mut acc = 0usize;
    for line in lines_with_offsets(text) {
        // 行尾偏移 +1（跳过换行符），让章末恰好停在换行处
        let line_end_with_nl = (line.end + 1).min(text.len());
        acc += line.text.chars().count();
        if acc >= L4_CHUNK_CHARS && line_end_with_nl < text.len() {
            out.push(RawChapter {
                title: format!("第 {} 节", out.len() + 1),
                start: chapter_start as u64,
                end: line_end_with_nl as u64,
            });
            chapter_start = line_end_with_nl;
            acc = 0;
        }
    }
    if chapter_start < text.len() {
        out.push(RawChapter {
            title: format!("第 {} 节", out.len() + 1),
            start: chapter_start as u64,
            end: text.len() as u64,
        });
    }
    out
}

/// 合并多组标记（按字节偏移排序去重）。
fn merge_marks(groups: Vec<(Vec<usize>, Vec<String>)>) -> (Vec<usize>, Vec<String>) {
    let mut merged: Vec<(usize, String)> = groups
        .into_iter()
        .flat_map(|(positions, titles)| positions.into_iter().zip(titles))
        .collect();
    merged.sort_by_key(|(pos, _)| *pos);
    merged.dedup_by_key(|(pos, _)| *pos);
    merged.into_iter().unzip()
}

/// 切分入口。
///
/// 选级规则：L1 的行级门槛极严（行首 + 短行 + 无句末标点），通过即**全数采信**；
/// L2 噪声大，单独成军需 ≥ [`L2_MIN_MARKS`]；L3 单个即可信。
/// 当 L2 / L3 为主策略时，L1 标记一并并入（"楔子 + 第一章"混排是真实存在的书）。
pub fn chapterize(text: &str) -> ChapterizeOutcome {
    let lines = lines_with_offsets(text);

    let collect = |predicate: fn(&str) -> bool| -> (Vec<usize>, Vec<String>) {
        let mut marks = Vec::new();
        let mut titles = Vec::new();
        for line in &lines {
            if predicate(line.text) {
                marks.push(line.start);
                titles.push(title_of(line.text));
            }
        }
        (marks, titles)
    };

    let (l1, l1_titles) = collect(is_l1_mark);
    let (l2, l2_titles) = collect(is_l2_mark);
    let (l3, l3_titles) = collect(is_l3_mark);

    let (marks, titles, has_real) = if l2.len() >= L2_MIN_MARKS {
        let (m, t) = merge_marks(vec![(l1, l1_titles), (l2, l2_titles)]);
        (m, t, true)
    } else if !l3.is_empty() {
        let (m, t) = merge_marks(vec![(l1, l1_titles), (l3, l3_titles)]);
        (m, t, true)
    } else if !l1.is_empty() {
        (l1, l1_titles, true)
    } else {
        (Vec::new(), Vec::new(), false)
    };

    if has_real {
        ChapterizeOutcome {
            chapters: split_at_marks(text, &marks, &titles),
            has_real_chapters: true,
        }
    } else {
        ChapterizeOutcome {
            chapters: chunk_by_chars(text),
            has_real_chapters: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 全区间无缝铺满 + 互不重叠（"不丢字"的切分面）
    fn assert_partitions_whole_text(text: &str, outcome: &ChapterizeOutcome) {
        let mut cursor = 0u64;
        for ch in &outcome.chapters {
            assert_eq!(ch.start, cursor, "章区间必须无缝衔接: {ch:?}");
            assert!(ch.end >= ch.start);
            cursor = ch.end;
        }
        assert_eq!(cursor, text.len() as u64, "必须铺满全文");
    }

    #[test]
    fn l1_splits_at_explicit_chapter_marks() {
        let text = "第一章　惊蛰\n夜里下雨。\n\n第二章　春分\n天亮了。\n\n第三章　清明\n上坟去。";
        let outcome = chapterize(text);
        assert!(outcome.has_real_chapters);
        let titles: Vec<&str> = outcome.chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, ["第一章　惊蛰", "第二章　春分", "第三章　清明"]);
        assert_partitions_whole_text(text, &outcome);
    }

    #[test]
    fn l1_preamble_becomes_opening_chapter() {
        let text = "书名：测试\n作者：某人\n\n第一章　开始\n正文。";
        let outcome = chapterize(text);
        assert_eq!(outcome.chapters[0].title, "开篇");
        assert_eq!(outcome.chapters.len(), 2);
        assert_partitions_whole_text(text, &outcome);
    }

    #[test]
    fn single_strong_mark_yields_single_titled_chapter() {
        // 只出现一次"第一章"：行级门槛通过即采信，全书成为标题正确的一章
        // （而不是退化成 L4 的"全文"）
        let text = "第一章　惊蛰\n夜里下雨。\n天亮了雨停了。";
        let outcome = chapterize(text);
        assert!(outcome.has_real_chapters);
        assert_eq!(outcome.chapters.len(), 1);
        assert_eq!(outcome.chapters[0].title, "第一章　惊蛰");
        assert_partitions_whole_text(text, &outcome);
    }

    #[test]
    fn prose_mentioning_chapter_is_not_a_mark() {
        // 验收红线：含"第一章"字样的正文句不被误判（行长超限 + 句末标点双重保护）
        let text = "大家聊起第一章的内容时都很激动，谁也没有注意到天已经黑透了。\n后来我们散了。";
        let outcome = chapterize(text);
        assert!(!outcome.has_real_chapters, "正文句不应成为标记");
    }

    #[test]
    fn l2_numeric_marks_split_with_high_threshold() {
        let text = "1 惊蛰\n夜里下雨。\n\n2 春分\n天亮了。\n\n3 清明\n上坟去。\n\n4 谷雨\n种瓜点豆。\n\n5 立夏\n天热了。";
        let outcome = chapterize(text);
        assert!(outcome.has_real_chapters);
        assert_eq!(outcome.chapters.len(), 5);
        assert_eq!(outcome.chapters[0].title, "1 惊蛰");
        assert_partitions_whole_text(text, &outcome);
    }

    #[test]
    fn l2_rejects_decimal_numbers() {
        // "3.5" 后紧跟数字：不是编号
        assert!(!is_l2_mark("3.5 毫米的雨量说大不大。"));
        // 年份后没有分隔符：不是编号
        assert!(!is_l2_mark("1937年春天来了。"));
        assert!(is_l2_mark("12、庐山恋"));
    }

    #[test]
    fn l3_keywords_split_even_alone() {
        let text = "楔子\n很久很久以前。\n\n正文第一段。";
        let outcome = chapterize(text);
        assert!(outcome.has_real_chapters);
        // 只有"楔子"一个标记：全文成为标题为"楔子"的一章（标记之后没有别的标记可切）
        assert_eq!(outcome.chapters.len(), 1);
        assert_eq!(outcome.chapters[0].title, "楔子");
        assert_partitions_whole_text(text, &outcome);

        // 楔子 + 正文章节混排（正文章由 L1 标记带出）
        let mixed = "楔子\n引子的话。\n\n第一章　开始\n正文。";
        let outcome = chapterize(mixed);
        assert_eq!(outcome.chapters.len(), 2);
        assert_eq!(outcome.chapters[0].title, "楔子");
        assert_eq!(outcome.chapters[1].title, "第一章　开始");
    }

    #[test]
    fn l4_chunks_long_unmarked_text() {
        let paragraph = "这是一段没有章节标记的正文，用来测试兜底切块。";
        // 40 字/段 × 500 段 = 2 万字 > 8000 字阈值 → 至少 2 块
        let text = std::iter::repeat_n(paragraph, 500)
            .collect::<Vec<_>>()
            .join("\n\n");
        let outcome = chapterize(&text);
        assert!(!outcome.has_real_chapters);
        assert!(outcome.chapters.len() >= 2);
        assert_eq!(outcome.chapters[0].title, "第 1 节");
        // 每块都不把一行切成两半：块边界必须在 \n 上（首字符或前一字节是 \n）
        for ch in &outcome.chapters[1..] {
            let start = ch.start as usize;
            assert!(
                start == 0 || text.as_bytes()[start - 1] == b'\n',
                "切块边界应对齐行首: {ch:?}"
            );
        }
        assert_partitions_whole_text(&text, &outcome);
    }

    #[test]
    fn l4_short_text_is_single_chapter() {
        let outcome = chapterize("就一段话。");
        assert!(!outcome.has_real_chapters);
        assert_eq!(outcome.chapters.len(), 1);
        assert_eq!(outcome.chapters[0].title, "全文");
    }

    #[test]
    fn empty_text_yields_one_empty_chapter() {
        let outcome = chapterize("");
        assert_eq!(outcome.chapters.len(), 1);
        assert_eq!(outcome.chapters[0].start, 0);
        assert_eq!(outcome.chapters[0].end, 0);
    }

    #[test]
    fn chapter_marks_with_arabic_numerals() {
        let text = "第1章 起点\n正文。\n\n第2章 转折\n正文。\n\n第100章 终点\n正文。";
        let outcome = chapterize(text);
        assert!(outcome.has_real_chapters);
        assert_eq!(outcome.chapters.len(), 3);
    }

    #[test]
    fn chapter_lines_with_punctuation_tail_are_rejected() {
        // 长行里带句号的"第一章"开头不是标题
        assert!(!is_l1_mark("第一章讲完了，大家都散了。"));
        // 短行无句末标点是标题
        assert!(is_l1_mark("第一章　惊蛰"));
        assert!(is_l1_mark("第一章：风起（上）"));
        assert!(is_l1_mark("Chapter 12 The Turning"));
    }
}
