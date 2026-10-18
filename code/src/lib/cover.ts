/**
 * 生成式占位封面（docs/05 §3.1 / docs/06 §4.2）。
 *
 * TXT 天然没有封面，灰块阵列是市面阅读器最丑的通病。
 * 方案：书名首字/竖排书名 + 从书名 hash 出的 6 组低饱和莫兰迪，
 * 书墙才有"一排书"的观感。色值全部定义在 main.css 的 --ui-cover-* 令牌里，
 * 这里只负责「hash → 选中哪一组」，不含任何裸色值。
 *
 * v2 起封面拆成 a（起）/ b（止）两色：立体书的顶面与书脊各用一个，
 * 靠亮度差造出厚度。单条渐变别名 --ui-cover-N 仍保留给列表缩略图。
 */

/** FNV-1a 32 位：无依赖、分布均匀、对短书名足够。 */
export function hashTitle(title: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(title)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const COVER_VARIANTS = 6;

/** 书名对应的封面组号（1–6）。 */
export function coverVariant(title: string): number {
  return (hashTitle(title) % COVER_VARIANTS) + 1;
}

/** 书名对应的封面起止色（CSS 变量引用，供立体书的 face/top/spine 使用）。 */
export function coverPair(title: string): { a: string; b: string } {
  const index = coverVariant(title);
  return {
    a: `var(--ui-cover-${index}-a)`,
    b: `var(--ui-cover-${index}-b)`,
  };
}

/** 书名对应的封面渐变（CSS `background` 值，引用 --ui-cover-* 令牌）。 */
export function coverGradient(title: string): string {
  return `var(--ui-cover-${coverVariant(title)})`;
}

/** 封面上的大字：书名首字；空标题回退为"书"。 */
export function coverChar(title: string): string {
  const first = [...title.trim()][0];
  return first ?? "书";
}

/**
 * 档案编号（docs/06 §4.2）：`BookSummary.id` 是 UUID，前 6 位足够稳定，
 * 去掉连字符后大写，形如 `WJ-000118`。它是界面上的"馆藏号"，
 * 让书架从"卡片堆"变成"有编目的收藏"。
 */
export function bookCode(id: string): string {
  return `WJ-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
