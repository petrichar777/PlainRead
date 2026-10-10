import { useCallback, useEffect, useState } from "react";

import { commands, type AppInfo, type EchoReply } from "./ipc/bindings";

/**
 * M0 的链路验证页面。
 *
 * 它要回答一个问题：**Rust ↔ WebView 这条链路是不是真的通了**。
 *
 * 验证分三层：
 * 1. `appInfo` 无参调用 —— 验证「前端能调到 Rust」；
 * 2. 返回值里带内核的领域类型 —— 验证「内核 → 外壳 → 前端」整条数据通路；
 * 3. `echo` 带参调用并比对字符数 / 字节数 —— 验证中文在 IPC 边界上没被破坏。
 *
 * M1 会被真正的书架页取代。届时这里可复用的部分（`StatCard` / `Row` / `SectionTitle`）
 * 应当抽到 `src/components/` 下。
 */

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; info: AppInfo }
  | { kind: "failed"; message: string };

/** 自检样本：全角空格、破折号、句号，覆盖典型的中文排版字符。 */
const SAMPLE_TEXT = "第一章　惊蛰——窗外下着雨。";

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return JSON.stringify(err);
}

export default function App() {
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
        if (res.status === "ok") {
          setPhase({ kind: "ready", info: res.data });
        } else {
          setPhase({ kind: "failed", message: res.error.message });
        }
      } catch (err) {
        if (!cancelled) setPhase({ kind: "failed", message: describe(err) });
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
      setEchoError(describe(err));
    } finally {
      setBusy(false);
    }
  }, [draft]);

  return (
    <div className="rd-shell" style={{ background: "var(--rd-surface)" }}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <Header phase={phase} />
        {phase.kind === "ready" && <Probe info={phase.info} />}
        {phase.kind === "failed" && <FailureCard message={phase.message} />}
        <EchoCard
          draft={draft}
          onDraftChange={setDraft}
          onRun={runEcho}
          busy={busy}
          result={echo}
          error={echoError}
        />
        <Footer />
      </div>
    </div>
  );
}

/* ── 页头 ─────────────────────────────────────────────────────── */

function Header({ phase }: { phase: Phase }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-medium tracking-tight">简阅 · PlainRead</h1>
        {phase.kind === "ready" && (
          <span className="tnum text-sm" style={{ color: "var(--rd-fg-subtle)" }}>
            v{phase.info.version}
          </span>
        )}
      </div>
      <StatusPill phase={phase} />
    </header>
  );
}

function StatusPill({ phase }: { phase: Phase }) {
  const tones = {
    loading: {
      text: "正在自检…",
      bg: "var(--rd-accent-soft)",
      fg: "var(--rd-accent)",
    },
    ready: { text: "IPC 链路正常", bg: "var(--rd-ok-soft)", fg: "var(--rd-ok)" },
    failed: {
      text: "链路异常",
      bg: "var(--rd-danger-soft)",
      fg: "var(--rd-danger)",
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

/* ── 自检结果 ─────────────────────────────────────────────────── */

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
      style={{ background: "var(--rd-danger-soft)", borderColor: "transparent" }}
    >
      <p className="text-sm font-medium" style={{ color: "var(--rd-danger)" }}>
        自检失败
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--rd-danger)" }}>
        {message}
      </p>
      <p className="mt-2 text-xs" style={{ color: "var(--rd-fg-muted)" }}>
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
          className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            background: "var(--rd-surface)",
            border: "0.5px solid var(--rd-border-strong)",
            color: "var(--rd-fg)",
          }}
        />
        <button
          onClick={onRun}
          disabled={busy}
          className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{
            background: "var(--rd-accent)",
            color: "#ffffff",
            opacity: busy ? 0.6 : 1,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "发送中…" : "发送到 Rust"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <StatCard label="前端统计 · 字符" value={String(chars)} />
        <StatCard label="前端统计 · 字节" value={String(bytes)} />
      </div>

      {error !== null && (
        <p className="mt-3 text-sm" style={{ color: "var(--rd-danger)" }}>
          Rust 侧返回错误：{error}
        </p>
      )}

      {result !== null && (
        <div
          className="mt-3 rounded-lg p-3"
          style={{ background: "var(--rd-ok-soft)" }}
        >
          <p className="text-xs font-medium" style={{ color: "var(--rd-ok)" }}>
            Rust 侧回传
          </p>
          <p className="mt-1 text-sm">{result.text}</p>
          <p className="tnum mt-1 text-xs" style={{ color: "var(--rd-ok)" }}>
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
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-0.5 text-xs" style={{ color: "var(--rd-fg-muted)" }}>
        {note}
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-3 py-3" style={{ background: "var(--rd-surface)" }}>
      <p className="text-xs" style={{ color: "var(--rd-fg-muted)" }}>
        {label}
      </p>
      <p className="tnum mt-1 truncate text-base font-medium" title={value}>
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
      style={last ? undefined : { borderBottom: "0.5px solid var(--rd-border)" }}
    >
      <dt className="shrink-0 text-xs" style={{ color: "var(--rd-fg-muted)" }}>
        {label}
      </dt>
      <dd className="truncate text-sm" title={value}>
        {value}
      </dd>
    </div>
  );
}

function Footer() {
  return (
    <p className="text-xs leading-relaxed" style={{ color: "var(--rd-fg-subtle)" }}>
      M0 骨架验证页 · 后端 Rust（reader-core + Tauri），前端 React + TypeScript +
      Tailwind。本轮只验证链路，书架与阅读界面从 M1 开始。
    </p>
  );
}
