import { AlertCircle, CheckCircle2, Info } from "lucide-react";

/**
 * Toast（docs/05 §4）：底部上浮，3s 自动消失，同时最多 1 个（后来的顶掉前一个）。
 * 展示逻辑在调用方（Shelf），这里只负责渲染。
 */
export type ToastKind = "info" | "success" | "error";

export type ToastState = { kind: ToastKind; text: string; seq: number };

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
};

export function Toast({ toast }: { toast: ToastState | null }) {
  if (toast === null) return null;

  const Icon = ICONS[toast.kind];
  const color =
    toast.kind === "error"
      ? "var(--ui-danger)"
      : toast.kind === "success"
        ? "var(--ui-primary-500)"
        : "var(--ui-text-1)";

  return (
    <div
      key={toast.seq}
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center"
      style={{ bottom: "calc(var(--safe-bottom) + 24px)" }}
    >
      <div
        className="flex max-w-[min(90vw,420px)] items-center gap-2 rounded-[12px] px-4 py-2.5"
        style={{
          background: "var(--ui-surface-2)",
          boxShadow: "var(--ui-e3)",
          border: "0.5px solid var(--ui-border)",
        }}
      >
        <Icon size={16} strokeWidth={2} style={{ color, flexShrink: 0 }} />
        <p className="text-[13px]" style={{ color: "var(--ui-text-1)" }}>
          {toast.text}
        </p>
      </div>
    </div>
  );
}
