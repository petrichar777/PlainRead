import { BookPlus } from "lucide-react";

/**
 * 空状态（docs/05 §4 EmptyState）：一本"虚线封面" + 一句主文案 + 一个主按钮。
 * 禁止堆说明文字——支持"打开方式"导入这件事一行带过。
 */
export function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div
        aria-hidden
        className="flex items-center justify-center"
        style={{
          aspectRatio: "3 / 4",
          width: 120,
          borderRadius: "var(--ui-radius-book)",
          border: "2px dashed var(--ui-border)",
          color: "var(--ui-text-2)",
        }}
      >
        <BookPlus size={28} strokeWidth={2} />
      </div>
      <p
        className="mt-6 text-[15px] font-medium"
        style={{ color: "var(--ui-text-1)" }}
      >
        书架还是空的
      </p>
      <button
        type="button"
        onClick={onImport}
        className="ui-btn-primary mt-4 h-11 px-5"
        style={{ fontSize: "var(--ui-text-base)" }}
      >
        <BookPlus size={20} strokeWidth={2} />
        导入你的第一本书
      </button>
      <p className="mt-3 text-[13px]" style={{ color: "var(--ui-text-2)" }}>
        支持 .txt 文件；也可以在系统里用「打开方式 → 简阅」导入
      </p>
    </div>
  );
}
