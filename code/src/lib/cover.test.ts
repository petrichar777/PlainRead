import { describe, expect, it } from "vitest";

import { bookCode, coverChar, coverGradient, coverPair, coverVariant, hashTitle } from "./cover";

describe("hashTitle", () => {
  it("对同一书名结果稳定", () => {
    expect(hashTitle("三体")).toBe(hashTitle("三体"));
  });

  it("不同书名得到不同渐变组的概率下，hash 值应当区分开", () => {
    // 不要求全局唯一，只要求常用书名不会全部挤在同一个值
    const hashes = new Set(
      ["三体", "围城", "白鹿原", "剑来", "平凡的世界", "明朝那些事儿"].map(
        hashTitle,
      ),
    );
    expect(hashes.size).toBeGreaterThan(3);
  });

  it("返回值是无符号 32 位整数", () => {
    const hash = hashTitle("长安十二时辰");
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("coverGradient", () => {
  it("总是引用 --ui-cover-1..6 令牌（组件里不允许裸色值）", () => {
    for (const title of ["三体", "a", "很长的书名很长的书名", "Strangers"]) {
      expect(coverGradient(title)).toMatch(/^var\(--ui-cover-[1-6]\)$/);
    }
  });
});

describe("coverVariant", () => {
  it("落在 1–6 且与渐变组一致", () => {
    for (const title of ["三体", "a", "剑来", "", "Strangers"]) {
      const variant = coverVariant(title);
      expect(variant).toBeGreaterThanOrEqual(1);
      expect(variant).toBeLessThanOrEqual(6);
      expect(coverGradient(title)).toBe(`var(--ui-cover-${variant})`);
    }
  });
});

describe("coverPair", () => {
  it("起止色引用同一组的 -a / -b 令牌（立体书的顶面与书脊要用同一个色）", () => {
    for (const title of ["三体", "剑来", "Strangers"]) {
      const index = coverVariant(title);
      expect(coverPair(title)).toEqual({
        a: `var(--ui-cover-${index}-a)`,
        b: `var(--ui-cover-${index}-b)`,
      });
    }
  });
});

describe("bookCode", () => {
  it("UUID 去连字符取前 6 位并大写，带 WJ- 前缀", () => {
    expect(bookCode("0001abcd-2345-4def-8abc-0123456789ab")).toBe("WJ-0001AB");
  });

  it("不含连字符的 id 同样处理", () => {
    expect(bookCode("abcdef12")).toBe("WJ-ABCDEF");
  });

  it("短 id 有多少取多少，不补位也不抛错", () => {
    expect(bookCode("ab-cd")).toBe("WJ-ABCD");
  });
});

describe("coverChar", () => {
  it("取书名首字", () => {
    expect(coverChar("剑来")).toBe("剑");
    expect(coverChar("  三体")).toBe("三");
  });

  it("空标题回退为「书」", () => {
    expect(coverChar("")).toBe("书");
    expect(coverChar("   ")).toBe("书");
  });

  it("按码点而非 UTF-16 单元取字（避免代理对被劈成半个字符）", () => {
    expect(coverChar("𠀀 lax")).toBe("𠀀");
  });
});
