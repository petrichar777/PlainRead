import { describe, expect, it } from "vitest";

import {
  chapterCacheSize,
  clearChapterCache,
  getCachedChapter,
  prefetchChapters,
  putCachedChapter,
} from "./chapter-cache";
import type { ChapterDto } from "../ipc/bindings";

function dto(text: string): ChapterDto {
  return { index: 0, title: "章", text };
}

describe("chapter cache", () => {
  it("存取往返 + 书与章号隔离", () => {
    clearChapterCache();
    putCachedChapter("b1", 3, dto("甲"));
    expect(getCachedChapter("b1", 3)?.text).toBe("甲");
    expect(getCachedChapter("b1", 4)).toBeNull();
    expect(getCachedChapter("b2", 3)).toBeNull();
  });

  it("FIFO 容量上限 12：最老的先淘汰", () => {
    clearChapterCache();
    for (let i = 0; i < 14; i++) putCachedChapter("b1", i, dto(String(i)));
    expect(chapterCacheSize()).toBe(12);
    expect(getCachedChapter("b1", 0)).toBeNull(); // 最老的两章被挤掉
    expect(getCachedChapter("b1", 1)).toBeNull();
    expect(getCachedChapter("b1", 13)?.text).toBe("13");
  });

  it("重复 put 同一 key 不产生重复条目（覆盖语义）", () => {
    clearChapterCache();
    putCachedChapter("b1", 0, dto("a"));
    putCachedChapter("b1", 0, dto("b"));
    expect(chapterCacheSize()).toBe(1);
    expect(getCachedChapter("b1", 0)?.text).toBe("b");
  });

  it("prefetchChapters：只取未缓存的，失败静默", async () => {
    clearChapterCache();
    putCachedChapter("b1", 1, dto("cached"));
    const loads: number[] = [];
    const load = async (_bookId: string, index: number) => {
      loads.push(index);
      if (index === 9) throw new Error("boom"); // 预取失败不冒泡
      return dto(`ch${index}`);
    };
    prefetchChapters("b1", [0, 1, 2, 9], load);
    await Promise.resolve();
    await Promise.resolve();
    expect(loads).toEqual([0, 2, 9]); // 已缓存的 1 跳过
    expect(getCachedChapter("b1", 2)?.text).toBe("ch2");
    expect(getCachedChapter("b1", 9)).toBeNull(); // 失败不写入
  });
});
