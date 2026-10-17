import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * 应用级错误边界（架构兜底）。
 *
 * React 19 的默认行为是「组件抛错 → 整棵树卸载 → 白屏」——用户看到的就是
 * 一片空白，连发生了什么都不知道。这里在视图层兜住：崩溃显示可读的
 * 恢复屏（错误信息 + 重载），而不是空白。
 *
 * 放在 App 的视图切换外层：任何页面（书架/阅读/诊断）内未捕获的渲染期
 * 或 effect 错误都落到这里。重载 = 整页刷新，同时清掉内存态（章节缓存、
 * HMR 残留的旧模块图），是崩溃后最可靠的恢复动作。
 */

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 组件栈只进控制台（开发排查用），用户界面只看 message
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--ui-surface)] px-6 text-[var(--ui-text-1)]">
          <p className="text-base font-medium">页面出错了</p>
          <p className="max-w-md text-center text-sm text-[var(--ui-text-2)]">
            {error.message || String(error)}
          </p>
          <button
            type="button"
            className="ui-btn-primary h-11 px-4"
            onClick={() => window.location.reload()}
          >
            重载应用
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
