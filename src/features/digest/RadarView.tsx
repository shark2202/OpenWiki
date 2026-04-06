import { useEffect, Component, type ReactNode } from "react";
import { RefreshCw, Target, Key, Search } from "lucide-react";
import { useRadarStore } from "../../stores/radarStore";
import { useContentStore } from "../../stores/contentStore";
import { InsightDetail } from "./InsightDetail";
import type { BriefingTopic } from "../../services/radarService";

// Error boundary to prevent crashes from making the whole app transparent
class RadarErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="px-5 py-8" style={{ color: "var(--color-text-primary)" }}>
          <h2 className="text-lg font-bold mb-2">雷达加载出错</h2>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{this.state.error}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-3 text-orange-500 font-medium"
            style={{ fontSize: 13 }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function RadarView() {
  return (
    <RadarErrorBoundary>
      <RadarViewInner />
    </RadarErrorBoundary>
  );
}

function RadarViewInner() {
  const {
    status,
    analysis,
    contentCount,
    hasNewContent,
    errorMessage,
    isLoading,
    selectedTopicIndex,
    loadRadar,
    triggerAnalysis,
    selectTopic,
    clearSelection,
    setupEventListener,
  } = useRadarStore();

  useEffect(() => {
    loadRadar();
    let unlisten: (() => void) | undefined;
    setupEventListener().then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [loadRadar, setupEventListener]);

  const topics = analysis?.topics ?? [];
  const idMap = analysis?.id_map ?? {};
  const hasFindings = topics.length > 0;
  const isAnalyzing = status === "analyzing";
  const contents = useContentStore((s) => s.contents);

  // Detail view
  if (selectedTopicIndex !== null && topics[selectedTopicIndex]) {
    return (
      <div className="px-5 py-4 overflow-y-auto" style={{ height: "calc(100vh - 44px)" }}>
        <InsightDetail
          topic={topics[selectedTopicIndex]}
          idMap={idMap}
          contents={contents}
          onBack={clearSelection}
        />
      </div>
    );
  }

  return (
    <div className="px-5 py-4 overflow-y-auto" style={{ height: "calc(100vh - 44px)", color: "var(--color-text-primary)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h2
          className="font-bold"
          style={{ fontSize: 22, fontFamily: "'Cabinet Grotesk', sans-serif", fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "-0.3px" }}
        >
          注意力雷达
        </h2>
        <div className="flex items-center gap-3">
          {!isLoading && hasFindings && (
            <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
              14天 · {contentCount}条
            </span>
          )}
          <button
            onClick={() => triggerAnalysis()}
            disabled={isAnalyzing || !hasNewContent}
            className="p-2 rounded-lg text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300
                       hover:bg-stone-100 dark:hover:bg-white/[0.08]
                       disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            title="刷新分析"
          >
            <RefreshCw size={18} strokeWidth={2} className={isAnalyzing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Subtitle */}
      {!isLoading && hasFindings && (
        <p className="mb-5" style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
          基于你最近保存的内容，AI 为你提炼了以下洞察
        </p>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-3 mt-6">
          <div className="h-48 bg-stone-100 dark:bg-white/[0.06] rounded-xl animate-pulse" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-32 bg-stone-100 dark:bg-white/[0.06] rounded-xl animate-pulse" />
            <div className="h-32 bg-stone-100 dark:bg-white/[0.06] rounded-xl animate-pulse" />
          </div>
        </div>
      )}

      {/* Empty states */}
      {!isLoading && status === "no_api_key" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
          <Key size={48} className="text-stone-300 dark:text-stone-600 mb-4" strokeWidth={1.5} />
          <p className="text-base font-medium mb-1">需要配置 AI 服务</p>
          <p className="mb-4" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            注意力雷达需要 AI 来分析你的内容
          </p>
          <button
            onClick={() => {/* navigate to settings - handled by parent */}}
            className="text-orange-500 font-medium hover:underline"
            style={{ fontSize: 13 }}
          >
            前往设置 →
          </button>
        </div>
      )}

      {!isLoading && status === "not_enough_content" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
          <Target size={48} className="text-stone-300 dark:text-stone-600 mb-4" strokeWidth={1.5} />
          <p className="text-base font-medium mb-1">你离洞察只差几步</p>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            继续保存你感兴趣的内容，积累到 5 条就能开始分析
          </p>
        </div>
      )}

      {/* No findings (0 topics = scattered) */}
      {!isLoading && !isAnalyzing && !hasFindings &&
       status !== "no_api_key" && status !== "not_enough_content" &&
       status !== "error" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
          <Search size={48} className="text-stone-300 dark:text-stone-600 mb-4" strokeWidth={1.5} />
          <p className="text-base font-medium mb-1">这两周比较分散</p>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            没有特别集中的方向。继续保存，下次分析可能会有新发现。
          </p>
        </div>
      )}

      {/* Error state */}
      {!isLoading && status === "error" && (
        <div className="rounded-xl p-4 mt-4" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
          <p className="text-red-700 dark:text-red-400 mb-2" style={{ fontSize: 13 }}>
            {errorMessage || "分析时出现错误"}
          </p>
          <button
            onClick={() => triggerAnalysis()}
            className="text-orange-500 font-medium hover:underline"
            style={{ fontSize: 13 }}
          >
            重新分析
          </button>
        </div>
      )}

      {/* Content: Briefing layout */}
      {!isLoading && hasFindings && (
        <>
          {/* Hero: top topic */}
          <BriefingHero topic={topics[0]} onExpand={() => selectTopic(0)} />

          {/* Secondary topics */}
          {topics.length > 1 && (
            <div className="grid grid-cols-2 gap-3 mb-6">
              {topics.slice(1).map((topic, i) => (
                <BriefingSecondary
                  key={topic.id}
                  topic={topic}
                  onExpand={() => selectTopic(i + 1)}
                />
              ))}
            </div>
          )}

          {/* Analyzing overlay when updating existing data */}
          {isAnalyzing && (
            <div className="text-center py-6">
              <RefreshCw size={16} className="animate-spin text-stone-400 mx-auto mb-2" />
              <p className="text-stone-400" style={{ fontSize: 13 }}>正在更新分析...</p>
            </div>
          )}
        </>
      )}

      {/* Analyzing with no existing data */}
      {!isLoading && isAnalyzing && !hasFindings && (
        <div className="space-y-3 mt-6">
          <div className="h-48 bg-stone-100 dark:bg-white/[0.06] rounded-xl animate-pulse" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-32 bg-stone-100 dark:bg-white/[0.06] rounded-xl animate-pulse" />
            <div className="h-32 bg-stone-100 dark:bg-white/[0.06] rounded-xl animate-pulse" />
          </div>
          <div className="text-center py-4">
            <RefreshCw size={16} className="animate-spin text-stone-400 mx-auto mb-2" />
            <p className="text-stone-400" style={{ fontSize: 13 }}>正在深度分析你的内容...</p>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Hero Card (top topic) ---

function BriefingHero({ topic, onExpand }: { topic: BriefingTopic; onExpand: () => void }) {
  const evidenceChips = topic.evidence_indices.slice(0, 3);
  const moreCount = topic.evidence_indices.length - 3;

  return (
    <div
      onClick={onExpand}
      className="rounded-xl p-5 mb-3 cursor-pointer transition-colors"
      style={{
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = "rgba(251, 146, 60, 0.3)"}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--color-border)"}
    >
      {/* Tag */}
      <div className="flex items-center gap-1.5 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "#FB923C" }}>
          {topic.tag}
        </span>
      </div>

      {/* Insight title */}
      <h3
        className="mb-3"
        style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.4, fontFamily: "'Cabinet Grotesk', sans-serif", color: "var(--color-text-primary)" }}
      >
        {topic.insight_title}
      </h3>

      {/* Key findings */}
      {topic.key_findings.length > 0 && (
        <div className="mb-3 space-y-2">
          {topic.key_findings.map((finding, i) => (
            <div key={i} className="flex gap-2" style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600, color: "#FB923C", minWidth: 18, paddingTop: 2 }}>
                {i + 1}
              </span>
              <span>{finding}</span>
            </div>
          ))}
        </div>
      )}

      {/* Suggestion */}
      {topic.suggestion && (
        <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: "var(--color-accent-soft, #431407)", border: "1px solid rgba(251, 146, 60, 0.25)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "#FB923C", marginBottom: 4 }}>
            建议
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
            {topic.suggestion}
          </div>
        </div>
      )}

      {/* Evidence chips */}
      {evidenceChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {evidenceChips.map((idx) => (
            <span key={idx} className="rounded-md px-2.5 py-0.5" style={{ fontSize: 11, color: "var(--color-text-muted)", backgroundColor: "var(--color-surface-raised, #292524)", border: "1px solid var(--color-border)" }}>
              内容 #{idx}
            </span>
          ))}
          {moreCount > 0 && (
            <span style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "'JetBrains Mono', monospace", padding: "2px 6px" }}>
              +{moreCount} 条
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
          {topic.content_count} 条内容 · 持续 {topic.span_days} 天
        </span>
        <TrendBadge trend={topic.trend} />
      </div>
    </div>
  );
}

// --- Secondary Card ---

function BriefingSecondary({ topic, onExpand }: { topic: BriefingTopic; onExpand: () => void }) {
  const tagColor = topic.tag === "新兴关注" ? "#4ADE80" : "#3B82F6";
  const truncatedAnalysis = topic.deep_analysis.length > 80
    ? topic.deep_analysis.slice(0, 80) + "..."
    : topic.deep_analysis;

  return (
    <div
      onClick={onExpand}
      className="rounded-xl p-4 cursor-pointer transition-colors"
      style={{
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--color-border)"}
    >
      {/* Tag */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="w-1 h-1 rounded-full" style={{ backgroundColor: tagColor }} />
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: tagColor }}>
          {topic.tag}
        </span>
      </div>

      {/* Title */}
      <h4 className="mb-1.5" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, color: "var(--color-text-primary)" }}>
        {topic.insight_title}
      </h4>

      {/* Description */}
      <p className="mb-2.5" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-text-muted)" }}>
        {truncatedAnalysis}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between" style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
        <span>{topic.content_count} 条 · {topic.span_days} 天</span>
        <TrendBadge trend={topic.trend} />
      </div>
    </div>
  );
}

// --- Trend Badge ---

function TrendBadge({ trend }: { trend: string }) {
  const config: Record<string, { label: string; color: string }> = {
    growing: { label: "↑ 持续增长", color: "#4ADE80" },
    emerging: { label: "● 新兴", color: "#3B82F6" },
    stable: { label: "— 稳定", color: "var(--color-text-muted)" },
    fading: { label: "↓ 消退", color: "var(--color-text-muted)" },
  };
  const { label, color } = config[trend] ?? config.stable;
  return <span style={{ fontSize: 11, fontWeight: 500, color }}>{label}</span>;
}
