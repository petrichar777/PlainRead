import { AlertCircle, CheckCircle2, Info } from "lucide-react";

/**
 * Toast（docs/05 §4 / docs/06 §4.7）：底部上浮，3s 自动消失，同时最多 1 个。
 * 展示逻辑在调用方（Shelf），这里只负责渲染。
 *
 * v2 形态：墨底奶白字 + 3px 圆角 + 左侧 2px 朱砂竖条；
 * `error` 态整块换成朱砂底（失败是唯一需要"打断一下"的语气），
 * 竖条随之反白——同色竖条在朱砂底上会消失。
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

  const isError = toast.kind === "error";
  const Icon = ICONS[toast.kind];
  const bg = isError ? "var(--ui-accent-500)" : "var(--ui-ink)";
  const fg = isError ? "var(--ui-on-accent)" : "var(--ui-on-ink)";
  const bar = isError ? "var(--ui-on-accent)" : "var(--ui-accent-500)";
  const iconColor = isError
    ? fg
    : toast.kind === "success"
      ? "var(--ui-ok)"
      : fg;

  return (
    <div
      key={toast.seq}
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center"
      style={{ bottom: "calc(var(--safe-bottom) + 24px)" }}
    >
      <div
        className="flex max-w-[min(90vw,420px)] items-start gap-2.5 px-4 py-2.5"
        style={{
          background: bg,
          color: fg,
          borderRadius: "var(--ui-radius-md)",
          boxShadow: "var(--ui-e-pop)",
        }}
      >
        {/* 左侧 2px 朱砂竖条：把"一条通知"和"一个弹窗"区分开 */}
        <span
          aria-hidden
          style={{
            flex: "none",
            width: 2,
            height: 14,
            marginTop: 2,
            background: bar,
          }}
        />
        <Icon
          size={16}
          strokeWidth={2}
          style={{ color: iconColor, flexShrink: 0, marginTop: 1 }}
        />
        <p className="text-[13px] leading-relaxed" style={{ color: fg }}>
          {toast.text}
        </p>
      </div>
    </div>
  );
}
