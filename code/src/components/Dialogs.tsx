import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * 对话框（docs/05 §4 Dialog）：只用于删除书籍等**不可逆操作**，
 * 文案必须写明后果。重命名走 [`RenameDialog`]。
 *
 * v2 尺寸：面板圆角 6px、按钮 40px（`--ui-radius-xl` / `h-10`），
 * 遮罩用 `--ui-scrim`，确认按钮保持 `--ui-danger`。
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        role="presentation"
        className="absolute inset-0"
        style={{ background: "var(--ui-scrim)" }}
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-sm p-5"
        style={{
          background: "var(--ui-surface-2)",
          borderRadius: "var(--ui-radius-xl)",
          boxShadow: "var(--ui-e-pop)",
        }}
      >
        <p
          className="text-[15px] font-semibold"
          style={{ color: "var(--ui-text-1)" }}
        >
          {title}
        </p>
        <p
          className="mt-2 text-[13px] leading-relaxed"
          style={{ color: "var(--ui-text-2)" }}
        >
          {body}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-[var(--ui-radius-md)] px-4 text-[15px]"
            style={{ color: "var(--ui-text-1)" }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-10 rounded-[var(--ui-radius-md)] px-4 text-[15px] font-medium"
            style={{ background: "var(--ui-danger)", color: "var(--ui-on-accent)" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 重命名对话框：输入 + 确认；空名/未改名时确认按钮禁用。
 *
 * 不设 `open` 属性——由调用方决定"是否渲染"（而不是渲染后靠 effect 重置草稿），
 * 并用 `key` 绑定目标书籍：每次打开都是全新的输入状态，
 * 这是 React 官方推荐的"用 key 重置状态"模式，也绕开了 setState-in-effect。
 */
export function RenameDialog({
  initialTitle,
  onConfirm,
  onCancel,
}: {
  initialTitle: string;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 等挂载完成后再聚焦并全选，方便直接输入覆盖
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  const trimmed = draft.trim();
  const unchanged = trimmed === initialTitle.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        role="presentation"
        className="absolute inset-0"
        style={{ background: "var(--ui-scrim)" }}
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="重命名书籍"
        className="relative w-full max-w-sm p-5"
        style={{
          background: "var(--ui-surface-2)",
          borderRadius: "var(--ui-radius-xl)",
          boxShadow: "var(--ui-e-pop)",
        }}
      >
        <div className="flex items-center justify-between">
          <p
            className="text-[15px] font-semibold"
            style={{ color: "var(--ui-text-1)" }}
          >
            重命名
          </p>
          <button
            type="button"
            onClick={onCancel}
            aria-label="关闭"
            className="ui-btn-icon"
            style={{ width: 32, height: 32 }}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !unchanged && trimmed)
              onConfirm(trimmed);
          }}
          spellCheck={false}
          maxLength={100}
          className="mt-3 h-10 w-full rounded-[var(--ui-radius-md)] px-3 text-[15px] outline-none"
          style={{
            background: "var(--ui-surface)",
            border: "1px solid var(--ui-border)",
            color: "var(--ui-text-1)",
          }}
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-[var(--ui-radius-md)] px-4 text-[15px]"
            style={{ color: "var(--ui-text-1)" }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={unchanged || !trimmed}
            onClick={() => onConfirm(trimmed)}
            className="ui-btn-primary h-10 px-4 text-[15px]"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
