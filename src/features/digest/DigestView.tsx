import { useEffect, useState, useCallback } from "react";
import { useDigestStore } from "../../stores/digestStore";
import { DigestCard } from "./DigestCard";

export function DigestView() {
  const {
    items, remaining, isLoading, digestedToday, error, loadItems, doDigest,
  } = useDigestStore();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => { loadItems(); }, [loadItems]);

  useEffect(() => {
    if (!isLoading && remaining > 0 && digestedToday === 0) {
      if (!localStorage.getItem("xiaoyun_digest_onboarding_seen")) setShowOnboarding(true);
    }
  }, [isLoading, remaining, digestedToday]);

  useEffect(() => {
    if (currentIndex >= items.length && items.length > 0) setCurrentIndex(items.length - 1);
  }, [items.length, currentIndex]);

  const slide = (dir: "left" | "right", cb: () => void) => {
    setSlideDir(dir);
    setTimeout(() => { cb(); setSlideDir(null); }, 150);
  };

  const goNext = useCallback(() => {
    if (currentIndex < items.length - 1) slide("left", () => setCurrentIndex((i) => i + 1));
  }, [currentIndex, items.length]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) slide("right", () => setCurrentIndex((i) => i - 1));
  }, [currentIndex]);

  const handleDigest = useCallback((action: "keep" | "archive" | "pin") => {
    const item = items[currentIndex];
    if (!item) return;
    slide("left", () => { doDigest(item.id, action); });
  }, [items, currentIndex, doDigest]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "1") handleDigest("keep");
      if (e.key === "2") handleDigest("archive");
      if (e.key === "3") handleDigest("pin");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [goPrev, goNext, handleDigest]);

  const currentItem = items[currentIndex];
  const allDone = !isLoading && items.length === 0 && digestedToday > 0;
  const noContent = !isLoading && items.length === 0 && digestedToday === 0 && remaining === 0;

  /*
   * Layout (fixed height, no overflow):
   * ┌─ header ──────────────────────┐  flex-shrink-0
   * ├─ onboarding / error ──────────┤  flex-shrink-0
   * ├─ ← [card (scrollable)] → ─────┤  flex-1 min-h-0
   * ├─ [还要] [放手] [重要] ─────────┤  flex-shrink-0
   * ├─ 3/12 · 🔥 ──────────────────┤  flex-shrink-0
   * └──────────────────────────────┘
   */
  return (
    <div className="flex flex-col px-5 py-4" style={{ height: "calc(100vh - 44px)" }}>
      {/* Header */}
      <div className="flex items-baseline justify-between mb-3 flex-shrink-0">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">本周消化</h2>
        <span className="text-xs text-gray-400 dark:text-slate-500">
          已消化 {digestedToday} 条 · 剩余 {remaining} 条
        </span>
      </div>

      {/* Onboarding */}
      {showOnboarding && (
        <div className="glass rounded-xl p-4 mb-3 flex-shrink-0">
          <p className="text-sm text-gray-700 dark:text-gray-200 mb-2 font-medium">👋 欢迎来到「消化」</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 leading-relaxed mb-3">
            这里展示你最近一周保存的内容。逐张翻看，决定保留还是放手。
          </p>
          <button
            onClick={() => { setShowOnboarding(false); localStorage.setItem("xiaoyun_digest_onboarding_seen", "1"); }}
            className="text-xs text-orange-500 dark:text-orange-400 hover:underline"
          >知道了，开始消化</button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="glass rounded-xl p-4 mb-3 flex-shrink-0">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button onClick={loadItems} className="text-xs text-red-500 hover:underline mt-1">重试</button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="glass rounded-xl p-6 w-full max-w-md">
            <div className="space-y-3">
              <div className="h-3 bg-gray-200/50 dark:bg-white/[0.06] rounded w-1/3 animate-pulse" />
              <div className="h-4 bg-gray-200/30 dark:bg-white/[0.04] rounded w-full animate-pulse" />
              <div className="h-4 bg-gray-200/30 dark:bg-white/[0.04] rounded w-2/3 animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {/* Empty states */}
      {allDone && (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <span className="text-4xl mb-3">✨</span>
          <p className="text-base font-medium text-gray-700 dark:text-gray-200 mb-1">本周内容消化完毕！</p>
          <p className="text-xs text-gray-400 dark:text-slate-500">你消化了 {digestedToday} 条内容</p>
        </div>
      )}
      {noContent && (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <span className="text-4xl mb-3">📭</span>
          <p className="text-base font-medium text-gray-700 dark:text-gray-200 mb-1">最近一周没有需要消化的内容</p>
          <p className="text-xs text-gray-400 dark:text-slate-500">复制一些内容，小云会帮你记住</p>
        </div>
      )}

      {/* Card area: arrows + card */}
      {!isLoading && currentItem && (
        <>
          <div className="flex-1 min-h-0 flex items-stretch gap-3">
            {/* Left arrow */}
            <button
              onClick={goPrev}
              disabled={currentIndex === 0}
              className={`flex-shrink-0 w-12 flex items-center justify-center rounded-xl transition-all
                ${currentIndex === 0
                  ? "text-gray-300 dark:text-slate-700 cursor-not-allowed"
                  : "text-gray-500 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-white/[0.08] hover:text-gray-700 dark:hover:text-slate-200"
                }`}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Card */}
            <div
              className={`flex-1 min-w-0 min-h-0 transition-all duration-150 ${
                slideDir === "left" ? "-translate-x-4 opacity-0"
                : slideDir === "right" ? "translate-x-4 opacity-0"
                : "translate-x-0 opacity-100"
              }`}
            >
              <DigestCard content={currentItem} />
            </div>

            {/* Right arrow */}
            <button
              onClick={goNext}
              disabled={currentIndex >= items.length - 1}
              className={`flex-shrink-0 w-12 flex items-center justify-center rounded-xl transition-all
                ${currentIndex >= items.length - 1
                  ? "text-gray-300 dark:text-slate-700 cursor-not-allowed"
                  : "text-gray-500 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-white/[0.08] hover:text-gray-700 dark:hover:text-slate-200"
                }`}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Action buttons — always visible, outside the card */}
          <div className="flex gap-2 mt-3 flex-shrink-0 max-w-lg mx-auto w-full">
            <button
              onClick={() => handleDigest("keep")}
              className="flex-1 py-2.5 text-sm font-medium rounded-lg border
                         text-emerald-600 dark:text-emerald-400
                         border-emerald-200/50 dark:border-emerald-500/20
                         bg-emerald-50/50 dark:bg-emerald-500/[0.06]
                         hover:bg-emerald-100/50 dark:hover:bg-emerald-500/[0.12]
                         active:scale-95 transition-all"
            >✓ 还要</button>
            <button
              onClick={() => handleDigest("archive")}
              className="flex-1 py-2.5 text-sm font-medium rounded-lg border
                         text-red-500 dark:text-red-400
                         border-red-200/50 dark:border-red-500/20
                         bg-red-50/50 dark:bg-red-500/[0.06]
                         hover:bg-red-100/50 dark:hover:bg-red-500/[0.12]
                         active:scale-95 transition-all"
            >✕ 放手</button>
            <button
              onClick={() => handleDigest("pin")}
              className="flex-1 py-2.5 text-sm font-medium rounded-lg border
                         text-amber-500 dark:text-amber-400
                         border-amber-200/50 dark:border-amber-500/20
                         bg-amber-50/50 dark:bg-amber-500/[0.06]
                         hover:bg-amber-100/50 dark:hover:bg-amber-500/[0.12]
                         active:scale-95 transition-all"
            >★ 重要</button>
          </div>

          {/* Progress */}
          <div className="mt-2 mb-1 flex items-center justify-center gap-3 text-xs text-gray-400 dark:text-slate-500 flex-shrink-0">
            <span>{currentIndex + 1} / {items.length}</span>
            {digestedToday > 0 && (
              <><span>·</span><span>🔥 已消化 {digestedToday} 条</span></>
            )}
          </div>
        </>
      )}
    </div>
  );
}
