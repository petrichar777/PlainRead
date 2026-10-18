import { BookPlus } from "lucide-react";

/**
 * 空状态（docs/05 §4 EmptyState）：虚线**方框** + 四角套准线 + 衬线标题 + 一个动作。
 * 禁止堆说明文字——支持"打开方式"导入这件事一句话带过。
 *
 * 套准线（registration mark）是 v2 的签名元素：它把"空"画成一张待填的档案纸，
 * 而不是一个"什么都没有"的白板。
 */
export function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="ui-blank">
      {/* 四角套准线：常显（空态没有 focus 可等，隐着就没意义了） */}
      <span className="ui-reg" aria-hidden style={{ top: 6, left: 6 }} />
      <span className="ui-reg" aria-hidden style={{ top: 6, right: 6 }} />
      <span className="ui-reg" aria-hidden style={{ bottom: 6, left: 6 }} />
      <span className="ui-reg" aria-hidden style={{ bottom: 6, right: 6 }} />

      <div className="ui-blank-cover" aria-hidden>
        <BookPlus size={18} strokeWidth={1.6} />
      </div>

      <p className="ui-blank-title">书架尚空</p>
      <p className="ui-blank-desc">导入一个 TXT 文件开始，或用「打开方式」送来。</p>

      <button
        type="button"
        onClick={onImport}
        className="ui-btn-primary mt-4"
        style={{ height: 40, padding: "0 18px", fontSize: "var(--ui-text-base)" }}
      >
        <BookPlus size={18} strokeWidth={2} />
        导入第一本书
      </button>
    </div>
  );
}
