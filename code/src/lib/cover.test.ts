import { describe, expect, it } from "vitest";

import { coverChar, coverGradient, hashTitle } from "./cover";

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
