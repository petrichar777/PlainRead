import { Trash2 } from "lucide-react";

import type { BookmarkDto } from "../ipc/bindings";

/**
 * 书签侧栏（M3-1）：与目录共用同一套外壳（`.ui-side*`），
 * 桌面 320px 常驻位、窄屏浮层抽屉。
 *
 * 一条书签 = 摘录（2 行截断）+ 位置 + 删除按钮。
 * **跳转与删除是两个并列的点击区**：整行点击跳转，右侧 × 删除——
 * 不能把删除按钮嵌进行按钮里（button 不能套 button）。
 */
export function BookmarkPanel({
  bookmarks,
  currentChapter,
  overlay = false,
  onSelect,
  onRemove,
  onClose,
}: {
  bookmarks: BookmarkDto[];
  /** 当前章，用于给"就在这一章"的书签加一点点强调 */
  currentChapter: number | null;
  overlay?: boolean;
  onSelect: (bookmark: BookmarkDto) => void;
  onRemove: (bookmark: BookmarkDto) => void;
  onClose: () => void;
}) {
  return (
    <aside
      className={overlay ? "ui-side ui-side--overlay" : "ui-side"}
      aria-label="书签"
    >
      <div className="ui-side-head">
        <div>
          <p className="ui-side-title">书签</p>
          <span className="ui-side-kicker">
            BOOKMARKS{bookmarks.length > 0 ? ` · ${bookmarks.length}` : ""}
          </span>
        </div>
        <button
          type="button"
          aria-label="收起书签"
          onClick={onClose}
          className="reader-ico"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <div className="ui-side-list">
        {bookmarks.length === 0 ? (
          <p className="ui-bm-empty">
            还没有书签。
            <br />
            阅读时按顶栏的书签钮，就会记住当前这一页。
          </p>
        ) : (
          bookmarks.map((bm) => (
            <div key={bm.id} className="ui-bm-row">
              <button
                type="button"
                className={
                  bm.chapterIndex === currentChapter
                    ? "ui-bm-main ui-bm-main--here"
                    : "ui-bm-main"
                }
                onClick={() => onSelect(bm)}
                title={bm.excerpt}
              >
                <span className="ui-bm-excerpt">{bm.excerpt || "（无摘录）"}</span>
                <span className="ui-bm-meta">
                  CH.{bm.chapterIndex + 1}
                  <i aria-hidden>·</i>
                  {formatDay(bm.createdAt)}
                </span>
              </button>
              <button
                type="button"
                className="ui-bm-del"
                aria-label="删除书签"
                onClick={() => onRemove(bm)}
              >
                <Trash2 size={14} strokeWidth={2} />
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

/** 只到"月-日"：书签看的是"什么时候标的"，不需要精确到分钟。 */
function formatDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}
