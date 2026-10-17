import { useEffect, useState } from "react";

import { Diagnostics } from "./pages/Diagnostics";
import { Reader } from "./pages/Reader";
import { Shelf } from "./pages/Shelf";
import { applyTheme, loadTheme } from "./lib/theme";

/**
 * 应用入口与视图切换（docs/02 §3）。
 *
 * 1.0 是四屏结构：书架 / 阅读 / 目录 / 设置。当前书架与阅读页是真实页面，
 * 诊断页是 M0 验证设施的保留。四屏之间的导航还没有路由库
 * ——也不打算引入（架构 §1 明确拒绝状态管理库；视图数量用 useState 足够）。
 */
type View =
  | { kind: "shelf"; preview: boolean }
  | { kind: "reader"; bookId: string }
  | { kind: "diagnostics" };

export default function App() {
  const [view, setView] = useState<View>({ kind: "shelf", preview: false });

  // 首帧之前把主题应用到 <html data-theme>，避免纸黄→白的闪变
  useEffect(() => {
    applyTheme(loadTheme());
  }, []);

  if (view.kind === "diagnostics") {
    return (
      <Diagnostics
        onBack={() => setView({ kind: "shelf", preview: false })}
        onPreviewShelf={() => setView({ kind: "shelf", preview: true })}
      />
    );
  }

  if (view.kind === "reader") {
    return (
      <Reader bookId={view.bookId} onBack={() => setView({ kind: "shelf", preview: false })} />
    );
  }

  return (
    <Shelf
      preview={view.preview}
      onExitPreview={() => setView({ kind: "shelf", preview: false })}
      onOpenDiagnostics={() => setView({ kind: "diagnostics" })}
      onOpenBook={(bookId) => setView({ kind: "reader", bookId })}
    />
  );
}
