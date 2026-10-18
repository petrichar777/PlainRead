import { useCallback, useEffect, useState, type ReactNode } from "react";

import { AppShell } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Rail } from "./components/Rail";
import { Diagnostics } from "./pages/Diagnostics";
import { Reader } from "./pages/Reader";
import { Shelf } from "./pages/Shelf";
import { commands, type BookSummary } from "./ipc/bindings";
import { DESKTOP_QUERY, useMediaQuery } from "./lib/media-query";
import { applyTheme, loadTheme } from "./lib/theme";

/**
 * 应用入口与视图切换（docs/02 §3 / docs/06 §4.5）。
 *
 * 1.0 是四屏结构：书架 / 阅读 / 目录 / 设置。当前书架与阅读页是真实页面，
 * 诊断页是 M0 验证设施的保留。四屏之间的导航还没有路由库
 * ——也不打算引入（架构 §1 明确拒绝状态管理库；视图数量用 useState 足够）。
 *
 * P2 起多了一层骨架：≥1024px 渲染左侧栏（AppShell + Rail），
 * 阅读页不套 Shell（沉浸态，连侧栏也不显示）。
 */
type View =
  | { kind: "shelf"; preview: boolean }
  | { kind: "reader"; bookId: string }
  | { kind: "diagnostics" };

export default function App() {
  // 设计验收便利：浏览器里带 `?preview=1` 直接进示例数据书架（不经 IPC）。
  // 只在 dev 生效——生产构建里 import.meta.env.DEV 为 false，这段会被摇掉。
  const [view, setView] = useState<View>(() => ({
    kind: "shelf",
    preview:
      import.meta.env.DEV && new URLSearchParams(location.search).has("preview"),
  }));
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  // 侧栏用的书架快照：Shelf 是唯一的数据主人，这里只接收它推送的结果。
  // 诊断页没有 Shelf 挂载，Rail 自己补拉一次（见下方 effect）。
  const [railBooks, setRailBooks] = useState<BookSummary[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // 首帧之前把主题应用到 <html data-theme>，避免纸黄→白的闪变
  useEffect(() => {
    applyTheme(loadTheme());
  }, []);

  const handleBooksChange = useCallback((books: BookSummary[]) => {
    setRailBooks(books);
    setUpdatedAt(Date.now());
  }, []);

  const enterDiagnostics = useCallback(() => {
    setView({ kind: "diagnostics" });
  }, []);
  const enterShelf = useCallback(() => {
    setView({ kind: "shelf", preview: false });
  }, []);
  const openBook = useCallback((bookId: string) => {
    setView({ kind: "reader", bookId });
  }, []);

  // 诊断页无 Shelf，侧栏统计会停在旧值——进页时补拉一次
  useEffect(() => {
    if (view.kind !== "diagnostics") return;
    let cancelled = false;
    void commands.listBooks().then((res) => {
      if (cancelled || res.status !== "ok") return;
      handleBooksChange(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [view.kind, handleBooksChange]);

  let body: ReactNode;
  if (view.kind === "reader") {
    // 阅读页不套骨架：沉浸优先，返回按钮在页内
    body = <Reader bookId={view.bookId} onBack={enterShelf} />;
  } else {
    const page =
      view.kind === "diagnostics" ? (
        <Diagnostics
          onBack={enterShelf}
          onPreviewShelf={() => setView({ kind: "shelf", preview: true })}
        />
      ) : (
        <Shelf
          preview={view.preview}
          onExitPreview={enterShelf}
          onOpenDiagnostics={enterDiagnostics}
          onOpenBook={openBook}
          onBooksChange={handleBooksChange}
        />
      );

    body = (
      <AppShell
        showRail={isDesktop}
        rail={
          <Rail
            books={railBooks}
            updatedAt={updatedAt}
            current={view.kind === "diagnostics" ? "diagnostics" : "shelf"}
            onShelf={enterShelf}
            onSettings={enterDiagnostics}
            onDiagnostics={enterDiagnostics}
            onOpenBook={openBook}
          />
        }
      >
        {page}
      </AppShell>
    );
  }

  // 错误边界包住全部视图：任何页面崩溃都显示恢复屏，而不是整页白屏
  return <ErrorBoundary>{body}</ErrorBoundary>;
}
