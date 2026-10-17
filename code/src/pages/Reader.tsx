import { useCallback, useEffect, useState } from "react";

import { commands } from "../ipc/bindings";
import type { BookSessionDto, ChapterDto } from "../ipc/bindings";

/**
 * 阅读页骨架（M2 第 1 步：数据链路 + 段落渲染）。
 *
 * 本步只做「打开书 → 读章 → 翻章 → 记进度」的纵向链路；
 * CSS 多列分页、进度锚点算法、上下章预取是后续步骤，
 * 届时在 <article> 与翻页控制层上迭代，不动数据链路。
 *
 * 进度暂存「章 + 章内偏移 0」：锚点算法落地前，字符偏移恒为 0——
 * 语义仍是"读到了某章开头"，比没有进度强，且不会写错位置的进度。
 */
export function Reader({ bookId, onBack }: { bookId: string; onBack: () => void }) {
  const [session, setSession] = useState<BookSessionDto | null>(null);
  const [chapter, setChapter] = useState<ChapterDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 当前章序号；null = 还没从会话里确定起点。 */
  const [index, setIndex] = useState<number | null>(null);

  // 进书：先于首次 await 不得碰 setState（react-hooks/set-state-in-effect），
  // 所以重置逻辑全部放在 await 之后的分支里
  const loadSession = useCallback(async () => {
    try {
      const res = await commands.openBook(bookId);
      if (res.status !== "ok") throw res.error;
      setSession(res.data);
      setIndex(res.data.progress?.chapterIndex ?? 0);
      setError(null);
    } catch (e) {
      setSession(null);
      setIndex(null);
      setChapter(null);
      setError(String(e));
    }
  }, [bookId]);

  useEffect(() => {
    // 进书拉取：loadSession 的 setState 都发生在 await 之后，
    // 并非 effect 内的同步 setState，这里对该规则做有依据的豁免（同 Shelf 首载）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSession();
  }, [loadSession]);

  // 读章：随 index 拉取。不在 effect 体内同步清章——
  // 用「chapter.index !== index」推导加载态，顺带免费获得旧章残留的兜底
  useEffect(() => {
    if (index === null) return;
    let cancelled = false;
    void commands.loadChapter(bookId, index).then((res) => {
      if (cancelled) return;
      if (res.status === "ok") {
        setChapter(res.data);
        setError(null);
      } else {
        setError(res.error.message);
      }
    });
    // 切章即存进度（章粒度；防抖与章内偏移随锚点算法一并补齐）。
    // 进度保存失败不打断阅读——下次切章会再存。
    void commands.saveProgress(bookId, index, 0).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bookId, index]);

  if (error) {
    return (
      <div className="reader-page">
        <p className="reader-status">打开失败：{error}</p>
        <div className="reader-status-actions">
          <button type="button" className="reader-btn" onClick={() => void loadSession()}>
            重试
          </button>
          <button type="button" className="reader-btn" onClick={onBack}>
            回书架
          </button>
        </div>
      </div>
    );
  }

  if (!session || index === null) {
    return (
      <div className="reader-page">
        <p className="reader-status">正在打开…</p>
      </div>
    );
  }

  const total = session.chapters.length;
  const chapterReady = chapter !== null && chapter.index === index;
  const paragraphs = chapterReady
    ? (chapter?.text ?? "").split("\n").filter((line) => line.trim() !== "")
    : [];

  return (
    <div className="reader-page">
      <header className="reader-header">
        <button type="button" className="reader-btn" onClick={onBack}>
          书架
        </button>
        <div className="reader-header-meta">
          <span className="reader-book-title">{session.book.title}</span>
          <span className="reader-position">
            {index + 1} / {total}
          </span>
        </div>
      </header>

      <main className="reader-scroll">
        {!chapterReady ? (
          <p className="reader-status">正在加载章节…</p>
        ) : (
          <article className="reader-content" data-chapter={chapter?.index}>
            <h2 className="reader-chapter-title">{chapter?.title}</h2>
            {paragraphs.map((text, i) => (
              <p key={i}>{text}</p>
            ))}
          </article>
        )}
      </main>

      <footer className="reader-nav">
        <button
          type="button"
          className="reader-btn"
          disabled={index <= 0}
          onClick={() => setIndex((i) => (i !== null ? Math.max(0, i - 1) : i))}
        >
          上一章
        </button>
        <span className="reader-chapter-name">{chapter?.title ?? "…"}</span>
        <button
          type="button"
          className="reader-btn"
          disabled={index >= total - 1}
          onClick={() => setIndex((i) => (i !== null ? Math.min(total - 1, i + 1) : i))}
        >
          下一章
        </button>
      </footer>
    </div>
  );
}
