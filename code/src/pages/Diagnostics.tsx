import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, LayoutGrid } from "lucide-react";

import { describeError } from "../lib/error";
import { commands, type AppInfo, type EchoReply } from "../ipc/bindings";

import { ThemeDots } from "../components/ThemeDots";

/**
 * 诊断与自检页 —— M0 链路验证页的延续（docs/03 M0 验收的人工部分）。
 *
 * 它回答的问题不变：**Rust ↔ WebView 这条链路是不是真的通了**。
 * 书架页上线后它从首页退到设置图标后面，长期保留：
 * 排查"是环境问题还是代码问题"时，这是第一手信息。
 * 附加一个书架视觉预览入口，让书卡形态在导入管线落地前就能被肉眼验收。
 */

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; info: AppInfo }
  | { kind: "failed"; message: string };

/** 自检样本：全角空格、破折号、句号，覆盖典型的中文排版字符。 */
const SAMPLE_TEXT = "第一章　惊蛰——窗外下着雨。";

export function Diagnostics({
  onBack,
  onPreviewShelf,
}: {
  onBack: () => void;
  onPreviewShelf: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [draft, setDraft] = useState(SAMPLE_TEXT);
  const [echo, setEcho] = useState<EchoReply | null>(null);
  const [echoError, setEchoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await commands.appInfo();
        if (cancelled) return;
        if (res.status === "ok") setPhase({ kind: "ready", info: res.data });
        else setPhase({ kind: "failed", message: res.error.message });
      } catch (err) {
        if (!cancelled) setPhase({ kind: "failed", message: describeError(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runEcho = useCallback(async () => {
    setBusy(true);
    setEchoError(null);
    try {
      const res = await commands.echo(draft);
      if (res.status === "ok") {
        setEcho(res.data);
      } else {
        setEcho(null);
        setEchoError(res.error.message);
      }
    } catch (err) {
      setEcho(null);
      setEchoError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [draft]);

  return (
    <div
      className="ui-shelf"
      style={{ background: "var(--ui-surface)", overflowY: "auto" }}
    >
      {/* 与书架共用 .ui-page：桌面骨架下左右边缘对齐同一条 936 栏宽（P5 清理） */}
      <div className="ui-page flex flex-col gap-5 pb-8">
        <header className="flex items-center gap-2 pt-6">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回书架"
            className="ui-icon-btn"
          >
            <ChevronLeft size={20} strokeWidth={2} />
          </button>
          <div className="min-w-0">
            <p className="ui-page-kicker">DIAGNOSTICS / SELF-CHECK</p>
            <h1 className="ui-page-title">诊断与自检</h1>
          </div>
          <span className="flex-1" />
          <StatusPill phase={phase} />
        </header>

        {phase.kind === "ready" && <Probe info={phase.info} />}
        {phase.kind === "failed" && <FailureCard message={phase.message} />}

        <section className="rd-card p-4">
          <SectionTitle
            title="外观 · 阅读主题"
            note="三圆直选，即时生效并记忆；书架/目录的明暗跟随当前主题（§2.3 不做割裂感）"
          />
          <div className="mt-3">
            <ThemeDots />
          </div>
        </section>

        <EchoCard
          draft={draft}
          onDraftChange={setDraft}
          onRun={() => void runEcho()}
          busy={busy}
          result={echo}
          error={echoError}
        />

        <section className="rd-card p-4">
          <SectionTitle
            title="书架视觉预览"
            note="用设计草图里的六本示例书验收书卡的网格/列表/多选形态（不经过 IPC）"
          />
          <button
            type="button"
            onClick={onPreviewShelf}
            className="ui-btn-primary mt-3 h-11 px-4"
            style={{ fontSize: "var(--ui-text-base)" }}
          >
            <LayoutGrid size={20} strokeWidth={2} />
            进入书架预览
          </button>
        </section>

        <p
          className="text-[13px] leading-relaxed"
          style={{ color: "var(--ui-text-2)" }}
        >
          M0 骨架验证 · 后端 Rust（reader-core + Tauri），前端 React +
          TypeScript + Tailwind。书架与导入从 M1 开始，阅读页从 M2 开始。
        </p>
      </div>
    </div>
  );
}

/* ── 状态胶囊 ─────────────────────────────────────────────────── */

function StatusPill({ phase }: { phase: Phase }) {
  const tones = {
    loading: {
      text: "正在自检…",
      bg: "var(--ui-ok-soft)",
      fg: "var(--ui-ok)",
    },
    ready: {
      text: "IPC 链路正常",
      bg: "var(--ui-ok-soft)",
      fg: "var(--ui-ok)",
    },
    failed: {
      text: "链路异常",
      bg: "var(--ui-danger-soft)",
      fg: "var(--ui-danger)",
    },
  } as const;

  const tone = tones[phase.kind];

  return (
    <span className="rd-chip" style={{ background: tone.bg, color: tone.fg }}>
      <span
        className={phase.kind === "loading" ? "rd-pulse" : undefined}
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: 999,
          background: tone.fg,
        }}
      />
      {tone.text}
    </span>
  );
}

/* ── 内核自检 ─────────────────────────────────────────────────── */

function Probe({ info }: { info: AppInfo }) {
  const { probe } = info;

  return (
    <>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="运行平台" value={info.platform} />
        <StatCard label="内核版本" value={probe.coreVersion} />
        <StatCard label="可用主题" value={`${probe.availableThemes.length} 套`} />
      </section>

      <section className="rd-card p-4">
        <SectionTitle
          title="内核自检"
          note="以下数值全部来自 reader-core —— 能显示出来就说明跨 crate 通路是通的"
        />
        <dl className="mt-3 flex flex-col">
          <Row label="示例书籍" value={probe.sampleBook.title} />
          <Row label="原始编码" value={probe.sampleBook.sourceEncoding} />
          <Row
            label="章节数"
            value={`${probe.sampleBook.chapterCount} 章${
              probe.sampleBook.hasRealChapters ? "" : "（按字数均分）"
            }`}
          />
          <Row label="默认字号" value={`${probe.defaultFontSize} px`} />
          <Row label="默认行高" value={`${probe.defaultLineHeight}`} />
          <Row label="主题枚举" value={probe.availableThemes.join(" · ")} last />
        </dl>
      </section>
    </>
  );
}

function FailureCard({ message }: { message: string }) {
  return (
    <section
      className="rd-card p-4"
      style={{ background: "var(--ui-danger-soft)", borderColor: "transparent" }}
    >
      <p className="text-[15px] font-medium" style={{ color: "var(--ui-danger)" }}>
        自检失败
      </p>
      <p className="mt-1 text-[13px]" style={{ color: "var(--ui-danger)" }}>
        {message}
      </p>
      <p className="mt-2 text-[13px]" style={{ color: "var(--ui-text-2)" }}>
        常见原因：Rust 侧尚未重新编译，或 `src/ipc/bindings.ts` 未生成。
        在工程根执行 <code>cargo test -p plainread</code> 可重新生成绑定。
      </p>
    </section>
  );
}

/* ── IPC 往返测试 ─────────────────────────────────────────────── */

function EchoCard({
  draft,
  onDraftChange,
  onRun,
  busy,
  result,
  error,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onRun: () => void;
  busy: boolean;
  result: EchoReply | null;
  error: string | null;
}) {
  const chars = [...draft].length;
  const bytes = new TextEncoder().encode(draft).length;
  const matched =
    result !== null && result.charCount === chars && result.byteLength === bytes;

  return (
    <section className="rd-card p-4">
      <SectionTitle
        title="IPC 往返测试"
        note="中文字符数与字节数不相等 —— 两个数都对，才算 UTF-8 在边界上没坏"
      />

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) onRun();
          }}
          spellCheck={false}
          placeholder="输入一段中文试试"
          className="h-11 min-w-0 flex-1 rounded-[var(--ui-radius-md)] px-3 text-[15px] outline-none"
          style={{
            background: "var(--ui-surface)",
            border: "1px solid var(--ui-border-strong)",
            color: "var(--ui-text-1)",
          }}
        />
        <button
          type="button"
          onClick={onRun}
          disabled={busy}
          className="ui-btn-primary h-11 px-4 text-[15px]"
        >
          {busy ? "发送中…" : "发送到 Rust"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <StatCard label="前端统计 · 字符" value={String(chars)} />
        <StatCard label="前端统计 · 字节" value={String(bytes)} />
      </div>

      {error !== null && (
        <p className="mt-3 text-[13px]" style={{ color: "var(--ui-danger)" }}>
          Rust 侧返回错误：{error}
        </p>
      )}

      {result !== null && (
        <div
          className="mt-3 p-3"
          style={{
            background: "var(--ui-ok-soft)",
            borderRadius: "var(--ui-radius-md)",
          }}
        >
          <p
            className="text-[13px] font-medium"
            style={{ color: "var(--ui-ok)" }}
          >
            Rust 侧回传
          </p>
          <p className="mt-1 text-[15px]" style={{ color: "var(--ui-text-1)" }}>
            {result.text}
          </p>
          <p
            className="tnum mt-1 text-[13px]"
            style={{ color: "var(--ui-ok)" }}
          >
            字符 {result.charCount} · 字节 {result.byteLength}
            {matched ? " · 与前端一致 ✓" : " · 与前端不一致 ✗"}
          </p>
        </div>
      )}
    </section>
  );
}

/* ── 通用小部件 ───────────────────────────────────────────────── */

function SectionTitle({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h2
        className="text-[15px] font-medium"
        style={{ color: "var(--ui-text-1)" }}
      >
        {title}
      </h2>
      <p className="mt-0.5 text-[13px]" style={{ color: "var(--ui-text-2)" }}>
        {note}
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="px-3 py-3"
      style={{
        background: "var(--ui-surface-2)",
        borderRadius: "var(--ui-radius-lg)",
      }}
    >
      <p className="text-[13px]" style={{ color: "var(--ui-text-2)" }}>
        {label}
      </p>
      <p
        className="tnum mt-1 truncate text-[15px] font-medium"
        style={{ color: "var(--ui-text-1)" }}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-4 py-2"
      style={last ? undefined : { borderBottom: "1px solid var(--ui-border)" }}
    >
      <dt className="shrink-0 text-[13px]" style={{ color: "var(--ui-text-2)" }}>
        {label}
      </dt>
      <dd
        className="truncate text-[13px]"
        style={{ color: "var(--ui-text-1)" }}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
