import type { ChapterDto } from "../ipc/bindings";

/**
 * 章节文本缓存（M2：上下章预取）。
 *
 * 章节内容来自 content.txt 的只读字节区间——**不可变**，缓存无失效问题；
 * 书删了缓存顶多留到进程退出，无需挂删除钩子。模块级 Map（跨 Reader 挂载存活：
 * 回书架再进同一本书，上次读的章仍然秒开），FIFO 容量上限防长会话膨胀。
 */

const cache = new Map<string, ChapterDto>();

/** 容量上限：预取窗口（±1 章）+ 快速连续翻章的余量，足够了。 */
const MAX_ENTRIES = 12;

export function chapterCacheKey(bookId: string, index: number): string {
  return `${bookId}:${index}`;
}

export function getCachedChapter(bookId: string, index: number): ChapterDto | null {
  return cache.get(chapterCacheKey(bookId, index)) ?? null;
}

export function putCachedChapter(bookId: string, index: number, dto: ChapterDto): void {
  cache.set(chapterCacheKey(bookId, index), dto);
  // FIFO 淘汰：Map 保持插入序，最老的先出
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** 批量预取：跳过已缓存的，失败静默（预取失败不构成错误，下次真读会再试）。 */
export function prefetchChapters(
  bookId: string,
  indexes: number[],
  load: (bookId: string, index: number) => Promise<ChapterDto>,
): void {
  for (const index of indexes) {
    if (getCachedChapter(bookId, index) !== null) continue;
    void load(bookId, index)
      .then((dto) => putCachedChapter(bookId, index, dto))
      .catch(() => {});
  }
}

/** 测试钩子：清空缓存。 */
export function clearChapterCache(): void {
  cache.clear();
}

/** 测试钩子：当前缓存条数。 */
export function chapterCacheSize(): number {
  return cache.size;
}
