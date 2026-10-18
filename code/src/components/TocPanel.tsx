import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import type { ChapterMetaDto } from "../ipc/bindings";

/**
 * 目录右栏（docs/06 §4.6）：320px，桌面常驻可开合（Ctrl+B），窄屏整宽抽屉。
 *
 * 数据来自 `session.chapters`——**不需要新 IPC**。
 *
 * 虚拟滚动：3000 章全量渲染会让打开目录掉帧。
 * 这里只渲染"可视区 ± 20 行"，上下用等高占位撑出滚动条。
 * 行高固定 38px（CSS 与 ROW 必须同步改），因此不需要测量每一行。
 */
const ROW = 38;
const OVERSCAN = 20;

export function TocPanel({
  chapters,
  current,
  overlay = false,
  onSelect,
  onClose,
}: {
  chapters: ChapterMetaDto[];
  /** 当前章序号（0 起）。 */
  current: number;
  /** 浮层抽屉：窄屏用，不再挤压正文列宽（见 Reader 里的说明）。 */
  overlay?: boolean;
  onSelect: (index: number) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);

  // 可视高度：ResizeObserver 订阅外部布局（窗口变化 / dock 出现都不用手算）
  useEffect(() => {
    const el = listRef.current;
    if (el === null) return;
    const ro = new ResizeObserver((entries) => {
      setViewHeight(entries[0]?.contentRect.height ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 打开即定位到当前章（居中）。写 scrollTop 会触发 onScroll，状态自然同步。
  useEffect(() => {
    const el = listRef.current;
    if (el === null) return;
    el.scrollTop = Math.max(0, current * ROW - el.clientHeight / 2 + ROW / 2);
  }, [current]);

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const count = Math.ceil(viewHeight / ROW) + OVERSCAN * 2;
  const last = Math.min(chapters.length, first + count);
  const slice = chapters.slice(first, last);

  return (
    <aside
      className={overlay ? "ui-side ui-side--overlay" : "ui-side"}
      aria-label="目录"
    >
      <div className="ui-side-head">
        <div>
          <p className="ui-side-title">目录</p>
          <span className="ui-side-kicker">CONTENTS · {chapters.length} CH.</span>
        </div>
        <button
          type="button"
          aria-label="收起目录"
          onClick={onClose}
          className="reader-ico"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>

      <div
        ref={listRef}
        className="ui-side-list"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {/* 上方占位：让滚动条长度与全量数据一致 */}
        <div style={{ height: first * ROW }} aria-hidden />
        {slice.map((chapter, i) => {
          const index = first + i;
          const state =
            index === current ? "--on" : index < current ? "--done" : "";
          return (
            <button
              key={chapter.index}
              type="button"
              onClick={() => onSelect(index)}
              aria-current={index === current ? "true" : undefined}
              className={`ui-toc-item${state === "" ? "" : ` ui-toc-item${state}`}`}
              title={chapter.title}
            >
              <span className="ui-toc-n">
                {String(index + 1).padStart(2, "0")}
              </span>
              {chapter.title}
            </button>
          );
        })}
        {/* 下方占位 */}
        <div style={{ height: (chapters.length - last) * ROW }} aria-hidden />
      </div>
    </aside>
  );
}
