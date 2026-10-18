import { useCallback, useSyncExternalStore } from "react";

/**
 * 断点判定（docs/06 §4.5）。
 *
 * 为什么不用纯 CSS 显隐：桌面骨架与移动骨架是两套 DOM，
 * 若同时渲染再靠 `display:none` 藏一套，页面上会存在**两个"导入"按钮**，
 * 读屏与 Tab 顺序都会撞车。所以断点必须在 JS 里判定，只挂载一套。
 *
 * 用 `useSyncExternalStore` 而不是 `useState + useEffect`：
 * 前者由 React 直接接管外部订阅，首帧就能拿到真值，
 * 也不需要"在 effect 里同步 setState"（会被 react-hooks 规则拦下）。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // 服务端/预渲染兜底：本项目是纯本地壳，取不到窗口就按移动端处理
    () => false,
  );
}

/** 桌面骨架断点（§4.5：≥1024px 渲染左栏）。 */
export const DESKTOP_QUERY = "(min-width: 1024px)";
