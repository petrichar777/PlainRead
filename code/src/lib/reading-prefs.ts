/**
 * 阅读排版偏好（docs/05 §2.6：字号 / 行距 / 页边距，M2 第 4 步）。
 *
 * 同 theme.ts 的"存取 + 记忆"模式：localStorage 记忆，读回时净化
 * （防手改存储弄出离谱排版）。CSS 变量挂到阅读页根节点——
 * 改字号 = 改一个变量，重排由浏览器负责；锚点算法保证"变化前后停在同一句话"。
 */

export interface ReadingPrefs {
  /** 正文字号 px */
  fontSize: number;
  /** 行距（行高倍数） */
  lineHeight: number;
  /** 页边距 px（左右） */
  margin: number;
}

export const DEFAULT_PREFS: ReadingPrefs = {
  fontSize: 17,
  lineHeight: 1.9,
  margin: 20,
};

export const PREFS_LIMITS = {
  fontSize: { min: 14, max: 24, step: 1 },
  lineHeight: { min: 1.5, max: 2.4, step: 0.1 },
  margin: { min: 8, max: 40, step: 2 },
} as const;

const STORAGE_KEY = "plainread.reading-prefs";

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 任意来源的偏好数据 → 合法偏好（越界收边、非法回默认）。 */
export function sanitizePrefs(input: Partial<Record<keyof ReadingPrefs, unknown>>): ReadingPrefs {
  const { fontSize, lineHeight, margin } = PREFS_LIMITS;
  return {
    fontSize: clamp(num(input.fontSize, DEFAULT_PREFS.fontSize), fontSize.min, fontSize.max),
    lineHeight: clamp(num(input.lineHeight, DEFAULT_PREFS.lineHeight), lineHeight.min, lineHeight.max),
    margin: clamp(num(input.margin, DEFAULT_PREFS.margin), margin.min, margin.max),
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
  };
}
