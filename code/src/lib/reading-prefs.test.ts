import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREFS,
  loadReadingPrefs,
  prefsToCssVars,
  sanitizePrefs,
} from "./reading-prefs";

describe("sanitizePrefs", () => {
  it("默认值原样通过", () => {
    expect(sanitizePrefs(DEFAULT_PREFS)).toEqual(DEFAULT_PREFS);
  });

  it("越界收边", () => {
    expect(sanitizePrefs({ fontSize: 100, lineHeight: 5, margin: 0 })).toEqual({
      fontSize: 24,
      lineHeight: 2.4,
      margin: 8,
    });
    expect(sanitizePrefs({ fontSize: 1, lineHeight: 0.5, margin: -3 })).toEqual({
      fontSize: 14,
      lineHeight: 1.5,
      margin: 8,
    });
  });

  it("非法值（非数字 / NaN / 缺失）回默认", () => {
    expect(sanitizePrefs({ fontSize: NaN })).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs({ lineHeight: "大" as unknown as number })).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs({})).toEqual(DEFAULT_PREFS);
  });
});

describe("prefsToCssVars", () => {
  it("映射为 --rd-* 变量（单位就位）", () => {
    expect(prefsToCssVars({ fontSize: 19, lineHeight: 2, margin: 12 })).toEqual({
      "--rd-font-size": "19px",
      "--rd-line-height": "2",
      "--rd-page-margin": "12px",
    });
  });
});

describe("loadReadingPrefs", () => {
  // vitest 默认 node 环境（无 localStorage）；有 Web Storage 的环境才跑存储路径。
  // 净化逻辑本身已由 sanitizePrefs 用例全覆盖，这里只补"坏存储不弄崩加载"。
  const hasStorage = typeof localStorage !== "undefined";

  (hasStorage ? it : it.skip)("存储为空 → 默认偏好", () => {
    expect(loadReadingPrefs()).toEqual(DEFAULT_PREFS);
  });

  (hasStorage ? it : it.skip)("存储损坏（非 JSON）→ 默认偏好而不抛", () => {
    localStorage.setItem("plainread.reading-prefs", "{oops");
    expect(loadReadingPrefs()).toEqual(DEFAULT_PREFS);
  });

  (hasStorage ? it : it.skip)("存储越界 → 净化后返回", () => {
    localStorage.setItem(
      "plainread.reading-prefs",
      JSON.stringify({ fontSize: 40, margin: 99 }),
    );
    expect(loadReadingPrefs()).toEqual({ fontSize: 24, lineHeight: 1.9, margin: 40 });
  });
});
