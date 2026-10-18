import { useCallback, useRef } from "react";
import { Check } from "lucide-react";

import { bookCode } from "../lib/cover";
import type { BookSummary } from "../ipc/bindings";

import { BookCover } from "./BookCover";

/**
 * 书卡（docs/06 §4.3）：网格 / 列表双形态。
 *
 * 交互规格：
 * - 点按 = 直接进阅读页（不经过详情页——少一层就是实用）；
 * - 长按 500ms（触屏）或右键（桌面）= 选中，进入多选模式；
 * - 网格悬停 translateY(-4px) 180ms + 落影加深（见 .ui-book-card）。
 *
 * D3：网格态**不再有封面外的书名/副标题**——书名印在封面上。
 * 因此 <button> 必须带 aria-label，否则读屏只剩"按钮"。
 */
export function BookCard({
  book,
  view,
  selected,
  selectionMode,
  onOpen,
  onSelect,
}: {
  book: BookSummary;
  view: "grid" | "list";
  selected: boolean;
  selectionMode: boolean;
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

  const code = bookCode(book.id);
  const percent = book.progressPercent;
  const pct = Math.min(100, Math.max(0, percent ?? 0));

  const pressHandlers = {
    onPointerDown: handlePointerDown,
    onPointerUp: clearTimer,
    onPointerLeave: clearTimer,
    onPointerMove: handlePointerMove,
    onPointerCancel: clearTimer,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      onSelect(book);
    },
    onClick: () => (selectionMode ? onSelect(book) : onOpen(book)),
  };

  if (view === "list") {
    return (
      <button
        type="button"
        {...pressHandlers}
        aria-label={book.title}
        aria-pressed={selectionMode ? selected : undefined}
        className="ui-list-row"
        style={
          selected
            ? { boxShadow: "inset 2px 0 0 var(--ui-accent-500)" }
            : undefined
        }
      >
        <BookCover title={book.title} small />
        <div className="min-w-0 flex-1">
          <p className="ui-list-title" title={book.title}>
            {book.title}
          </p>
          <p className="ui-list-meta">
            {code} · {book.chapterCount} CH.
          </p>
        </div>
        <div className="ui-list-prog">
          <span className="ui-list-bar">
            <i style={{ width: `${pct}%` }} />
          </span>
          <span className="ui-list-pct">
            {percent === null ? "—" : `${pct}%`}
          </span>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      {...pressHandlers}
      aria-label={book.title}
      aria-pressed={selectionMode ? selected : undefined}
      className="ui-book-card"
    >
      <BookCover
        title={book.title}
        code={code}
        progress={percent}
      />
      {selectionMode && (
        <>
          {selected && <span className="ui-book-dim" aria-hidden />}
          <span
            className={selected ? "ui-book-check ui-book-check--on" : "ui-book-check"}
            aria-hidden
          >
            {selected && <Check size={12} strokeWidth={3} />}
          </span>
        </>
      )}
    </button>
  );
}
