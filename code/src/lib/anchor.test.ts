import { describe, expect, it } from "vitest";

import {
  colOfX,
  collectFragments,
  offsetToPage,
  pageToOffset,
  type FragSource,
  type RectsFn,
} from "./anchor";

/**
 * 假布局模型：每个源按每 K 字符断一行片段，片段 j 覆盖 [jK, (j+1)K)。
 * rects(0, m) 的片段数 = m===0 ? 0 : floor((m−1)/K) + 1（对 m 单调——与
 * 真实 Range.getClientRects 的行为同构，这正是二分能成立的前提）。
 * 各片段的列号由测试指定（cols[j]），可模拟"行接续到下一页"的中途起点。
 */
function makeRectsFn(
  sources: FragSource[],
  colsPerSource: number[][],
  opts: { K: number; origin: number; stride: number; skew?: number },
): RectsFn {
  const { K, origin, stride, skew = 0 } = opts;
  return (item: number, from: number, to: number) => {
    if (from === 0 && to === 0) return [];
    const len = sources[item].length;
    const count = Math.min(Math.floor((to - 1) / K) + 1, Math.ceil(len / K));
    const rects = [];
    for (let j = 0; j < count; j++) {
      rects.push({
        left: origin + colsPerSource[item][j] * stride + (j > 0 ? skew : 0),
        width: 100,
      });
    }
    return rects;
  };
}

describe("colOfX", () => {
  it("列起点与列中途都归到同一列", () => {
    expect(colOfX(100, 100, 407)).toBe(0);
    expect(colOfX(107, 100, 407)).toBe(0); // 行接续：列内偏移 7px
    expect(colOfX(507, 100, 407)).toBe(1);
  });
});

describe("collectFragments", () => {
  it("二分出的片段首字符偏移 = j·K（K=10 模型）", () => {
    const sources: FragSource[] = [{ start: 0, length: 35 }];
    const rectsOf = makeRectsFn(sources, [[0, 1, 2, 2]], { K: 10, origin: 0, stride: 100 });
    const frags = collectFragments(sources, rectsOf, 0, 100);
    expect(frags.map((f) => f.offset)).toEqual([0, 10, 20, 30]);
    expect(frags.map((f) => f.col)).toEqual([0, 1, 2, 2]);
  });

  it("多源（标题 + 正文）：锚点空间跨源连续累加", () => {
    const sources: FragSource[] = [
      { start: 0, length: 5 },
      { start: 5, length: 40 },
    ];
    const rectsOf = makeRectsFn(
      sources,
      [
        [0],
        [0, 1, 1, 2],
      ],
      { K: 10, origin: 0, stride: 100 },
    );
    const frags = collectFragments(sources, rectsOf, 0, 100);
    expect(frags.map((f) => f.offset)).toEqual([0, 5, 15, 25, 35]);
    expect(frags.map((f) => f.col)).toEqual([0, 0, 1, 1, 2]);
  });

  it("行接续片段（列中途起点）列号不漂移", () => {
    const sources: FragSource[] = [{ start: 0, length: 40 }];
    const rectsOf = makeRectsFn(sources, [[0, 0, 1, 1]], {
      K: 10,
      origin: 0,
      stride: 100,
      skew: 7, // 第 2 个片段起 left 加 7px，仍在同列内
    });
    const frags = collectFragments(sources, rectsOf, 0, 100);
    expect(frags.map((f) => f.col)).toEqual([0, 0, 1, 1]);
  });
});

describe("pageToOffset / offsetToPage 往返不变式", () => {
  const sources: FragSource[] = [
    { start: 0, length: 5 },
    { start: 5, length: 40 },
  ];
  const rectsOf = makeRectsFn(
    sources,
    [
      [0],
      [0, 1, 1, 2],
    ],
    { K: 10, origin: 0, stride: 100 },
  );
  const frags = collectFragments(sources, rectsOf, 0, 100);

  it("对每个有内容的页：offsetToPage(pageToOffset(p)) === p", () => {
    for (let p = 0; p <= 2; p++) {
      const off = pageToOffset(frags, p);
      expect(off).not.toBeNull();
      expect(offsetToPage(frags, off as number)).toBe(p);
    }
  });

  it("行内偏移归位到所在片段的列", () => {
    expect(offsetToPage(frags, 14)).toBe(0); // 片段 [5,15) 列 0
    expect(offsetToPage(frags, 15)).toBe(1); // 15 是下一片段起点，归列 1
    expect(offsetToPage(frags, 16)).toBe(1); // 片段 [15,25) 列 1
  });

  it("边界：越界偏移与越界页", () => {
    expect(offsetToPage(frags, -5)).toBe(0);
    expect(offsetToPage(frags, Number.POSITIVE_INFINITY)).toBe(2);
    expect(pageToOffset(frags, 5)).toBeNull(); // 内容止于第 2 页
  });

  it("空切面表 → 第 0 页", () => {
    expect(offsetToPage([], 100)).toBe(0);
    expect(pageToOffset([], 0)).toBeNull();
  });
});
