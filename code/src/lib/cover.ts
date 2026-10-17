/**
 * 生成式占位封面（docs/05 §3.1）。
 *
 * TXT 天然没有封面，灰块阵列是市面阅读器最丑的通病。
 * 方案：书名首字大号衬线字 + 从书名 hash 出的 6 组莫兰迪渐变循环，
 * 书架才有"一排书"的观感。渐变色值定义在 main.css 的 --ui-cover-* 令牌里，
 * 这里只负责「hash → 选中哪一组」，不含任何裸色值。
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

/** 书名对应的封面渐变（CSS `background` 值，引用 --ui-cover-* 令牌）。 */
export function coverGradient(title: string): string {
  const index = (hashTitle(title) % COVER_VARIANTS) + 1;
  return `var(--ui-cover-${index})`;
}

/** 封面上的大字：书名首字；空标题回退为"书"。 */
export function coverChar(title: string): string {
  const first = [...title.trim()][0];
  return first ?? "书";
}
