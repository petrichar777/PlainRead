import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookPlus,
  LayoutGrid,
  List,
  PenLine,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";

import { BookCard } from "../components/BookCard";
import { ConfirmDialog, RenameDialog } from "../components/Dialogs";
import { EmptyState } from "../components/EmptyState";
import { filterBooks } from "../lib/search";
import { Toast, type ToastState } from "../components/Toast";
import type { BookSummary } from "../ipc/bindings";
import { commands, events } from "../ipc/bindings";
import { coverChar, coverPair } from "../lib/cover";
import { describeError } from "../lib/error";
import { approxChapter } from "../lib/format";
import { DESKTOP_QUERY, useMediaQuery } from "../lib/media-query";
import { sampleBooks } from "../lib/mock";

/**
 * 书架页（docs/05 §3.1，M1 交付物；v2 见 docs/06 §4.4）。
 *
 * 已实现：列表/网格自适应切换（双态记忆）、生成式封面、导入按钮、
 * 长按/右键多选 → 删除（含确认）/重命名、导入事件消费（进度横幅 +
 * 完成刷新 + 重复提示）、空/载/错三态。
 *
 * P2 起书架吃桌面骨架：页头（kicker + 34px 标题 + 搜索/视图/导入）、
 * 继续阅读卡、书墙三者共用 `.ui-page`，左右边缘因此天然对齐。
 * 桌面无需页头齿轮（侧栏已有入口），窄屏才保留它。
 */

type ViewMode = "grid" | "list";

const VIEW_KEY = "plainread.shelfView";

/** 搜索快捷键提示要跟平台走：Windows 上写 ⌘K 是错的。 */
const SEARCH_HINT = /Mac|iPhone|iPad/.test(navigator.userAgent)
  ? "⌘K"
  : "Ctrl K";

function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

/* ── 书墙布局（§4.4 / §6 速查） ─────────────────────────────────
   书宽 --bw、书间距 --shelf-gap 都由 CSS 变量说了算（桌面 120/26，手机 84/16），
   JS 只负责"读出来算列数"。这样断点调整视觉参数不必改 TS。 */

/** 列数上限：超宽屏下封面过大就不再增列，剩余宽度交给限容器（936px） */
const SHELF_MAX_COLS = 6;

/**
 * 用 ResizeObserver 测量书架容器能放下几列。
 *
 * 参数是**元素本身**（而非 ref 对象）：书墙容器要等数据到达才挂载，
 * 若依赖 ref 对象，effect 只会在"容器还不存在"时跑一次、永远接不上 Observer。
 * 以元素为依赖，挂载/卸载都会重新观察。
 *
 * 不在 effect 里同步 setState 初始化——ResizeObserver 在开始观察时
 * **必然**先发一次初始回调，同步测量是多余的（还会撞 react-hooks 的
 * set-state-in-effect 规则）。
 */
function useShelfColumns(el: HTMLDivElement | null): number {
  const [cols, setCols] = useState(SHELF_MAX_COLS);
  useEffect(() => {
    if (el === null) return;
    const measure = (width: number) => {
      const css = getComputedStyle(el);
      const bw = Number.parseFloat(css.getPropertyValue("--bw")) || 120;
      const gap = Number.parseFloat(css.getPropertyValue("--shelf-gap")) || 26;
      // 每本书实际占位 = 封面宽 + 书脊厚（与 CSS 里 --sp 的 clamp 规则同源）
      const spine = Math.min(18, Math.max(10, bw * 0.117));
      const cell = bw + spine;
      setCols(
        Math.min(
          SHELF_MAX_COLS,
          Math.max(1, Math.floor((width + gap) / (cell + gap))),
        ),
      );
    };
    const observer = new ResizeObserver((entries) => {
      measure(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return cols;
}

/* ── 导入进度（B 态：2px 朱砂线 + 等宽进度） ─────────────────── */

const IMPORT_STAGES = [
  "decoding",
  "normalizing",
  "chapterizing",
  "storing",
] as const;

const IMPORT_STAGE_LABEL: Record<(typeof IMPORT_STAGES)[number], string> = {
  decoding: "DECODING",
  normalizing: "NORMALIZING",
  chapterizing: "CHAPTERIZING",
  storing: "STORING",
};

/** 单文件的阶段内进度 + 批内位置 = 整体百分比（没有字节数，用阶段推进代替）。 */
function importPct(p: { index: number; total: number; stage: string }): number {
  const step = IMPORT_STAGES.indexOf(p.stage as (typeof IMPORT_STAGES)[number]);
  const within = ((step < 0 ? 0 : step) + 1) / IMPORT_STAGES.length;
  const total = Math.max(1, p.total);
  return Math.min(100, ((p.index + within) / total) * 100);
}

export function Shelf({
  preview,
  onExitPreview,
  onOpenDiagnostics,
  onOpenBook,
  onBooksChange,
}: {
  /** 视觉预览模式：使用示例数据，不走 IPC（入口在诊断页）。 */
  preview: boolean;
  onExitPreview: () => void;
  onOpenDiagnostics: () => void;
  /** 单击书卡进入阅读页（M2）。 */
  onOpenBook: (bookId: string) => void;
  /** 书架数据变化时推给外层（侧栏的书目统计与最近在读靠它）。 */
  onBooksChange?: (books: BookSummary[]) => void;
}) {
  const [books, setBooks] = useState<BookSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(loadView);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renameTarget, setRenameTarget] = useState<BookSummary | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const searchRef = useRef<HTMLInputElement | null>(null);
  /** 导入进度横幅的数据源；导入事件只有管线落地后才会真正到达。 */
  const [importing, setImporting] = useState<{
    file: string;
    index: number;
    total: number;
    stage: string;
  } | null>(null);

  // 副标题里的"今天/昨天"以进入本页的时刻为准，避免渲染期间跳动；
  // 取"进入页面那一刻"用 useState 惰性初始化（渲染期不允许不纯调用）
  const [now] = useState(() => Date.now());
  // 预览数据不能在三元表达式里调 useMemo（违反 Hooks 规则），统一在这里算
  const previewBooks = useMemo(
    () => (preview ? sampleBooks(now) : null),
    [preview, now],
  );
  const data = preview ? previewBooks : books;

  // 书墙：按列数把书切成行，每行下面垫一根搁板。
  // callback ref（元素就绪即通知 state），保证容器挂载后 Observer 能接上
  const [shelfEl, setShelfEl] = useState<HTMLDivElement | null>(null);
  const cols = useShelfColumns(shelfEl);

  // 搜索：纯客户端过滤（列表已在内存，无需后端参与）
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterBooks(data ?? [], query), [data, query]);
  const searchMissed = data !== null && data.length > 0 && filtered.length === 0;

  // 书架数据变化 → 推给外层（侧栏）。预览模式也推，保证"预览即所见"。
  useEffect(() => {
    if (data !== null) onBooksChange?.(data);
  }, [data, onBooksChange]);

  // ⌘K / Ctrl+K 聚焦搜索（§7：只加快捷键，过滤逻辑不动）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = useMemo(() => {
    const list = filtered;
    const out: BookSummary[][] = [];
    for (let i = 0; i < list.length; i += cols) out.push(list.slice(i, i + cols));
    return out;
  }, [filtered, cols]);

  const toastSeq = useRef(0);
  const showToast = useCallback((kind: ToastState["kind"], text: string) => {
    toastSeq.current += 1;
    setToast({ kind, text, seq: toastSeq.current });
  }, []);

  // Toast 3s 自动消失（§4：同时最多 1 个，后来的顶掉前一个）
  useEffect(() => {
    if (toast === null) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const refresh = useCallback(async () => {
    try {
      const res = await commands.listBooks();
      if (res.status === "ok") {
        setBooks(res.data);
        setLoadError(null);
      } else {
        setLoadError(res.error.message);
      }
    } catch (err) {
      setLoadError(describeError(err));
    }
  }, []);

  useEffect(() => {
    if (preview) return;
    // 首载拉取书架：refresh 的 setState 都发生在 await 之后，
    // 并非 effect 内的同步 setState，这里对该规则做有依据的豁免。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [preview, refresh]);

  // 导入事件订阅：进度横幅 + 完成刷新 + 重复提示（§4.3 事件契约）
  useEffect(() => {
    if (preview) return;
    const unlisten: Array<() => void> = [];

    void (async () => {
      unlisten.push(
        await events.importProgress.listen((e) => {
          setImporting(e.payload);
        }),
      );
      unlisten.push(
        await events.importFinished.listen((e) => {
          setImporting(null);
          const { succeeded, failed } = e.payload;
          if (failed.length === 0) {
            showToast("success", `成功导入 ${succeeded.length} 本`);
          } else {
            showToast(
              "info",
              `导入完成：${succeeded.length} 本成功，${failed.length} 本失败（${failed[0]?.reason ?? ""}）`,
            );
          }
          void refresh();
        }),
      );
      unlisten.push(
        await events.importDuplicate.listen((e) => {
          showToast(
            "info",
            `《${e.payload.existing.title}》疑似重复：正在导入的「${e.payload.incoming}」内容一致`,
          );
        }),
      );
    })();

    return () => {
      for (const off of unlisten) off();
    };
  }, [preview, refresh, showToast]);

  const switchView = useCallback((next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // 存储不可用就不记忆，本次会话内仍然生效
    }
  }, []);

  const handleImport = useCallback(async () => {
    try {
      const res = await commands.pickAndImport();
      if (res.status === "ok") {
        void refresh();
      } else {
        showToast("info", res.error.message);
      }
    } catch (err) {
      showToast("error", describeError(err));
    }
  }, [refresh, showToast]);

  const enterSelection = useCallback((book: BookSummary) => {
    setSelectionMode(true);
    setSelected(new Set([book.id]));
  }, []);

  const toggleSelected = useCallback((book: BookSummary) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(book.id)) next.delete(book.id);
      else next.add(book.id);
      return next;
    });
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelected(new Set());
  }, []);

  const handleOpen = useCallback(
    (book: BookSummary) => {
      onOpenBook(book.id);
    },
    [onOpenBook],
  );

  const handleDelete = useCallback(async () => {
    const ids = [...selected];
    setConfirmDelete(false);
    exitSelection();
    try {
      const results = await Promise.allSettled(
        ids.map((id) => commands.deleteBook(id)),
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        showToast("error", `删除 ${ids.length - failed.length}/${ids.length} 本成功，其余失败`);
      } else {
        showToast("success", `已删除 ${ids.length} 本`);
      }
    } catch (err) {
      showToast("error", describeError(err));
    }
    void refresh();
  }, [exitSelection, refresh, selected, showToast]);

  const handleRename = useCallback(
    async (title: string) => {
      const target = renameTarget;
      if (target === null) return;
      setRenameTarget(null);
      exitSelection();
      try {
        const res = await commands.renameBook(target.id, title);
        if (res.status === "ok") {
          showToast("success", "已重命名");
        } else {
          showToast("error", res.error.message);
        }
      } catch (err) {
        showToast("error", describeError(err));
      }
      void refresh();
    },
    [exitSelection, refresh, renameTarget, showToast],
  );

  const selectedBooks = data?.filter((b) => selected.has(b.id)) ?? [];
  const total = data?.length ?? 0;
  // 继续阅读：取最近在读的第一本，且必须真的读过（§4.4）
  const hero =
    data !== null && data.length > 0 && data[0].progressPercent !== null
      ? data[0]
      : null;

  return (
    <div className="ui-shelf" style={{ background: "var(--ui-surface)" }}>
      {/* 页头（§4.4）：kicker + 34px 标题 + 右组（搜索 / 视图 / 导入）。
          多选态复用同一套尺寸，切换模式时书墙不会跳高度。 */}
      <header className="ui-page ui-page-head">
        {selectionMode ? (
          <>
            <div className="min-w-0">
              <p className="ui-page-kicker">
                SELECTION <s /> {selected.size} OF {total}
              </p>
              <h1 className="ui-page-title">已选 {selected.size} 本</h1>
            </div>
            <div className="ui-page-actions">
              <button
                type="button"
                aria-label="重命名"
                title="重命名（仅支持单选）"
                disabled={selected.size !== 1}
                onClick={() => setRenameTarget(selectedBooks[0] ?? null)}
                className="ui-icon-btn"
              >
                <PenLine size={18} strokeWidth={2} />
              </button>
              <button
                type="button"
                aria-label="删除"
                disabled={selected.size === 0}
                onClick={() => setConfirmDelete(true)}
                className="ui-icon-btn"
                style={{ color: "var(--ui-danger)" }}
              >
                <Trash2 size={18} strokeWidth={2} />
              </button>
              <button
                type="button"
                aria-label="退出多选"
                onClick={exitSelection}
                className="ui-icon-btn"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="min-w-0">
              <p className="ui-page-kicker">
                SHELF / {total} VOL. <s /> SORTED BY LAST READ
              </p>
              <div className="flex items-baseline gap-3">
                <h1 className="ui-page-title">书架</h1>
                {preview && (
                  <span
                    className="rd-chip"
                    style={{
                      border: "1px solid var(--ui-border-strong)",
                      color: "var(--ui-text-2)",
                    }}
                  >
                    示例数据 · 视觉预览
                  </span>
                )}
              </div>
            </div>

            <div className="ui-page-actions">
              {/* 搜索框：客户端过滤，列表在内存里，敲下即见 */}
              <div className="ui-search">
                <Search
                  size={14}
                  strokeWidth={2}
                  style={{ color: "var(--ui-text-3)", flex: "none" }}
                  aria-hidden
                />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Escape") return;
                    e.stopPropagation();
                    if (query !== "") setQuery("");
                    else e.currentTarget.blur();
                  }}
                  placeholder="搜索书名或作者"
                  aria-label="搜索书架"
                />
                {query === "" ? (
                  <kbd>{SEARCH_HINT}</kbd>
                ) : (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => setQuery("")}
                    className="ui-icon-btn"
                    style={{ width: 20, height: 20 }}
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                )}
                <span className="ui-reg ui-reg-tl" aria-hidden />
                <span className="ui-reg ui-reg-tr" aria-hidden />
                <span className="ui-reg ui-reg-bl" aria-hidden />
                <span className="ui-reg ui-reg-br" aria-hidden />
              </div>

              {preview && (
                <button
                  type="button"
                  onClick={onExitPreview}
                  aria-label="退出预览"
                  className="ui-icon-btn"
                >
                  <X size={18} strokeWidth={2} />
                </button>
              )}

              <div className="ui-seg" role="group" aria-label="视图切换">
                {(
                  [
                    ["grid", LayoutGrid, "网格视图"],
                    ["list", List, "列表视图"],
                  ] as const
                ).map(([mode, Icon, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-label={label}
                    aria-pressed={view === mode}
                    onClick={() => switchView(mode)}
                    className={
                      view === mode ? "ui-seg-item ui-seg-item--on" : "ui-seg-item"
                    }
                  >
                    <Icon size={15} strokeWidth={2} />
                  </button>
                ))}
              </div>

              {/* 桌面把诊断入口放在侧栏底部（§4.5），窄屏才保留这个齿轮位 */}
              {!isDesktop && (
                <button
                  type="button"
                  onClick={onOpenDiagnostics}
                  aria-label="设置与诊断"
                  title="设置与诊断"
                  className="ui-icon-btn"
                >
                  <Settings size={18} strokeWidth={2} />
                </button>
              )}

              <button
                type="button"
                onClick={handleImport}
                className="ui-btn-primary ui-btn-primary--compact"
              >
                <BookPlus size={15} strokeWidth={2} />
                导入
              </button>
            </div>
          </>
        )}
      </header>

      {/* 导入中（B 态）：2px 朱砂进度线 + 等宽阶段/批内进度。
          契约里没有字节数（§7 数据缺口），用"阶段推进 + 批内序号"表达进展。 */}
      {importing !== null && (
        <div className="ui-page pb-3">
          <p className="ui-mono text-[8.5px]" style={{ color: "var(--ui-text-3)" }}>
            IMPORTING · {importing.index + 1} / {importing.total}
          </p>
          <p
            className="mt-2 truncate text-[13.5px] font-semibold"
            style={{ color: "var(--ui-text-1)" }}
          >
            {importing.file}
          </p>
          <div className="mt-3 h-0.5" style={{ background: "var(--ui-border)" }}>
            <div
              className="rd-pulse h-full"
              style={{
                width: `${importPct(importing)}%`,
                background: "var(--ui-accent-500)",
              }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="ui-mono text-[8.5px]" style={{ color: "var(--ui-text-3)" }}>
              {IMPORT_STAGE_LABEL[
                importing.stage as (typeof IMPORT_STAGES)[number]
              ] ?? "IMPORTING"}
            </span>
            <span className="ui-mono text-[8.5px]" style={{ color: "var(--ui-text-3)" }}>
              {Math.round(importPct(importing))}%
            </span>
          </div>
        </div>
      )}

      {/* 继续阅读（§4.4）：只在"读过且没读完"的书上出现。
          章节号是库里的进度百分比反推的近似值——BookSummary 没有章索引（§7 数据缺口），
          这只影响这条文案，不参与任何位置计算。 */}
      {hero !== null && (
        <button
          type="button"
          className="ui-page ui-resume"
          onClick={() => handleOpen(hero)}
          aria-label={`继续阅读《${hero.title}》`}
        >
          <span
            className="ui-resume-cover"
            aria-hidden
            style={
              {
                "--book-a": coverPair(hero.title).a,
                "--book-b": coverPair(hero.title).b,
              } as React.CSSProperties
            }
          >
            <span className="ui-resume-cover-char">{coverChar(hero.title)}</span>
          </span>
          <span className="ui-resume-mid">
            <span className="ui-resume-k">
              <i aria-hidden />
              继续阅读
            </span>
            <span className="ui-resume-title">{hero.title}</span>
            <span className="ui-resume-meta">
              <span>
                CH.{approxChapter(hero)} / {hero.chapterCount}
              </span>
              <span className="ui-resume-bar" aria-hidden>
                <i
                  style={{
                    width: `${Math.min(100, Math.max(0, hero.progressPercent ?? 0))}%`,
                  }}
                />
              </span>
            </span>
          </span>
          <span className="ui-resume-right">
            <span>
              <span className="ui-resume-pct">
                {Math.min(100, Math.max(0, Math.round(hero.progressPercent ?? 0)))}
                <small>%</small>
              </span>
            </span>
            <span className="ui-btn-primary" style={{ height: 40, padding: "0 18px" }}>
              打开
            </span>
          </span>
        </button>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto pb-6">
        <div className="ui-page">
        {!preview && loadError !== null ? (
          <ErrorState message={loadError} onRetry={() => void refresh()} />
        ) : data === null ? (
          <SkeletonShelf />
        ) : data.length === 0 ? (
          <EmptyState onImport={handleImport} />
        ) : searchMissed ? (
          /* 搜索无命中：明确告诉用户"书在、词不对"，和空书架的引导区分开 */
          <p className="mt-16 text-center text-[14px]" style={{ color: "var(--ui-text-2)" }}>
            没有找到与「{query.trim()}」匹配的书
          </p>
        ) : view === "grid" ? (
          /* 书墙（§4.4）：每行书立于一根贯通搁板上，书名印在封面里，
             容器 936px 居中、书间 26px、行距 26px */
          <div ref={setShelfEl} className="ui-wall">
            {rows.map((row, rowIndex) => (
              <div key={rowIndex} className="ui-wall-row">
                <div className="ui-wall-books">
                  {row.map((book) => (
                    <BookCard
                      key={book.id}
                      book={book}
                      view="grid"
                      selectionMode={selectionMode}
                      selected={selected.has(book.id)}
                      onOpen={handleOpen}
                      onSelect={selectionMode ? toggleSelected : enterSelection}
                    />
                  ))}
                </div>
                {/* 搁板：贯通整行，末行不满也照常横到头——真实书架的样子 */}
                <div aria-hidden className="ui-plank" />
              </div>
            ))}
          </div>
        ) : (
          /* 列表（§4.3）：52px 行、等宽元数据主导，无卡片无阴影 */
          <div>
            {filtered.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                view="list"
                selectionMode={selectionMode}
                selected={selected.has(book.id)}
                onOpen={handleOpen}
                onSelect={selectionMode ? toggleSelected : enterSelection}
              />
            ))}
          </div>
        )}
        </div>
      </main>

      <ConfirmDialog
        open={confirmDelete}
        title={`删除 ${selected.size} 本书？`}
        body="将同时删除书籍文件与阅读进度，此操作不可恢复。"
        confirmLabel="删除"
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
      {renameTarget !== null && (
        <RenameDialog
          key={renameTarget.id}
          initialTitle={renameTarget.title}
          onConfirm={(title) => void handleRename(title)}
          onCancel={() => setRenameTarget(null)}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}

/* ── 三态里的另外两态：骨架与错误 ─────────────────────────────── */

/**
 * 首载骨架（§4.4）：立体书形状（face 单层即可）+ 空搁板。
 * 几何与真实书墙同构——加载时"书架就已经在了"。
 */
function SkeletonShelf() {
  const [skeletonEl, setSkeletonEl] = useState<HTMLDivElement | null>(null);
  const cols = useShelfColumns(skeletonEl);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), 300);
    return () => window.clearTimeout(id);
  }, []);
  if (!visible) return null;

  const total = 12;
  const rows: number[] = [];
  for (let i = 0; i < total; i += cols) rows.push(Math.min(cols, total - i));

  return (
    <div
      ref={setSkeletonEl}
      className="ui-wall"
      aria-label="正在加载书架"
      role="status"
    >
      {rows.map((count, rowIndex) => (
        <div key={rowIndex} className="ui-wall-row">
          <div className="ui-wall-books">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="ui-book-card">
                <div className="ui-book ui-skeleton-book rd-pulse" />
              </div>
            ))}
          </div>
          <div aria-hidden className="ui-plank rd-pulse" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center py-16">
      <p className="text-[15px] font-medium" style={{ color: "var(--ui-danger)" }}>
        书架加载失败
      </p>
      <p className="mt-2 text-[13px]" style={{ color: "var(--ui-text-2)" }}>
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="ui-btn-primary mt-5 h-11 px-5"
        style={{ fontSize: "var(--ui-text-base)" }}
      >
        重试
      </button>
    </div>
  );
}
