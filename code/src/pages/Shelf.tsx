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
import { describeError } from "../lib/error";
import { sampleBooks } from "../lib/mock";

/**
 * 书架页（docs/05 §3.1，M1 交付物）。
 *
 * 已实现：列表/网格自适应切换（双态记忆）、生成式封面、导入按钮、
 * 长按/右键多选 → 删除（含确认）/重命名、导入事件消费（进度横幅 +
 * 完成刷新 + 重复提示）、空/载/错三态。
 *
 * 边界说明：M1 核心工作（redb 仓储 + 导入管线）落地前，
 * `list_books` 返回空、导入命令返回"开发中"错误——
 * 空状态与错误路径因此现在就是真实路径，不是模拟。
 * 点按书卡进阅读页的动作在 M2 接上（`open_book`）。
 */

type ViewMode = "grid" | "list";

const VIEW_KEY = "plainread.shelfView";

function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

/* ── 书墙布局参数（§3.1：手机 3 列，平板/桌面 4–6 列） ────────── */

/** 单列最小宽度：保证 3:4 封面在窄屏也不局促 */
const SHELF_MIN_COL = 104;
/** 列间距，与 Tailwind 的 gap-x-3.5（14px）对应 */
const SHELF_GAP = 14;
/** 列数上限：超宽屏下封面过大就不再增列，剩余宽度交给限容器 */
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
function useColumnCount(el: HTMLDivElement | null): number {
  const [cols, setCols] = useState(3);
  useEffect(() => {
    if (el === null) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      const count = Math.floor((width + SHELF_GAP) / (SHELF_MIN_COL + SHELF_GAP));
      setCols(Math.min(SHELF_MAX_COLS, Math.max(1, count)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return cols;
}

export function Shelf({
  preview,
  onExitPreview,
  onOpenDiagnostics,
  onOpenBook,
}: {
  /** 视觉预览模式：使用示例数据，不走 IPC（入口在诊断页）。 */
  preview: boolean;
  onExitPreview: () => void;
  onOpenDiagnostics: () => void;
  /** 单击书卡进入阅读页（M2）。 */
  onOpenBook: (bookId: string) => void;
}) {
  const [books, setBooks] = useState<BookSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(loadView);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renameTarget, setRenameTarget] = useState<BookSummary | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  /** 导入进度横幅的数据源；导入事件只有管线落地后才会真正到达。 */
  const [importing, setImporting] = useState<{
    file: string;
    index: number;
    total: number;
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
  const cols = useColumnCount(shelfEl);

  // 搜索：纯客户端过滤（列表已在内存，无需后端参与）
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterBooks(data ?? [], query), [data, query]);
  const searchMissed = data !== null && data.length > 0 && filtered.length === 0;

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

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: "var(--ui-surface)" }}
    >
      {/* 顶部栏：56px，标题左对齐，导入为主按钮（§3.1） */}
      <header
        className="flex shrink-0 items-center justify-between px-4"
        style={{
          paddingTop: "calc(var(--safe-top) + 10px)",
          paddingBottom: 10,
        }}
      >
        {selectionMode ? (
          <>
            <p className="text-[15px] font-medium" style={{ color: "var(--ui-text-1)" }}>
              已选 {selected.size} 本
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="重命名"
                title="重命名（仅支持单选）"
                disabled={selected.size !== 1}
                onClick={() => setRenameTarget(selectedBooks[0] ?? null)}
                className="ui-btn-icon disabled:opacity-40"
              >
                <PenLine size={20} strokeWidth={2} />
              </button>
              <button
                type="button"
                aria-label="删除"
                disabled={selected.size === 0}
                onClick={() => setConfirmDelete(true)}
                className="ui-btn-icon disabled:opacity-40"
                style={{ color: "var(--ui-danger)" }}
              >
                <Trash2 size={20} strokeWidth={2} />
              </button>
              <button
                type="button"
                aria-label="退出多选"
                onClick={exitSelection}
                className="ui-btn-icon"
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <h1
                style={{
                  fontSize: "var(--ui-text-xl)",
                  fontWeight: 600,
                  color: "var(--ui-text-1)",
                }}
              >
                书架
              </h1>
              {preview && (
                <span className="rd-chip" style={{ background: "var(--ui-accent-100)", color: "var(--ui-accent-500)" }}>
                  示例数据 · 视觉预览
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {preview && (
                <button
                  type="button"
                  onClick={onExitPreview}
                  aria-label="退出预览"
                  className="ui-btn-icon"
                >
                  <X size={20} strokeWidth={2} />
                </button>
              )}
              <div
                className="flex items-center"
                style={{
                  borderRadius: "var(--ui-radius-md)",
                  border: "0.5px solid var(--ui-border)",
                  background: "var(--ui-surface-2)",
                  padding: 2,
                }}
                role="group"
                aria-label="视图切换"
              >
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
                    className="flex h-9 w-9 items-center justify-center rounded-lg"
                    style={{
                      background:
                        view === mode ? "var(--ui-primary-500)" : "transparent",
                      color: view === mode ? "#ffffff" : "var(--ui-text-2)",
                    }}
                  >
                    <Icon size={16} strokeWidth={2} />
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onOpenDiagnostics}
                aria-label="诊断与自检"
                title="诊断与自检"
                className="ui-btn-icon"
              >
                <Settings size={20} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={handleImport}
                className="ui-btn-primary h-11 px-4"
                style={{ fontSize: "var(--ui-text-base)" }}
              >
                <BookPlus size={20} strokeWidth={2} />
                导入
              </button>
            </div>
          </>
        )}
      </header>

      {/* 导入进度横幅：消费 import://progress 事件 */}
      {importing !== null && (
        <div className="px-4">
          <div
            className="mb-2 rounded-xl px-3 py-2"
            style={{
              background: "var(--ui-primary-100)",
              color: "var(--ui-primary-600)",
            }}
          >
            <p className="text-[13px]">
              正在导入「{importing.file}」（{importing.index + 1}/
              {importing.total}）…
            </p>
            <div
              className="mt-1.5 h-1 overflow-hidden rounded-full"
              style={{ background: "rgb(255 255 255 / 0.6)" }}
            >
              <div
                className="rd-pulse h-full rounded-full"
                style={{
                  width: "100%",
                  background: "var(--ui-primary-500)",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 搜索栏：客户端过滤，列表在内存里，敲下即见 */}
      <div className="px-4 pb-1">
        <div
          className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2"
          style={{
            borderRadius: "var(--ui-radius-md)",
            border: "0.5px solid var(--ui-border)",
            background: "var(--ui-surface-2)",
          }}
        >
          <Search size={16} strokeWidth={2} style={{ color: "var(--ui-text-2)", flex: "none" }} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索书名或作者"
            aria-label="搜索书架"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            style={{ color: "var(--ui-text-1)" }}
          />
          {query !== "" && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setQuery("")}
              className="ui-btn-icon"
              style={{ width: 28, height: 28 }}
            >
              <X size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
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
          /* 书墙式（§3.1，2026-10-11 owner 确认）：每行书立于一根连续搁板上，
             整体居中限宽——微信读书的空间结构，纵向滚动 */
          <div ref={setShelfEl} className="mx-auto max-w-3xl">
            {rows.map((row, rowIndex) => (
              <div key={rowIndex} className={rowIndex === rows.length - 1 ? undefined : "mb-6"}>
                <div
                  className="grid gap-x-3.5"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                >
                  {row.map((book) => (
                    <BookCard
                      key={book.id}
                      book={book}
                      view="grid"
                      now={now}
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
          <div className="mx-auto flex max-w-xl flex-col gap-1">
            {filtered.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                view="list"
                now={now}
                selectionMode={selectionMode}
                selected={selected.has(book.id)}
                onOpen={handleOpen}
                onSelect={selectionMode ? toggleSelected : enterSelection}
              />
            ))}
          </div>
        )}
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
 * 首载骨架（§4 Skeleton：300ms 后才出现，避免闪烁）。
 * 形态与真实书墙一致：占位封面 + 搁板——加载时"书架就已经在了"。
 */
function SkeletonShelf() {
  const [skeletonEl, setSkeletonEl] = useState<HTMLDivElement | null>(null);
  const cols = useColumnCount(skeletonEl);
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
      className="mx-auto max-w-3xl"
      aria-label="正在加载书架"
      role="status"
    >
      {rows.map((count, rowIndex) => (
        <div key={rowIndex} className={rowIndex === rows.length - 1 ? undefined : "mb-6"}>
          <div
            className="grid gap-x-3.5"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: count }, (_, i) => (
              <div key={i}>
                <div
                  className="rd-pulse"
                  style={{
                    aspectRatio: "3 / 4",
                    borderRadius: "var(--ui-radius-book)",
                    background: "var(--ui-border)",
                  }}
                />
                <div
                  className="rd-pulse mt-2 h-3 w-3/4 rounded"
                  style={{ background: "var(--ui-border)" }}
                />
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
