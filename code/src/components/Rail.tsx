import { BookOpen, SlidersHorizontal } from "lucide-react";

import { coverPair } from "../lib/cover";
import { approxChapter } from "../lib/format";
import type { BookSummary } from "../ipc/bindings";

/**
 * 桌面侧栏（docs/06 §4.5）。
 *
 * 只承接"导航 + 最近在读 + 馆藏统计"三件事——书架主体仍在主区。
 * 统计口径（§7 数据缺口）：
 *   册数 = books.length；在读 = 0 < progress < 99；
 *   已读完 = progress ≥ 99；未读 = progress == null。
 *   设计稿里的「2.4 GB 占用」拿不到（BookSummary 无体积字段），降级为「未读 N 册」；
 *   「LAST SYNC」是设计稿疏漏（纯离线应用），改为「INDEX UPDATED + 本地刷新时刻」。
 */
export function Rail({
  books,
  current,
  updatedAt,
  onShelf,
  onSettings,
  onDiagnostics,
  onOpenBook,
}: {
  books: BookSummary[];
  current: "shelf" | "diagnostics";
  /** 最近一次 list_books 完成的时刻（毫秒）；null = 还没拉到。 */
  updatedAt: number | null;
  onShelf: () => void;
  onSettings: () => void;
  onDiagnostics: () => void;
  onOpenBook: (bookId: string) => void;
}) {
  const total = books.length;
  const reading = books.filter((b) => {
    const pct = b.progressPercent ?? 0;
    return pct > 0 && pct < 99;
  }).length;
  const finished = books.filter((b) => (b.progressPercent ?? 0) >= 99).length;
  const unread = books.filter((b) => (b.progressPercent ?? null) === null).length;

  // 最近在读：list_books 已按 last_read_at 倒序，这里只筛"读过"的前 3 条
  const recent = books.filter((b) => b.lastReadAt !== null).slice(0, 3);

  return (
    <aside className="ui-rail" aria-label="主导航">
      <div className="ui-rail-brand">
        <div className="ui-rail-logo" aria-hidden>
          WJ
        </div>
        <div className="ui-rail-name">
          简阅
          <span className="en">PLAINREAD</span>
        </div>
      </div>

      <nav className="ui-rail-nav">
        <button
          type="button"
          onClick={onShelf}
          aria-current={current === "shelf" ? "page" : undefined}
          className={
            current === "shelf"
              ? "ui-rail-item ui-rail-item--on"
              : "ui-rail-item"
          }
        >
          <BookOpen size={15} strokeWidth={2} />
          书架
          <span className="ct">{total}</span>
        </button>
        <button
          type="button"
          onClick={onSettings}
          aria-current={current === "diagnostics" ? "page" : undefined}
          className={
            current === "diagnostics"
              ? "ui-rail-item ui-rail-item--on"
              : "ui-rail-item"
          }
        >
          <SlidersHorizontal size={15} strokeWidth={2} />
          设置
        </button>
      </nav>

      {recent.length > 0 && (
        <div className="ui-rail-sub">
          <p className="ui-rail-subhead">RECENT</p>
          <div className="ui-recent">
            {recent.map((book) => {
              const pair = coverPair(book.title);
              const pct = Math.min(100, Math.max(0, book.progressPercent ?? 0));
              return (
                <button
                  key={book.id}
                  type="button"
                  onClick={() => onOpenBook(book.id)}
                  className="ui-recent-item"
                  title={book.title}
                >
                  <span
                    className="ui-recent-thumb"
                    aria-hidden
                    style={
                      {
                        "--book-a": pair.a,
                        "--book-b": pair.b,
                      } as React.CSSProperties
                    }
                  >
                    <i style={{ width: `${pct}%` }} />
                  </span>
                  <span className="ui-recent-t">
                    <b>{book.title}</b>
                    <em>
                      {pct}% · CH.{approxChapter(book) ?? "—"}
                    </em>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="ui-rail-sub">
        <p className="ui-rail-subhead">INDEX</p>
        <div className="ui-stat-grid">
          <div className="ui-stat-cell">
            <b>{total}</b>
            <span>册藏书</span>
          </div>
          <div className="ui-stat-cell">
            <b>{reading}</b>
            <span>在读</span>
          </div>
          <div className="ui-stat-cell">
            <b>{finished}</b>
            <span>已读完</span>
          </div>
          <div className="ui-stat-cell">
            <b>{unread}</b>
            <span>未读</span>
          </div>
        </div>
      </div>

      <div className="ui-rail-foot">
        <span>PLAINREAD v{__APP_VERSION__} · OFFLINE</span>
        <div className="ui-rail-foot-row">
          <span>
            INDEX UPDATED {updatedAt === null ? "——" : formatClock(updatedAt)}
          </span>
          <button type="button" onClick={onDiagnostics} className="ui-rail-link">
            诊断
          </button>
        </div>
      </div>
    </aside>
  );
}

/** 只取时分：侧栏宽度有限，日期放不下也没意义（本地刷新时刻）。 */
function formatClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
