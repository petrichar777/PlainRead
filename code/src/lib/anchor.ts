/**
 * 进度锚点算法（docs/02 §5.1 / §7.1，M2 第 3 步）。
 *
 * 目标：阅读位置用「章内字符偏移」表达（永不存页码——页码随字号/屏宽漂移，
 * 字符偏移不随排版参数变化），并提供 偏移 ↔ 页 双向换算：
 *
 *   恢复进度：charOffset --offsetToPage--> 页码 --> translateX
 *   保存进度：当前页 --pageToOffset--> charOffset --> save_progress
 *
 * 实现：TreeWalker 收集文本节点（文档序累加 = 锚点空间），对每个节点的
 * 每个行片段（Range.getClientRects 的一片 ≈ 一行在某一页上的部分）用
 * 单调性二分出首字符偏移，再由片段左缘换算列号。此后两个方向都是
 * 有序数组上的二分。
 *
 * 布局读取被抽象成 RectsFn 注入——Vitest（jsdom 无真实布局）用假 rects
 * 验证算法与往返不变式，真机走原生 Range。
 */

export interface RectLike {
  left: number;
  width: number;
}

/**
 * 行片段矩形读取器：第 item 个文本源在 [from, to) 字符区间内的行片段列表，
 * 按文档序。关键单调性：from 固定为 0 时，列表长度随 to 非降——二分的根基。
 */
export type RectsFn = (item: number, from: number, to: number) => RectLike[];

/** 一个文本源在锚点空间里的位置：start = 起始偏移，length = 字符数。 */
export interface FragSource {
  start: number;
  length: number;
}

/** 行片段：offset = 片段首字符的锚点偏移，col = 所在页（列）号。按 offset 递增。 */
export interface AnchorFragment {
  offset: number;
  col: number;
}

/** 客户区 x → 列号。片段左缘落在列内任意处（行首接续上一页时 dx>0），floor 即列号。 */
export function colOfX(x: number, origin: number, stride: number): number {
  return Math.floor((x - origin) / stride + 1e-4);
}

/**
 * 构建切面表。对每个源的每个行片段 j，二分出「Range[0,m) 覆盖到片段 j」的
 * 最小 m——片段首字符 = m − 1（闭区间计数的半格偏移，见测试里的模型推演）。
 */
export function collectFragments(
  sources: FragSource[],
  rectsOf: RectsFn,
  origin: number,
  stride: number,
): AnchorFragment[] {
  const out: AnchorFragment[] = [];
  for (let i = 0; i < sources.length; i++) {
    const { start, length } = sources[i];
    if (length <= 0) continue;
    const rects = rectsOf(i, 0, length).filter((r) => r.width > 0);
    for (let j = 0; j < rects.length; j++) {
      // 最小 m 使 rects(0, m) 的片段数 ≥ j+1；其首字符 = m − 1
      let lo = 1;
      let hi = length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rectsOf(i, 0, mid).filter((r) => r.width > 0).length >= j + 1) hi = mid;
        else lo = mid + 1;
      }
      out.push({ offset: start + lo - 1, col: colOfX(rects[j].left, origin, stride) });
    }
  }
  return out;
}

/**
 * 页 → 锚点偏移：该页上第一个片段的首字符（页首若在一行中间，
 * 拿到的就是那行在本页的接续起点——保存/恢复都自洽）。
 * 该页无任何片段（内容止于更前的页）时返回 null，由调用方兜底。
 */
export function pageToOffset(frags: AnchorFragment[], page: number): number | null {
  for (const f of frags) if (f.col >= page) return f.offset;
  return null;
}

/**
 * 锚点偏移 → 页：最后一个 start ≤ offset 的片段所在列。
 * 偏移落在片段中间（行内任意位置）也正确归位；Infinity → 最后一页。
 */
export function offsetToPage(frags: AnchorFragment[], offset: number): number {
  if (frags.length === 0) return 0;
  let lo = 0;
  let hi = frags.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frags[mid].offset <= offset) {
      ans = frags[mid].col;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

// ── DOM 粘合层（真机用；jsdom 测试只测上面的纯算法）──

/** TreeWalker 收集文本源与对应 Text 节点（跳过纯空白节点——它们不承载锚点）。 */
export function textSources(root: HTMLElement): { sources: FragSource[]; nodes: Text[] } {
  const sources: FragSource[] = [];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let start = 0;
  let node = walker.nextNode() as Text | null;
  while (node !== null) {
    if (node.length > 0 && node.data.trim() !== "") {
      sources.push({ start, length: node.length });
      nodes.push(node);
      start += node.length;
    }
    node = walker.nextNode() as Text | null;
  }
  return { sources, nodes };
}

/** 原生 rects 读取器：单节点 Range 的行片段（过滤零宽）。 */
export function nativeRectsOf(nodes: Text[]): RectsFn {
  return (item: number, from: number, to: number) => {
    const node = nodes[item];
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, Math.min(to, node.length));
    return Array.from(range.getClientRects());
  };
}

/** 真机入口：从渲染根建切面表。 */
export function buildFragments(root: HTMLElement, origin: number, stride: number): AnchorFragment[] {
  const { sources, nodes } = textSources(root);
  return collectFragments(sources, nativeRectsOf(nodes), origin, stride);
}
