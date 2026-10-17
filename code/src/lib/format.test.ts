import { describe, expect, it } from "vitest";

import type { BookSummary } from "../ipc/bindings";
import { bookSubtitle, describeLastRead } from "./format";

const DAY = 24 * 60 * 60 * 1000;

/** 以一个固定"今天"为基准，避免测试结果随运行时间漂移。 */
const NOW = new Date("2026-03-15T20:00:00").getTime();

function book(overrides: Partial<BookSummary> = {}): BookSummary {
  return {
    id: "b1",
    title: "测试书",
    author: null,
    sourceEncoding: "UTF-8",
    chapterCount: 1,
    hasRealChapters: true,
    lastReadAt: null,
    progressPercent: null,
    ...overrides,
  };
}

describe("describeLastRead", () => {
  it("null → 未读", () => {
    expect(describeLastRead(null, NOW)).toBe("未读");
  });

  it("今天（跨过日历日零点之前都算今天）", () => {
    expect(describeLastRead(NOW - 3 * 60 * 60 * 1000, NOW)).toBe("今天");
  });

  it("昨天", () => {
    expect(describeLastRead(NOW - 1 * DAY, NOW)).toBe("昨天");
    expect(describeLastRead(NOW - 30 * 60 * 60 * 1000, NOW)).toBe("昨天");
  });

  it("30 天内 → n 天前", () => {
    expect(describeLastRead(NOW - 5 * DAY, NOW)).toBe("5 天前");
  });

  it("更久 → 具体日期", () => {
    expect(describeLastRead(NOW - 45 * DAY, NOW)).toBe("2026/1/29");
  });
});

describe("bookSubtitle", () => {
  it("有进度 → 继续阅读 · x%", () => {
    expect(bookSubtitle(book({ progressPercent: 68 }), NOW)).toBe(
      "继续阅读 · 68%",
    );
  });

  it("进度 100 → 读完", () => {
    expect(bookSubtitle(book({ progressPercent: 100 }), NOW)).toBe("读完");
  });

  it("读过但无进度记录 → 上次阅读 · 相对时间", () => {
    expect(
      bookSubtitle(book({ progressPercent: null, lastReadAt: NOW - 2 * DAY }), NOW),
    ).toBe("上次阅读 · 2 天前");
  });

  it("从未读过 → 未读", () => {
    expect(bookSubtitle(book(), NOW)).toBe("未读");
  });
});
