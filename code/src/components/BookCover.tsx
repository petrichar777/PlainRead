import { coverChar, coverPair } from "../lib/cover";

/**
 * 生成式书封（docs/06 §4.2-bis：2.5D 精修，**已覆盖 §4.2 的等轴测形态**）。
 *
 * 不做真 3D、不做斜切：正视图 + 竖直书脊 + 四缘光照 + 可平铺纸纹。
 * 几何：封面 120 + 书脊 14 = 总宽 134，与列数测量（cell = --bw + --sp）一致，
 * 因此书墙布局无需任何改动。
 *
 * 只渲染两个视觉节点：
 *   face  —— 封面（纸纹 / 柔光 / 书脊沟走背景层，顶部纸页叠层走 ::before）
 *   spine —— 书脊（三停渐变冒充弧面，1px 书脊沟由 border-left 承担）
 * 落影是 `.ui-book` 上的双层 box-shadow，不额外占节点。
 *
 * `small`（26px 列表缩略）只渲染 face：这个尺寸下书脊与纸纹都会糊成噪点。
 */
export function BookCover({
  title,
  code,
  progress,
  small,
}: {
  title: string;
  /** 档案编号（WJ-xxxxxx），印在封面顶缘。 */
  code?: string;
  /** 0–100；> 0 时底部出现朱砂进度线。 */
  progress?: number | null;
  /** 列表视图的扁平缩略图。 */
  small?: boolean;
}) {
  const pair = coverPair(title);
  const pct = Math.min(100, Math.max(0, progress ?? 0));

  return (
    <div
      className={small ? "ui-book ui-book--flat" : "ui-book"}
      style={
        {
          "--book-a": pair.a,
          "--book-b": pair.b,
        } as React.CSSProperties
      }
    >
      <div className="ui-book-face">
        {/* 小封面放不下竖排书名，退回"印一个字"的方案 */}
        {small && <span className="ui-book-char">{coverChar(title)}</span>}
      </div>

      {!small && (
        <>
          <div className="ui-book-spine" aria-hidden />
          {code !== undefined && <span className="ui-book-code">{code}</span>}
          <span className="ui-book-title" aria-hidden>
            {title}
          </span>
          <span className="ui-book-rule" aria-hidden />
        </>
      )}

      {/* 进度线按「封面宽」算而不是「总宽」：100% 时不会压在书脊上 */}
      {pct > 0 && (
        <span
          className="ui-book-prog"
          style={{ width: `calc(var(--bw, 120px) * ${pct / 100})` }}
        />
      )}
    </div>
  );
}
