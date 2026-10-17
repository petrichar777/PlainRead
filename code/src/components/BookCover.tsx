import { coverChar, coverGradient } from "../lib/cover";

/**
 * 生成式占位封面（docs/05 §3.1 / §4 BookCard）。
 *
 * 比例 3:4，圆角 8px（--ui-radius-book），书名首字 + 莫兰迪渐变；
 * 表层的斜向高光让"印着一个字"看起来像"一本书"而不是"一张色块"。
 */
export function BookCover({
  title,
  small,
}: {
  title: string;
  /** 列表视图里的缩小版。 */
  small?: boolean;
}) {
  return (
    <div
      className="relative flex shrink-0 select-none items-center justify-center overflow-hidden"
      style={{
        aspectRatio: "3 / 4",
        width: small ? 48 : undefined,
        borderRadius: "var(--ui-radius-book)",
        background: coverGradient(title),
        boxShadow: "var(--ui-e1)",
      }}
    >
      <span
        style={{
          fontFamily: 'Georgia, "Times New Roman", "宋体", serif',
          fontSize: small ? 20 : 34,
          color: "#ffffff",
        }}
      >
        {coverChar(title)}
      </span>
      {/* 斜向高光：书脊受光的暗示 */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(160deg, rgb(255 255 255 / 0.16), transparent 55%)",
        }}
      />
    </div>
  );
}
