import type { Theme } from "../ipc/bindings";

/**
 * 主题的存取（docs/05 §2.2 / §2.3）。
 *
 * 书架、目录、设置的 chrome 跟随阅读主题明暗——不做"阅读页夜间、书架白色"的割裂感。
 * 1.0 没有全局设置页（M3），这里只提供「应用 + 记忆」两个动作；
 * 默认纸黄：阅读器的第一印象应当是"纸"，不是"屏幕"。
 *
 * 刻意不做成 React Context：当前只有挂载时一个消费点，
 * 等设置页（M3）需要跨组件响应式切换时再升级，不过度设计。
 */

const STORAGE_KEY = "plainread.theme";

export const DEFAULT_THEME: Theme = "paper";

export function isTheme(value: unknown): value is Theme {
  return value === "white" || value === "paper" || value === "night";
}

/** 读回记忆的主题；存储值非法时回退默认（防手改 localStorage 弄白屏）。 */
export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** 应用主题到 `<html data-theme>` 并记忆。 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 隐私模式等存储不可用的场景：主题仍对本会话生效，只是不记忆
  }
}
