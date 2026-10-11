//! 阅读设置。

use serde::{Deserialize, Serialize};

/// 主题。
///
/// 具体色值不在内核里定义——那是表现层的职责。
/// 内核只回答"用户选了哪套主题"，前端把它映射成 CSS 变量。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeId {
    #[default]
    White,
    Paper,
    Night,
}

/// 翻页交互方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PageTurnMode {
    /// 点击屏幕左 / 中 / 右三分区
    #[default]
    TapZones,
    /// 左右滑动
    Swipe,
    /// 两者同时启用
    Both,
}

/// 字体选择。
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum FontChoice {
    /// 使用系统默认中文字体，由渲染引擎自动做字体回退。
    #[default]
    SystemDefault,
    /// 指定一个系统字体族名。
    Family(String),
    /// 用户导入的字体文件路径。
    Imported(String),
}

/// 阅读设置。
///
/// 数值单位统一是**逻辑像素**（CSS px），由渲染层负责乘以设备像素比。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderSettings {
    pub font: FontChoice,
    pub font_size: f32,
    /// 行高倍数（相对字号），如 1.6。
    pub line_height: f32,
    /// 字距，逻辑像素。中文正文通常保持 0。
    pub letter_spacing: f32,
    /// 左右页边距。
    pub margin_h: f32,
    /// 上下页边距。
    pub margin_v: f32,
    /// 段首缩进两字。
    pub indent_first_line: bool,
    pub theme: ThemeId,
    pub page_turn: PageTurnMode,
    /// 阅读时保持屏幕常亮。
    pub keep_screen_on: bool,
}

impl Default for ReaderSettings {
    fn default() -> Self {
        Self {
            font: FontChoice::SystemDefault,
            font_size: 18.0,
            line_height: 1.6,
            letter_spacing: 0.0,
            margin_h: 20.0,
            margin_v: 16.0,
            indent_first_line: true,
            theme: ThemeId::White,
            page_turn: PageTurnMode::TapZones,
            keep_screen_on: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_comfortable_for_chinese_reading() {
        let s = ReaderSettings::default();
        assert!(s.font_size >= 16.0, "默认字号不该小于 16px");
        assert!(s.line_height >= 1.5, "中文正文行高不宜小于 1.5");
        assert!(s.indent_first_line, "中文小说默认应当段首缩进");
        assert_eq!(s.theme, ThemeId::White);
    }

    #[test]
    fn settings_round_trip() {
        let s = ReaderSettings::default();
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"fontSize\""));
        assert!(json.contains("\"lineHeight\""));
        let back: ReaderSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn font_choice_is_adjacently_tagged() {
        assert_eq!(
            serde_json::to_string(&FontChoice::SystemDefault).unwrap(),
            r#"{"kind":"systemDefault"}"#
        );
        assert_eq!(
            serde_json::to_string(&FontChoice::Family("Noto Serif CJK SC".into())).unwrap(),
            r#"{"kind":"family","value":"Noto Serif CJK SC"}"#
        );
    }

    #[test]
    fn theme_serializes_as_camel_case() {
        assert_eq!(
            serde_json::to_string(&ThemeId::Night).unwrap(),
            r#""night""#
        );
        assert_eq!(
            serde_json::to_string(&PageTurnMode::TapZones).unwrap(),
            r#""tapZones""#
        );
    }
}
