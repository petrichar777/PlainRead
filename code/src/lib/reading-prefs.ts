/**
 * 阅读排版偏好（docs/05 §2.6 / docs/06 §4.6，M2 第 4 步起）。
 *
 * 同 theme.ts 的"存取 + 记忆"模式：localStorage 记忆，读回时净化
 * （防手改存储弄出离谱排版）。CSS 变量挂到阅读页根节点——
 * 改字号 = 改一个变量，重排由浏览器负责；锚点算法保证"变化前后停在同一句话"。
 *
 * P3 起多两项：段距（paragraph spacing）与正文字体（衬线/黑体）。
 * 旧存储缺这两个键时由 sanitizePrefs 用默认值兜底——不需要单独写迁移脚本，
 * 这正是"读回时净化"的既有价值。
 */

/** 正文字体只有两档：衬线（书感，默认）与黑体（屏幕感）。 */
export type ReadingFont = "serif" | "sans";

export interface ReadingPrefs {
  /** 正文字号 px */
  fontSize: number;
  /** 行距（行高倍数） */
  lineHeight: number;
  /** 页边距 px（左右） */
  margin: number;
  /** 段距（em 倍数）：段落之间的额外留白 */
  paraSpacing: number;
  /** 正文字体 */
  fontFamily: ReadingFont;
}

export const DEFAULT_PREFS: ReadingPrefs = {
  // 桌面 20px / 列宽 620px（docs/06 D5）：约 31 字一行
  fontSize: 20,
  lineHeight: 1.95,
  margin: 20,
  paraSpacing: 0.55,
  fontFamily: "serif",
};

export const PREFS_LIMITS = {
  fontSize: { min: 14, max: 28, step: 1 },
  lineHeight: { min: 1.5, max: 2.4, step: 0.05 },
  margin: { min: 8, max: 40, step: 2 },
  paraSpacing: { min: 0, max: 1.4, step: 0.05 },
} as const;

/** 字体档位 → CSS 变量值（栈本身定义在 main.css 的 --ui-font-* 令牌里）。 */
export const FONT_STACKS: Record<ReadingFont, string> = {
  serif: "var(--ui-font-serif)",
  sans: "var(--ui-font)",
};

const STORAGE_KEY = "plainread.reading-prefs";

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isFont(value: unknown): value is ReadingFont {
  return value === "serif" || value === "sans";
}

/** 任意来源的偏好数据 → 合法偏好（越界收边、非法回默认、缺键兜底）。 */
export function sanitizePrefs(
  input: Partial<Record<keyof ReadingPrefs, unknown>>,
): ReadingPrefs {
  const { fontSize, lineHeight, margin, paraSpacing } = PREFS_LIMITS;
  return {
    fontSize: clamp(num(input.fontSize, DEFAULT_PREFS.fontSize), fontSize.min, fontSize.max),
    lineHeight: clamp(num(input.lineHeight, DEFAULT_PREFS.lineHeight), lineHeight.min, lineHeight.max),
    margin: clamp(num(input.margin, DEFAULT_PREFS.margin), margin.min, margin.max),
    paraSpacing: clamp(
      num(input.paraSpacing, DEFAULT_PREFS.paraSpacing),
      paraSpacing.min,
      paraSpacing.max,
    ),
    fontFamily: isFont(input.fontFamily) ? input.fontFamily : DEFAULT_PREFS.fontFamily,
  };
}

export function loadReadingPrefs(): ReadingPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_PREFS };
    return sanitizePrefs(JSON.parse(raw) as Partial<ReadingPrefs>);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveReadingPrefs(prefs: ReadingPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 存储不可用：偏好仍对本会话生效，只是不记忆
  }
}

/** 偏好 → 阅读页根节点的 CSS 变量（--rd-font-* 命名，架构 §7.5）。 */
export function prefsToCssVars(prefs: ReadingPrefs): Record<string, string> {
  return {
    "--rd-font-size": `${prefs.fontSize}px`,
    "--rd-line-height": String(prefs.lineHeight),
    "--rd-page-margin": `${prefs.margin}px`,
    "--rd-para-spacing": `${prefs.paraSpacing}em`,
    "--rd-font-family": FONT_STACKS[prefs.fontFamily],
  };
}
