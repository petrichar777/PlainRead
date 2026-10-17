import type { BookSummary } from "../ipc/bindings";

/**
 * 书架搜索（纯函数，Vitest 直接覆盖）：
 * 标题 / 作者「包含即命中」，大小写不敏感；空（或全空白）查询 = 原样返回。
 *
 * 故意不做拼音首字母、模糊音那类花活——书架规模下前缀/子串匹配
 * 已经覆盖"我想看那本书"的全部场景，多余智能只是多余延迟。
 */
export function filterBooks(books: BookSummary[], query: string): BookSummary[] {
  const q = query.trim().toLowerCase();
  if (q === "") return books;
  return books.filter(
    (b) =>
      b.title.toLowerCase().includes(q) ||
      (b.author ?? "").toLowerCase().includes(q),
  );
}
