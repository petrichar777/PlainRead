import type { BookSummary } from "../ipc/bindings";

/**
 * 书架用的纯格式化函数：无副作用、不碰 DOM，可被 Vitest 直接覆盖。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 「上次阅读」的相对时间：今天 / 昨天 / n 天前 / 具体日期。
 * 只做日历日的粗粒度区分——书架不需要"3 小时前"这种即时感。
 */
export function describeLastRead(lastReadAt: number | null, now: number): string {
  if (lastReadAt === null) return "未读";

  const startOfDay = (ms: number): number => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const dayDiff = Math.round((startOfDay(now) - startOfDay(lastReadAt)) / DAY_MS);

  if (dayDiff <= 0) return "今天";
  if (dayDiff === 1) return "昨天";
  if (dayDiff < 30) return `${dayDiff} 天前`;

  const d = new Date(lastReadAt);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 由进度百分比反推「当前在第几章」的**近似值**。
 *
 * 为什么是近似：`BookSummary` 只有 `progressPercent`，没有章索引
 * （docs/06 §7 数据缺口）。而后端的百分比本身就是按章节近似的
 * （`progress_percent_is_chapter_approximation`），所以反推与它是同一口径。
 *
 * 用途仅限书架/侧栏的展示文案（「CH.118 / 342」），
 * **不参与任何阅读位置计算**——真实位置永远走「章号 + 字符偏移」。
 */
export function approxChapter(book: BookSummary): number | null {
  const percent = book.progressPercent ?? null;
  if (percent === null) return null;
  const count = Math.max(1, book.chapterCount);
  const index = Math.round((percent / 100) * count);
  return Math.min(count, Math.max(1, index));
}

/**
 * 书卡副标题（docs/05 §3.1）：
 * 有进度 → 「继续阅读 · x%」或「读完」；只读过但无进度记录 → 「上次阅读 · …」；否则「未读」。
 *
 * 注：`progressPercent` 要等 M1 仓储把 `progress` 表 join 进 `list_books` 才有值，
 * 现阶段的真实数据只会落到后两个分支。
 */
export function bookSubtitle(book: BookSummary, now: number): string {
  const percent = book.progressPercent ?? null;
  if (percent !== null) {
    if (percent >= 100) return "读完";
    return `继续阅读 · ${percent}%`;
  }
  if (book.lastReadAt !== null) {
    return `上次阅读 · ${describeLastRead(book.lastReadAt, now)}`;
  }
  return "未读";
}
