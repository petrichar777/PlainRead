import { describe, expect, it } from "vitest";

import type { BookSummary } from "../ipc/bindings";
import { filterBooks } from "./search";

function book(overrides: Partial<BookSummary> = {}): BookSummary {
  return {
    id: "b1",
    title: "星海征途",
    author: null,
    sourceEncoding: "GBK",
    chapterCount: 12,
    hasRealChapters: true,
    lastReadAt: null,
    progressPercent: null,
    ...overrides,
  };
}

describe("filterBooks", () => {
  const books = [
    book({ id: "1", title: "星海征途" }),
    book({ id: "2", title: "凡人修真录", author: "忘语" }),
    book({ id: "3", title: "Star Voyage" }),
  ];

  it("空查询 / 纯空白 → 原样返回（不复制数组语义也可，但保持同序）", () => {
    expect(filterBooks(books, "")).toEqual(books);
    expect(filterBooks(books, "   ")).toEqual(books);
  });

  it("标题包含即命中", () => {
    expect(filterBooks(books, "星海").map((b) => b.id)).toEqual(["1"]);
  });

  it("大小写不敏感", () => {
    expect(filterBooks(books, "star").map((b) => b.id)).toEqual(["3"]);
    expect(filterBooks(books, "VOYAGE").map((b) => b.id)).toEqual(["3"]);
  });

  it("作者也能搜到", () => {
    expect(filterBooks(books, "忘语").map((b) => b.id)).toEqual(["2"]);
  });

  it("查询两端空白被忽略", () => {
    expect(filterBooks(books, "  征途  ").map((b) => b.id)).toEqual(["1"]);
  });

  it("无命中 → 空数组", () => {
    expect(filterBooks(books, "不存在的书名")).toEqual([]);
  });
});
