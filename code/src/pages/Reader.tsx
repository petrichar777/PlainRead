import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, List, SlidersHorizontal } from "lucide-react";

import { buildFragments, offsetToPage, pageToOffset, type AnchorFragment } from "../lib/anchor";
import { clampPage, pageOffset, pageStride, totalPages, PAGE_GAP } from "../lib/pagination";
import {
  getCachedChapter,
  prefetchChapters,
  putCachedChapter,
} from "../lib/chapter-cache";
import { describeError } from "../lib/error";
import {
  loadReadingPrefs,
  prefsToCssVars,
  saveReadingPrefs,
  PREFS_LIMITS,
  type ReadingPrefs,
} from "../lib/reading-prefs";
import { commands } from "../ipc/bindings";
import type { BookSessionDto, ChapterDto } from "../ipc/bindings";
import { useMediaQuery } from "../lib/media-query";
import { ThemeDots } from "../components/ThemeDots";
import { TocPanel } from "../components/TocPanel";

/**
 * 阅读页（M2 第 2 步：CSS 多列分页，docs/02 §7.1；v2 版式见 docs/06 §4.6）。
 *
 * 分页模型：viewport（overflow:hidden）内一条 track 用
 * `column-width = 视口宽` + `column-fill: auto` 把内容排成一页页的列，
 * 翻页 = track 的 translateX 位移 + transition 动画。
 * 排版质量交给浏览器，我们只负责"列宽对齐视口"和"位移 = 页码 × 步长"。
 *
 * 进度锚点（§5.1）：存"章 + 章内字符偏移"，恢复时按锚点精确跳页——
 * 页码随字号/屏宽漂移，字符偏移不随排版参数变化，所以锚点永不存页码。
 *
 * v2（P3）改动只在外壳：顶栏与 dock 变浮层（不占布局高度，翻页页数不跳）、
 * 正文列宽锁 620、页码挪到右下、新增目录右栏与 .ui-prefs 设置面板。
 * **分页与锚点算法一行未动**。
 */
export function Reader({ bookId, onBack }: { bookId: string; onBack: () => void }) {
  const [session, setSession] = useState<BookSessionDto | null>(null);
  const [chapter, setChapter] = useState<ChapterDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 当前章序号；null = 还没从会话里确定起点。 */
  const [index, setIndex] = useState<number | null>(null);

  // ── 阅读排版偏好（字号/行距/段距/页边距/字体）：CSS 变量驱动，localStorage 记忆 ──
  const [prefs, setPrefs] = useState<ReadingPrefs>(loadReadingPrefs);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  /** 顶栏 + dock 的显隐（鼠标进入顶部 80px 淡入，离开 1.2s 淡出）。 */
  const [chromeVisible, setChromeVisible] = useState(true);
  /**
   * 目录在窄屏改为浮层抽屉（与手机一致）。
   *
   * 不只是响应式取舍：窗口放不下 620 + 320 时，右栏会把正文列挤窄，
   * 而 Chromium 对"在已有分栏内容上改 column-width"的重排不彻底
   * （列宽按旧值、位移按新值，表现为半列重叠）。做成浮层后正文列宽不变，
   * 这条路径就不存在了。
   */
  const tocOverlay = useMediaQuery("(max-width: 1023px)");
  const hideTimer = useRef<number | null>(null);
  /** 拖动进度条时的临时值；null = 显示真实进度。松手才真正跳章。 */
  const [dragPct, setDragPct] = useState<number | null>(null);
  /** 重排节拍：拖滑块时 CSS 变量即时生效（视觉无延迟），量页/建锚点 200ms 合并一次。 */
  const [reflowTick, setReflowTick] = useState(0);
  const reflowTimer = useRef<number | null>(null);
  // 最新 index/page 的 ref：滑块重排、切后台立即保存都从 ref 取当前位，免闭包过期
  const pageRef = useRef<{ index: number | null; page: number }>({ index: null, page: 0 });

  // ── 分页状态 ──
  // callback ref（元素挂载即通知 state）：viewport 在"正在打开…"阶段不存在，
  // 普通 ref + [] 依赖的 effect 会挂空且永不重试——同 Shelf 的 shelfEl 模式
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  /** 视口内容宽度（px）；0 = 还没量到。ResizeObserver 驱动，旋转/缩放自动重排。 */
  const [pageWidth, setPageWidth] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(0);
  /**
   * 跨章进入方向：goNext/goPrev 跨章时登记，track 重挂载的那次渲染据此
   * 播放"从邻页滑入"的关键帧动画；章内翻页走 transition，互不干扰。
   */
  const [enter, setEnter] = useState<"next" | "prev" | null>(null);
  /**
   * 最近一次成功读到的章号（track 的 key）：
   * 切章加载期间保持旧值——旧章内容继续显示，新章到达才重挂载。
   * 这同时消灭了"切章瞬间闪空白"，又让进入动画只在新章内容就位时播放。
   */
  const [readyKey, setReadyKey] = useState<number | null>(null);
  /** 已建切面表的布局指纹：pendingOffset 消费引发的重跑不必重建切面表。 */
  const builtKeyRef = useRef("");
  /** 当章切面表（锚点算法的坐标）：state 而非 ref——量页 effect 写入、保存路径读取。 */
  const [fragments, setFragments] = useState<AnchorFragment[]>([]);
  /**
   * 待恢复的锚点偏移（state 而非 ref：设置方全在事件/异步回调里，
   * 消费方在量页 effect 里置 null；Infinity = 落末页）。
   */
  const [pendingOffset, setPendingOffset] = useState<number | null>(null);

  const changePrefs = useCallback(
    (patch: Partial<ReadingPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        saveReadingPrefs(next);
        return next;
      });
      // 先抓旧布局下的当前位置，重排后按锚点归位——字号变化不丢句子（M2 验收标准）
      setPendingOffset(
        pageToOffset(fragments, pageRef.current.page) ??
          fragments[fragments.length - 1]?.offset ??
          0,
      );
      if (reflowTimer.current !== null) window.clearTimeout(reflowTimer.current);
      reflowTimer.current = window.setTimeout(() => setReflowTick((t) => t + 1), 200);
    },
    [fragments],
  );

  // ── chrome（顶栏 / dock）显隐 ──
  const clearHide = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(
    (delay = 1200) => {
      clearHide();
      hideTimer.current = window.setTimeout(() => setChromeVisible(false), delay);
    },
    [clearHide],
  );

  /** delay=0 表示"停在顶部热区里"，不自动隐藏。 */
  const revealChrome = useCallback(
    (delay = 1600) => {
      clearHide();
      setChromeVisible(true);
      if (delay > 0) {
        hideTimer.current = window.setTimeout(() => setChromeVisible(false), delay);
      }
    },
    [clearHide],
  );

  // 进书先亮 1.6s：不然第一次进来的用户找不到"返回"
  useEffect(() => {
    hideTimer.current = window.setTimeout(() => setChromeVisible(false), 1600);
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  /** 面板打开期间不自动隐藏（否则设置面板会跟着顶栏一起消失）。 */
  const chromeLocked = panelOpen || tocOpen;

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (chromeLocked) return;
      // 顶部 80px 是"呼出区"（§4.6）
      if (e.clientY < 80) {
        if (!chromeVisible) revealChrome(0);
        else clearHide();
        return;
      }
      if (chromeVisible && hideTimer.current === null) scheduleHide();
    },
    [chromeLocked, chromeVisible, clearHide, revealChrome, scheduleHide],
  );

  // 同步最新 index/page 到 ref（放在声明之后——deps 数组是立即求值的）
  useEffect(() => {
    pageRef.current = { index, page };
  }, [index, page]);

  // 进书：先于首次 await 不得碰 setState（react-hooks/set-state-in-effect），
  // 所以重置逻辑全部放在 await 之后的分支里
  const loadSession = useCallback(async () => {
    try {
      const res = await commands.openBook(bookId);
      if (res.status !== "ok") throw res.error;
      setSession(res.data);
      setIndex(res.data.progress?.chapterIndex ?? 0);
      // 恢复进度的字级锚点：进书即登记，等章节渲染 + 量页后精确跳页
      const off = res.data.progress?.charOffset ?? 0;
      if (off > 0) setPendingOffset(off);
      setError(null);
    } catch (e) {
      setSession(null);
      setIndex(null);
      setChapter(null);
      setError(String(e));
    }
  }, [bookId, setPendingOffset]);

  useEffect(() => {
    // 进书拉取：loadSession 的 setState 都发生在 await 之后，
    // 并非 effect 内的同步 setState，这里对该规则做有依据的豁免（同 Shelf 首载）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSession();
  }, [loadSession]);

  // 读章：随 index 拉取（命中缓存则微任务即达——预取让翻章零等待）。
  // 统一走 then 路径：命中缓存也不在 effect 体内同步 setState
  useEffect(() => {
    if (index === null) return;
    let cancelled = false;
    const cached = getCachedChapter(bookId, index);
    const load =
      cached !== null
        ? Promise.resolve(cached)
        : commands
            .loadChapter(bookId, index)
            .then((res) => {
              if (res.status !== "ok") throw res.error;
              return res.data;
            });
    void load
      .then((data) => {
        if (cancelled) return;
        putCachedChapter(bookId, index, data);
        setChapter(data);
        setPage(0);
        setReadyKey(data.index);
        setError(null);
        // 预取邻章（±1）：本章就位后立即静默拉取，翻到时已在内存里
        if (session !== null) {
          const neighbors = [index - 1, index + 1].filter(
            (i) => i >= 0 && i < session.chapters.length,
          );
          prefetchChapters(bookId, neighbors, (bid, i) =>
            commands
              .loadChapter(bid, i)
              .then((res) => {
                if (res.status !== "ok") throw res.error;
                return res.data;
              }),
          );
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(describeError(e));
      });
    // 进度保存由下方防抖 saver 统一承担（带真实字级偏移）
    return () => {
      cancelled = true;
    };
  }, [bookId, index, session]);

  // 视口宽度：ResizeObserver 订阅外部系统（DOM 布局），旋转/缩放/侧栏都自动重排。
  // 依赖 viewportEl——元素真正挂载后才 observe（早退渲染期间它是 null）
  useEffect(() => {
    if (viewportEl === null) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setPageWidth(w);
    });
    ro.observe(viewportEl);
    return () => ro.disconnect();
  }, [viewportEl]);

  // 量页 + 建锚点：章节内容或视口宽度变化后，重新数总页数、重建切面表。
  // DOM 布局完成后才能测量，useLayoutEffect 是这里的本职工具；
  // setState 由测量结果驱动（外部系统），不属于规则想拦的"同步派生状态"。
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track === null || pageWidth <= 0) return;
    const count = totalPages(track.scrollWidth, pageWidth, PAGE_GAP);
    const chapterReady = chapter !== null && chapter.index === index;
    if (chapterReady) {
      let frags = fragments;
      const bkey = `${chapter.index}|${pageWidth}|${reflowTick}|${chapter.text.length}`;
      if (bkey !== builtKeyRef.current) {
        // 原点取自不位移的 viewport 左缘（track 无边距，translate=0 时与它重合），
        // 因此量测与当前页码无关，翻页不重建切面表
        const stride = pageStride(pageWidth, PAGE_GAP);
        const origin = viewportEl !== null ? viewportEl.getBoundingClientRect().left : 0;
        // 量测必须在「不位移」状态下做：track 带着 translateX 时，Range 拿到的是
        // 位移后的坐标，col 会整体平移（甚至出负列号），整张切面表的页码语义就废了。
        // 这里临时归零、量完立刻还原成 React 写的那份 inline 值，避免下次渲染丢样式。
        const prevTransform = track.style.transform;
        track.style.transform = "translateX(0px)";
        frags = buildFragments(track, origin, stride);
        track.style.transform = prevTransform;
        builtKeyRef.current = bkey;
        setFragments(frags);
      }
      setPageCount(count);
      if (pendingOffset !== null) {
        // 恢复进度（或回上一章末页）：按锚点精确跳页。
        // setState 发生在首帧绘制前——浏览器只见到落位后的样式，不会播放长滑
        const target = offsetToPage(frags, pendingOffset);
        setPendingOffset(null);
        setPage(clampPage(target, count));
      } else {
        setPage((p) => clampPage(p, count));
      }
    } else {
      setPageCount(count);
    }
    // reflowTick：字号/行距/页边距变化后的重排节拍；pendingOffset：待跳页锚点
  }, [chapter, index, pageWidth, viewportEl, reflowTick, pendingOffset, fragments]);

  // 进度保存（防抖 500ms）：翻页/切章静置半秒后，按当前页首的
  // 字级锚点存盘。restore 跳页也会触发一次——存回同一位置，无害。
  useEffect(() => {
    const chapterReady = chapter !== null && chapter.index === index;
    if (index === null || !chapterReady) return;
    const t = window.setTimeout(() => {
      const saved =
        pageToOffset(fragments, page) ?? fragments[fragments.length - 1]?.offset ?? 0;
      void commands.saveProgress(bookId, index, saved).catch(() => {});
    }, 500);
    return () => window.clearTimeout(t);
  }, [bookId, index, page, chapter, fragments]);

  // 切后台 / 关窗立即保存（docs/05 §2.6）：防抖管翻页流，visibilitychange 兜底突发离开。
  // 页位从 ref 取（监听器不随翻页重装），切面表随重排重建时重装监听
  useEffect(() => {
    const flush = () => {
      const { index: idx, page: pg } = pageRef.current;
      if (idx === null) return;
      const off =
        pageToOffset(fragments, pg) ?? fragments[fragments.length - 1]?.offset ?? 0;
      void commands.saveProgress(bookId, idx, off).catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", flush);
    };
  }, [bookId, fragments]);

  const goNext = useCallback(() => {
    if (index === null) return;
    const total = session?.chapters.length ?? 0;
    if (page < pageCount - 1) {
      setPage(page + 1);
    } else if (index < total - 1) {
      setEnter("next");
      setIndex(index + 1);
    }
  }, [index, page, pageCount, session]);

  const goPrev = useCallback(() => {
    if (index === null) return;
    if (page > 0) {
      setPage(page - 1);
    } else if (index > 0) {
      // 回上一章 → 量页后按锚点落到其末页（Infinity = 最后一个片段）
      setEnter("prev");
      setPendingOffset(Number.POSITIVE_INFINITY);
      setIndex(index - 1);
    }
  }, [index, page, setPendingOffset]);

  /** 跳到指定章（目录 / 进度条）：不走跨章滑入动画——那是"翻一页"，不是"跳过去"。 */
  const seekToChapter = useCallback(
    (target: number) => {
      setEnter(null);
      setPendingOffset(0);
      setIndex(target);
      setPage(0);
    },
    [setPendingOffset],
  );

  // 键盘（桌面）：翻页 + Ctrl+B 目录 + Esc 逐级回退
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setTocOpen((v) => !v);
        revealChrome(0);
        return;
      }
      if (e.key === "Escape") {
        if (panelOpen) setPanelOpen(false);
        else if (tocOpen) setTocOpen(false);
        return;
      }
      if (e.key === "ArrowRight" || e.key === "PageDown") goNext();
      if (e.key === "ArrowLeft" || e.key === "PageUp") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, panelOpen, tocOpen, revealChrome]);

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
  // 切章加载期间 chapter 持有旧章（readyKey 未变）——内容与段落照旧渲染，
  // 新章到达才整体重挂载并播放入场动画
  const paragraphs =
    chapter !== null ? chapter.text.split("\n").filter((line) => line.trim() !== "") : [];

  // 全书进度：章位置 + 章内页位置（只用于进度条读数，不参与任何位置计算）
  const overallPct =
    total > 0
      ? Math.min(
          100,
          ((index + (pageCount > 0 ? (page + 1) / pageCount : 0)) / total) * 100,
        )
      : 0;
  const shownPct = dragPct ?? overallPct;

  const commitSeek = () => {
    if (dragPct === null) return;
    const target = Math.min(
      total - 1,
      Math.max(0, Math.floor((dragPct / 100) * total)),
    );
    setDragPct(null);
    if (target !== index) seekToChapter(target);
  };

  // 点按翻页（触屏友好）：左右 1/4 屏为翻页热区，中央切换 chrome（§3.2）
  const onViewportClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!chapterReady) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (x < 0.25) {
      goPrev();
    } else if (x > 0.75) {
      goNext();
    } else if (chromeVisible) {
      clearHide();
      setChromeVisible(false);
    } else {
      revealChrome(2500);
    }
  };

  const stepFont = (delta: number) => {
    const { min, max } = PREFS_LIMITS.fontSize;
    changePrefs({
      fontSize: Math.min(max, Math.max(min, prefs.fontSize + delta)),
    });
  };

  /** 滑杆的已填充部分：原生 track 画不出来，用 input 自身的背景渐变充当。 */
  const sliderFill = (pct: number, fill: string) =>
    ({
      backgroundImage: `linear-gradient(to right, ${fill} ${pct}%, var(--ui-border) ${pct}%)`,
    }) as React.CSSProperties;

  return (
    <div className="reader-page" style={prefsToCssVars(prefs) as React.CSSProperties}>
      <div className="reader-main" onPointerMove={handlePointerMove}>
        {/* 顶栏：绝对定位浮层，不占布局高度（正文列高恒定 ← 翻页页数不跳） */}
        <header className={chromeVisible ? "reader-top" : "reader-top reader-top--hidden"}>
          <button
            type="button"
            aria-label="返回书架"
            className="reader-ico"
            onClick={onBack}
          >
            <ArrowLeft size={17} strokeWidth={2} />
          </button>
          <span className="reader-top-title">{session.book.title}</span>
          <span className="reader-top-meta">
            CH.{index + 1} / {total}
          </span>
          <span className="reader-spacer" />
          <button
            type="button"
            aria-label="目录"
            aria-expanded={tocOpen}
            aria-keyshortcuts="Control+B"
            onClick={() => {
              setTocOpen((v) => !v);
              revealChrome(0);
            }}
            className={tocOpen ? "reader-ico reader-ico--on" : "reader-ico"}
          >
            <List size={17} strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="排版设置"
            aria-expanded={panelOpen}
            onClick={() => {
              setPanelOpen((v) => !v);
              revealChrome(0);
            }}
            className={panelOpen ? "reader-ico reader-ico--on" : "reader-ico"}
          >
            <SlidersHorizontal size={17} strokeWidth={2} />
          </button>
        </header>

        {/* CSS 多列视口（§7.1）：column-fill 必须 auto（顺序填页），transform 位移翻页 */}
        <main
          className="reader-stage"
          onClick={onViewportClick}
          aria-live="polite"
          aria-label={`第 ${page + 1} 页，共 ${pageCount} 页`}
        >
          <div className="reader-viewport" ref={setViewportEl}>
            <div
              key={`ch-${readyKey ?? "boot"}`}
              ref={trackRef}
              className="reader-track"
              style={
                {
                  columnWidth: pageWidth > 0 ? `${pageWidth}px` : undefined,
                  columnGap: `${PAGE_GAP}px`,
                  transform: `translateX(${pageOffset(page, pageWidth, PAGE_GAP)}px)`,
                  visibility: pageWidth > 0 ? undefined : "hidden",
                  // 跨章进入：从邻页（目标位 ± 一页）滑入。切章加载期间旧章仍在显示，
                  // 此样式随新章内容一起到达；章内翻页不受影响（走 transition）
                  ...(enter !== null && pageWidth > 0
                    ? {
                        animation: "reader-enter var(--ui-dur-panel) var(--ui-ease)",
                        "--enter-x": `${
                          pageOffset(page, pageWidth, PAGE_GAP) +
                          (enter === "next" ? 1 : -1) * (pageWidth + PAGE_GAP)
                        }px`,
                      }
                    : {}),
                } as React.CSSProperties
              }
            >
              {chapter !== null && (
                <article className="reader-content">
                  <header className="reader-chapter-head">
                    <span className="reader-chapter-kicker">
                      CHAPTER {String(index + 1).padStart(3, "0")}
                    </span>
                    <h2 className="reader-chapter-title">{chapter.title}</h2>
                    <i className="reader-chapter-rule" aria-hidden />
                  </header>
                  {paragraphs.map((text, i) => (
                    <p key={i}>{text}</p>
                  ))}
                </article>
              )}
            </div>
          </div>
        </main>

        {/* 页码：右下角，属"排版"不属于"UI"，始终可见 */}
        <div className="reader-pageno">
          {page + 1} / {pageCount}
        </div>

        {/* 底部工具条：进度 / 主题 / 字号（书签按钮待 IPC 契约落地后再加） */}
        <div className={chromeVisible ? "ui-dock" : "ui-dock ui-dock--hidden"}>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(shownPct)}
            aria-label="全书进度"
            className="ui-slider"
            style={sliderFill(shownPct, "var(--ui-accent-500)")}
            onChange={(e) => setDragPct(Number(e.target.value))}
            onPointerUp={commitSeek}
            onKeyUp={commitSeek}
            onBlur={commitSeek}
          />
          <span className="ui-dock-count">{Math.round(shownPct)}%</span>
          <span className="ui-dock-div" aria-hidden />
          <ThemeDots compact />
          <span className="ui-dock-div" aria-hidden />
          <div className="ui-dock-aa">
            <button
              type="button"
              aria-label="减小字号"
              disabled={prefs.fontSize <= PREFS_LIMITS.fontSize.min}
              onClick={() => stepFont(-1)}
            >
              A−
            </button>
            <span className="v">{prefs.fontSize}</span>
            <button
              type="button"
              aria-label="增大字号"
              disabled={prefs.fontSize >= PREFS_LIMITS.fontSize.max}
              onClick={() => stepFont(1)}
            >
              A+
            </button>
          </div>
        </div>

        {/* 阅读设置：标签 52 / 控件中 / 数值右 52 等宽（§4.6） */}
        {panelOpen && (
          <div className="ui-prefs" role="group" aria-label="阅读排版设置">
            {(
              [
                ["字号", "fontSize", `${prefs.fontSize}px`, PREFS_LIMITS.fontSize],
                ["行距", "lineHeight", prefs.lineHeight.toFixed(2), PREFS_LIMITS.lineHeight],
                ["段距", "paraSpacing", prefs.paraSpacing.toFixed(2), PREFS_LIMITS.paraSpacing],
                ["页边距", "margin", `${prefs.margin}px`, PREFS_LIMITS.margin],
              ] as const
            ).map(([label, key, display, limit]) => {
              const pct =
                ((prefs[key] - limit.min) / (limit.max - limit.min)) * 100;
              return (
                <label key={key} className="ui-prefs-row">
                  <span className="ui-prefs-label">{label}</span>
                  <span className="ui-prefs-ctl">
                    <input
                      type="range"
                      className="ui-slider"
                      min={limit.min}
                      max={limit.max}
                      step={limit.step}
                      value={prefs[key]}
                      style={sliderFill(pct, "var(--ui-ink)")}
                      onChange={(e) => changePrefs({ [key]: Number(e.target.value) })}
                    />
                  </span>
                  <span className="ui-prefs-value">{display}</span>
                </label>
              );
            })}
            <div className="ui-prefs-row">
              <span className="ui-prefs-label">字体</span>
              <span className="ui-prefs-seg">
                <button
                  type="button"
                  aria-pressed={prefs.fontFamily === "serif"}
                  onClick={() => changePrefs({ fontFamily: "serif" })}
                >
                  衬线
                </button>
                <button
                  type="button"
                  aria-pressed={prefs.fontFamily === "sans"}
                  onClick={() => changePrefs({ fontFamily: "sans" })}
                >
                  黑体
                </button>
              </span>
              <span className="ui-prefs-value">
                {prefs.fontFamily === "serif" ? "SERIF" : "SANS"}
              </span>
            </div>
          </div>
        )}
      </div>

      {tocOpen && (
        <TocPanel
          overlay={tocOverlay}
          chapters={session.chapters}
          current={index}
          onSelect={(i) => seekToChapter(i)}
          onClose={() => setTocOpen(false)}
        />
      )}
    </div>
  );
}
