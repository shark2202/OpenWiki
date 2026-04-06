import { useEffect, useCallback, useState, useMemo, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useContentStore } from "../../stores/contentStore";
import { getAllContent } from "../../services/storageService";
import { exportAllSingle, exportRangeSingle } from "../../services/dataHubService";
import { useSettingsStore, containsSensitiveData } from "../../stores/settingsStore";
import { ContentCard } from "./ContentCard";
import type { ContentType } from "../../types/content";

type FilterType = "all" | ContentType;
type DateRange = "all" | "today" | "week" | "half-month";

const FILTER_TABS: { value: FilterType; label: string; icon: string }[] = [
  { value: "all", label: "全部", icon: "📋" },
  { value: "text", label: "文本", icon: "📝" },
  { value: "image", label: "图片", icon: "🖼️" },
  { value: "url", label: "链接", icon: "🔗" },
];

export function ContentList() {
  const { contents, isLoading, setContents, setIsLoading } = useContentStore();
  const highlightedIds = useContentStore((s) => s.highlightedIds);
  const scrollToId = useContentStore((s) => s.scrollToId);
  const setScrollToId = useContentStore((s) => s.setScrollToId);
  const clearHighlights = useContentStore((s) => s.clearHighlights);
  const captureEnabled = useSettingsStore((s) => s.captureEnabled);
  const sensitiveFilterEnabled = useSettingsStore((s) => s.sensitiveFilterEnabled);
  const [filter, setFilter] = useState<FilterType>("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [exportStatus, setExportStatus] = useState<"idle" | "confirm" | "exporting" | "done">("idle");
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for scroll-to-item
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const loadContent = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getAllContent(50, 0);
      setContents(data);
    } catch (e) {
      console.error("Failed to load content:", e);
    } finally {
      setIsLoading(false);
    }
  }, [setContents, setIsLoading]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  useEffect(() => {
    const handleFocus = () => { loadContent(); };
    window.addEventListener("focus", handleFocus);
    return () => { window.removeEventListener("focus", handleFocus); };
  }, [loadContent]);

  // Listen for URL content fetch completion from Rust backend
  // When URL content is fetched, reload all content from DB to get the updated raw_text.
  useEffect(() => {
    const unlisten = listen<{ id: string }>(
      "content:url-fetched",
      (_event) => {
        console.log("URL content fetched, reloading content list");
        loadContent();
      }
    );
    return () => { unlisten.then((fn) => fn()); };
  }, [loadContent]);

  // Listen for AI summary/tags completion — reload to show tags and summary
  useEffect(() => {
    const unlisten = listen<string>(
      "content-summary-ready",
      (_event) => {
        console.log("Summary ready, reloading content list");
        loadContent();
      }
    );
    return () => { unlisten.then((fn) => fn()); };
  }, [loadContent]);

  // Listen for OCR completion — reload to show recognized text
  useEffect(() => {
    const unlisten = listen<{ id: string }>(
      "content:ocr-done",
      (_event) => {
        console.log("OCR done, reloading content list");
        loadContent();
      }
    );
    return () => { unlisten.then((fn) => fn()); };
  }, [loadContent]);

  // Handle scroll-to-item when scrollToId changes
  useEffect(() => {
    if (!scrollToId) return;

    // Reset filter to "all" so the target item is visible
    setFilter("all");

    // Wait for render, then scroll to the item
    const timer = setTimeout(() => {
      const el = cardRefs.current[scrollToId];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setScrollToId(null);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [scrollToId, setScrollToId, contents]);

  // Auto-clear highlights after 4 seconds
  useEffect(() => {
    if (highlightedIds.length === 0) return;
    const timer = setTimeout(() => {
      clearHighlights();
    }, 4000);
    return () => clearTimeout(timer);
  }, [highlightedIds, clearHighlights]);

  const filteredContents = useMemo(() => {
    let result = contents;
    if (sensitiveFilterEnabled) {
      result = result.filter((c) => !c.raw_text || !containsSensitiveData(c.raw_text));
    }
    if (filter !== "all") {
      result = result.filter((c) => c.content_type === filter);
    }
    if (dateRange !== "all") {
      const now = new Date();
      const cutoff = new Date();
      if (dateRange === "today") {
        cutoff.setHours(0, 0, 0, 0);
      } else if (dateRange === "week") {
        cutoff.setDate(now.getDate() - 7);
      } else if (dateRange === "half-month") {
        cutoff.setDate(now.getDate() - 15);
      }
      result = result.filter((c) => new Date(c.captured_at) >= cutoff);
    }
    return result;
  }, [contents, filter, sensitiveFilterEnabled, dateRange]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: contents.length };
    for (const c of contents) {
      counts[c.content_type] = (counts[c.content_type] || 0) + 1;
    }
    return counts;
  }, [contents]);

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="h-6 w-32 bg-white/50 dark:bg-white/[0.06] rounded-lg animate-pulse" />
          <div className="h-5 w-16 bg-white/50 dark:bg-white/[0.06] rounded-full animate-pulse" />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-orange-500/10 dark:bg-orange-500/10 rounded-xl animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200/50 dark:bg-white/[0.06] rounded w-3/4 animate-pulse" />
                <div className="h-3 bg-gray-200/30 dark:bg-white/[0.04] rounded w-1/2 animate-pulse" />
                <div className="h-3 bg-gray-200/30 dark:bg-white/[0.04] rounded w-1/3 animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (contents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-80">
        <div className="w-20 h-20 rounded-2xl glass flex items-center justify-center mb-5">
          <span className="text-4xl">📭</span>
        </div>
        <div className="font-medium text-gray-600 dark:text-slate-300 mb-2">
          还没有保存任何内容
        </div>
        <div className="text-sm text-gray-400 dark:text-slate-500 text-center max-w-xs">
          复制文本或截图后会自动保存到这里
        </div>
        <div className="mt-4 flex items-center gap-1.5 text-xs">
          <span className={`w-2 h-2 rounded-full ${captureEnabled ? "bg-green-400 animate-pulse" : "bg-gray-300 dark:bg-slate-600"}`} />
          <span className="text-gray-400 dark:text-slate-500">
            {captureEnabled ? "内容捕获已开启" : "内容捕获已关闭"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto p-4 space-y-3" style={{ height: "calc(100vh - 44px)" }}>
      {/* Header with filter tabs */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1 p-0.5 rounded-xl glass">
          {FILTER_TABS.map((tab) => {
            const count = typeCounts[tab.value] || 0;
            if (tab.value !== "all" && count === 0) return null;
            const isActive = filter === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={`
                  flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all
                  ${isActive
                    ? "bg-white/80 dark:bg-white/[0.1] text-orange-600 dark:text-orange-400 shadow-sm"
                    : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"
                  }
                `}
              >
                <span className="text-sm">{tab.icon}</span>
                <span>{tab.label}</span>
                <span className={`
                  ml-0.5 px-1.5 py-0.5 rounded-full text-[10px]
                  ${isActive
                    ? "bg-orange-500/10 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400"
                    : "bg-gray-200/50 dark:bg-white/[0.06] text-gray-400 dark:text-slate-500"
                  }
                `}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Date range filters */}
          {(["all", "today", "week", "half-month"] as DateRange[]).map((range) => {
            const label = range === "all" ? "全部" : range === "today" ? "今天" : range === "week" ? "近一周" : "半个月";
            const isActive = dateRange === range;
            return (
              <button
                key={range}
                onClick={() => setDateRange(isActive && range !== "all" ? "all" : range)}
                className={`text-[11px] px-2.5 py-1 rounded-md border transition-all
                  ${isActive
                    ? "text-white bg-orange-500 border-orange-500"
                    : "text-gray-400 dark:text-slate-500 border-gray-200/60 dark:border-white/[0.08] bg-white/60 dark:bg-white/[0.04] hover:border-orange-300 hover:text-orange-500"
                  }`}
              >
                {label}
              </button>
            );
          })}

          {/* Separator */}
          <div className="w-px h-4 bg-gray-200/60 dark:bg-white/[0.08] mx-0.5" />

          {/* Export current view */}
          <button
            onClick={async () => {
              if (exportStatus === "idle") {
                // First click: show confirm
                setExportStatus("confirm");
                confirmTimer.current = setTimeout(() => setExportStatus("idle"), 3000);
                return;
              }
              if (exportStatus === "confirm") {
                // Second click: do export
                if (confirmTimer.current) clearTimeout(confirmTimer.current);
                setExportStatus("exporting");
                try {
                  if (dateRange === "all") {
                    await exportAllSingle();
                  } else {
                    const now = new Date();
                    const end = now.toISOString().slice(0, 10);
                    const start = new Date();
                    if (dateRange === "today") start.setHours(0, 0, 0, 0);
                    else if (dateRange === "week") start.setDate(now.getDate() - 7);
                    else if (dateRange === "half-month") start.setDate(now.getDate() - 15);
                    await exportRangeSingle(start.toISOString().slice(0, 10), end);
                  }
                  setExportStatus("done");
                  setTimeout(() => setExportStatus("idle"), 3000);
                } catch (e) { console.error(e); setExportStatus("idle"); }
              }
            }}
            disabled={exportStatus === "exporting"}
            className={`text-[11px] px-2.5 py-1 rounded-md border transition-all flex items-center gap-1
              ${exportStatus === "confirm"
                ? "text-orange-600 border-orange-400 bg-orange-100 dark:bg-orange-500/20"
                : exportStatus === "done"
                ? "text-green-600 border-green-300 bg-green-50"
                : exportStatus === "exporting"
                ? "text-orange-500 border-orange-300 bg-orange-50 animate-pulse"
                : "text-gray-400 dark:text-slate-500 border-gray-200/60 dark:border-white/[0.08] bg-white/60 dark:bg-white/[0.04] hover:border-orange-300 hover:text-orange-500"
              }`}
          >
            {exportStatus === "confirm" ? "确认导出？" : exportStatus === "exporting" ? "导出中..." : exportStatus === "done" ? "✓ 已导出" : "↗ 导出"}
          </button>

          {/* Capture status */}
          <div className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500 ml-1">
            <span className={`w-1.5 h-1.5 rounded-full ${captureEnabled ? "bg-green-400" : "bg-gray-300 dark:bg-slate-600"}`} />
            {captureEnabled ? "捕获中" : "已暂停"}
          </div>
        </div>
      </div>

      {/* Content cards */}
      {filteredContents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <span className="text-3xl mb-3">🔍</span>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            暂无{FILTER_TABS.find((t) => t.value === filter)?.label}类型的内容
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredContents.map((content) => (
            <ContentCard
              key={content.id}
              content={content}
              isHighlighted={highlightedIds.includes(content.id)}
              ref={(el) => { cardRefs.current[content.id] = el; }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
