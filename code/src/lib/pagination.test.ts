import { describe, expect, it } from "vitest";

import { clampPage, pageOffset, pageStride, totalPages } from "./pagination";

describe("pagination", () => {
  it("pageStride = 页宽 + 间距", () => {
    expect(pageStride(375, 32)).toBe(407);
  });

  it("totalPages：单页内容", () => {
    // scrollWidth ≤ 页宽 → 1 页
    expect(totalPages(300, 375)).toBe(1);
    expect(totalPages(375, 375)).toBe(1);
  });

  it("totalPages：多页内容（n·W + (n−1)·G 反推 n）", () => {
    // 3 页：3·375 + 2·32 = 1189
    expect(totalPages(1189, 375)).toBe(3);
    // 分页边界附近不得因浮点/舍入漂移
    expect(totalPages(1188, 375)).toBe(3);
    expect(totalPages(1190, 375)).toBe(3);
    // 2 页：2·375 + 32 = 782
    expect(totalPages(782, 375)).toBe(2);
  });

  it("totalPages：非法输入退化为 1 页", () => {
    expect(totalPages(0, 375)).toBe(1);
    expect(totalPages(1000, 0)).toBe(1);
  });

  it("pageOffset：页码 → translateX", () => {
    expect(pageOffset(0, 375)).toBe(-0);
    expect(pageOffset(2, 375)).toBe(-814);
  });

  it("clampPage：收进 [0, count−1]", () => {
    expect(clampPage(5, 3)).toBe(2);
    expect(clampPage(-1, 3)).toBe(0);
    expect(clampPage(0, 0)).toBe(0);
  });
});
