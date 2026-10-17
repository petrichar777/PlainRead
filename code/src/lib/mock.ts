import type { BookSummary } from "../ipc/bindings";

/**
 * 书架视觉预览用的示例数据（数值取自设计草图的六本书）。
 *
 * 只在「诊断页 → 书架视觉预览」入口出现，不进入真实数据流：
 * 导入管线落地前，它让书卡的网格/列表/多选形态可以被肉眼验收。
 */
export function sampleBooks(now: number): BookSummary[] {
  const minutes = 60 * 1000;
  return [
    {
      id: "mock-1",
      title: "长安十二时辰",
      author: "马伯庸",
      sourceEncoding: "UTF-8",
      chapterCount: 46,
      hasRealChapters: true,
      lastReadAt: now - 90 * minutes,
      progressPercent: 68,
    },
    {
      id: "mock-2",
      title: "三体",
      author: "刘慈欣",
      sourceEncoding: "GBK",
      chapterCount: 91,
      hasRealChapters: true,
      lastReadAt: now - 26 * 60 * minutes,
      progressPercent: 100,
    },
    {
      id: "mock-3",
      title: "明朝那些事儿",
      author: "当年明月",
      sourceEncoding: "GBK",
      chapterCount: 321,
      hasRealChapters: true,
      lastReadAt: now - 2 * 24 * 60 * minutes,
      progressPercent: 12,
    },
    {
      id: "mock-4",
      title: "白鹿原",
      author: "陈忠实",
      sourceEncoding: "GB18030",
      chapterCount: 34,
      hasRealChapters: true,
      lastReadAt: null,
      progressPercent: null,
    },
    {
      id: "mock-5",
      title: "平凡的世界",
      author: "路遥",
      sourceEncoding: "GBK",
      chapterCount: 54,
      hasRealChapters: true,
      lastReadAt: now - 5 * 24 * 60 * minutes,
      progressPercent: 45,
    },
    {
      id: "mock-6",
      title: "围城",
      author: "钱锺书",
      sourceEncoding: "Big5",
      chapterCount: 9,
      hasRealChapters: false,
      lastReadAt: now - 40 * 24 * 60 * minutes,
      progressPercent: null,
    },
  ];
}
