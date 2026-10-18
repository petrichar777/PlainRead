import { useState } from "react";
import { Check } from "lucide-react";

import type { Theme } from "../ipc/bindings";
import { applyTheme, loadTheme } from "../lib/theme";

/**
 * 主题三圆色票（docs/05 §3.4 / §4 ThemeDots）。
 *
 * 直选：三个圆点横排，当前项 2px 墨色描边 + 勾——比下拉列表快一倍。
 * 尺寸两档：设置面板 22px（外框 36），阅读页 dock 18px（外框 28）。
 * 静默态描边用 `--ui-dot-ring`（浅色黑 .22 / 夜间白 .22），勾保留。
 * 选中即生效（`applyTheme`：设 `<html data-theme>` + localStorage 记忆），
 * 书架/阅读的 chrome 通过 CSS 变量联动，无需任何组件感知主题值。
 *
 * 勾的颜色用 `--ui-text-1`：夜间主题下它是暖白（配 #191919 圆点），
 * 浅色主题下它是墨色（配纸黄/白圆点），天然对比正确，不需要分支判断。
 */

const THEMES: Array<{ id: Theme; label: string; dot: string }> = [
  { id: "paper", label: "纸黄", dot: "var(--ui-theme-dot-paper)" },
  { id: "white", label: "纯白", dot: "var(--ui-theme-dot-white)" },
  { id: "night", label: "夜间", dot: "var(--ui-theme-dot-night)" },
];

export function ThemeDots({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  // 阅读页 dock 里要的是 18px 小色票（§4.6）；设置面板 22px（§4.7）
  const dot = compact ? 18 : 22;
  const box = compact ? 28 : 36;

  return (
    <div className="flex items-center gap-2" role="radiogroup" aria-label="阅读主题">
      {THEMES.map((item) => {
        const active = theme === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={item.label}
            title={item.label}
            onClick={() => {
              setTheme(item.id);
              applyTheme(item.id);
            }}
            className="flex items-center justify-center rounded-full"
            style={{
              width: box,
              height: box,
              boxShadow: active
                ? "0 0 0 2px var(--ui-ink)"
                : "0 0 0 1px var(--ui-dot-ring)",
            }}
          >
            <span
              className="flex items-center justify-center rounded-full"
              style={{ width: dot, height: dot, background: item.dot }}
            >
              {active && (
                <Check
                  size={compact ? 10 : 12}
                  strokeWidth={3}
                  style={{ color: "var(--ui-text-1)" }}
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
