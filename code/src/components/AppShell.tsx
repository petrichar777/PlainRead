import type { ReactNode } from "react";

/**
 * 桌面/移动骨架切换（docs/06 §4.5）。
 *
 *   AppShell
 *   ├─ Rail            ← ≥1024px 才渲染（判定在 JS，不靠 CSS 显隐）
 *   └─ {Shelf | Diagnostics}
 *
 * 阅读页**不套 Shell**（沉浸态，Rail 不显示），由 App 直接渲染 Reader。
 * 令牌与动效两端同源，骨架差异只体现在这里——不是两套设计。
 */
export function AppShell({
  showRail,
  rail,
  children,
}: {
  showRail: boolean;
  rail: ReactNode;
  children: ReactNode;
}) {
  if (!showRail) {
    // 移动端：单列占满，Shelf 自己吃满高度
    return <div className="h-full">{children}</div>;
  }
  return (
    <div className="ui-app">
      {rail}
      <div className="ui-app-main">{children}</div>
    </div>
  );
}
