import { useCallback, useRef } from "react";

import { bookSubtitle } from "../lib/format";
import type { BookSummary } from "../ipc/bindings";

import { BookCover } from "./BookCover";

/**
 * 书卡（docs/05 §4 BookCard）：网格 / 列表双形态。
 *
 * 交互规格：
 * - 点按 = 直接进阅读页（不经过详情页——少一层就是实用，M2 已接通）；
 * - 长按 500ms（触屏）或右键（桌面）= 选中，进入多选模式；
 * - 按压 scale(0.97) 120ms。
 */
export function BookCard({
  book,
  view,
  selected,
  selectionMode,
  now,
  onOpen,
  onSelect,
}: {
  book: BookSummary;
  view: "grid" | "list";
  selected: boolean;
  selectionMode: boolean;
  now: number;
  onOpen: (book: BookSummary) => void;
  onSelect: (book: BookSummary) => void;
}) {
  const longPressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      pressStart.current = { x: e.clientX, y: e.clientY };
      clearTimer();
      longPressTimer.current = window.setTimeout(() => {
        longPressTimer.current = null;
        onSelect(book);
      }, 500);
    },
    [book, clearTimer, onSelect],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // 移动超过 8px 视为滚动而非长按，取消计时
      const start = pressStart.current;
      if (start === null) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > 64) clearTimer();
    },
    [clearTimer],
  );

  const subtitle = bookSubtitle(book, now);
  const chapterNote = `${book.chapterCount} 章${
    book.hasRealChapters ? "" : " · 未分章"
  }`;

  const ringStyle = selected
    ? { boxShadow: "0 0 0 2px var(--ui-primary-500)" }
    : undefined;

  if (view === "list") {
    return (
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onPointerMove={handlePointerMove}
        onPointerCancel={clearTimer}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect(book);
        }}
        onClick={() => (selectionMode ? onSelect(book) : onOpen(book))}
        className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-transform active:scale-[0.98]"
        style={{
          ...ringStyle,
          background: "var(--ui-surface-2)",
          transitionDuration: "var(--ui-dur-fast)",
        }}
      >
        <BookCover title={book.title} small />
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[15px] font-medium"
            style={{ color: "var(--ui-text-1)" }}
            title={book.title}
          >
            {book.title}
          </p>
          <p
            className="mt-0.5 truncate text-[11px]"
            style={{ color: "var(--ui-text-2)" }}
          >
            {subtitle} · {chapterNote}
          </p>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={clearTimer}
      onPointerLeave={clearTimer}
      onPointerMove={handlePointerMove}
      onPointerCancel={clearTimer}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect(book);
      }}
      onClick={() => (selectionMode ? onSelect(book) : onOpen(book))}
      className="flex flex-col text-left transition-transform active:scale-[0.97]"
      style={{
        ...ringStyle,
        borderRadius: "var(--ui-radius-md)",
        transitionDuration: "var(--ui-dur-fast)",
      }}
    >
      <BookCover title={book.title} />
      <p
        className="mt-2 truncate text-[13px] font-medium"
        style={{ color: "var(--ui-text-1)" }}
        title={book.title}
      >
        {book.title}
      </p>
      <p className="tnum mt-0.5 truncate text-[11px]" style={{ color: "var(--ui-text-2)" }}>
        {subtitle}
      </p>
    </button>
  );
}
