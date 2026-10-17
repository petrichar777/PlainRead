/**
 * CSS 多列分页的纯数学（docs/02 §7.1）。
 *
 * 布局模型：track 宽 100%，`column-width = 视口宽`、`column-gap = G`，
 * 内容顺序填满一列再开下一列——每列就是一页。
 * n 页的 track 总宽 = n·W + (n−1)·G，反推 n 即总页数。
 */

/** 页间距（列间距）：与 main.css 的 .reader-track column-gap 保持一致。 */
export const PAGE_GAP = 32;

/** 一页位移的步长：页宽 + 间距。 */
export function pageStride(pageWidth: number, gap: number = PAGE_GAP): number {
  return pageWidth + gap;
}

/**
 * 由 track 的 scrollWidth 反推总页数。
 * scrollWidth 是"内容盒"宽度，不含最后一条列间 gap，所以先补回再除。
 * 至少 1 页（空章也是一页）。
 */
export function totalPages(scrollWidth: number, pageWidth: number, gap: number = PAGE_GAP): number {
  const stride = pageStride(pageWidth, gap);
  if (pageWidth <= 0 || stride <= 0 || scrollWidth <= 0) return 1;
  return Math.max(1, Math.round((scrollWidth + gap) / stride));
}

/** 第 page 页的 translateX 位移（负值向左）。 */
export function pageOffset(page: number, pageWidth: number, gap: number = PAGE_GAP): number {
  return -page * pageStride(pageWidth, gap);
}

/** 页码收进合法区间（重排/缩放后页数变少时防越界）。 */
export function clampPage(page: number, count: number): number {
  return Math.min(Math.max(0, page), Math.max(0, count - 1));
}
