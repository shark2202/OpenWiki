import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import type { BriefingTopic } from "../../services/radarService";
import type { CapturedContent } from "../../types/content";
import { getContentsByIds } from "../../services/storageService";
import { FullTextOverlay } from "../content-list/ContentCard";

interface InsightDetailProps {
  topic: BriefingTopic;
  idMap: Record<string, string>;
  contents: CapturedContent[];
  onBack: () => void;
}

export function InsightDetail({ topic, idMap, contents, onBack }: InsightDetailProps) {
  const [extraContents, setExtraContents] = useState<CapturedContent[]>([]);
  const [viewingContent, setViewingContent] = useState<CapturedContent | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch missing content items not in the store
  useEffect(() => {
    const missingIds = topic.evidence_indices
      .map((idx) => idMap[String(idx)])
      .filter((id): id is string => !!id && !contents.find((c) => c.id === id));

    if (missingIds.length > 0) {
      getContentsByIds(missingIds).then(setExtraContents).catch(() => {});
    }
  }, [topic.evidence_indices, idMap, contents]);

  const allContents = [...contents, ...extraContents];

  // Resolve evidence indices to actual content items
  const evidenceItems = topic.evidence_indices.map((idx) => {
    const contentId = idMap[String(idx)];
    const item = contentId ? allContents.find((c) => c.id === contentId) : undefined;
    return { idx, contentId, item };
  });
  const tagColor = topic.tag === "核心关注" ? "#FB923C"
    : topic.tag === "新兴关注" ? "#4ADE80"
    : "#3B82F6";

  return (
    <div style={{ color: "var(--color-text-primary)" }}>
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 mb-5 transition-colors"
        style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
        onMouseEnter={(e) => e.currentTarget.style.color = "#FB923C"}
        onMouseLeave={(e) => e.currentTarget.style.color = "var(--color-text-secondary)"}
      >
        <ArrowLeft size={14} />
        返回雷达
      </button>

      {/* Tag */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tagColor }} />
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: tagColor }}>
          {topic.tag}
        </span>
      </div>

      {/* Title */}
      <h3
        className="mb-1"
        style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3, fontFamily: "'Cabinet Grotesk', sans-serif" }}
      >
        {topic.insight_title}
      </h3>

      {/* Meta */}
      <p className="mb-6" style={{ fontSize: 12, color: "var(--color-text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
        {topic.content_count} 条内容 · 持续 {topic.span_days} 天 · {trendLabel(topic.trend)}
      </p>

      {/* Deep analysis */}
      <div
        className="rounded-xl p-4 mb-6"
        style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}
      >
        {topic.deep_analysis.split("\n").map((paragraph, i) => (
          paragraph.trim() ? (
            <p key={i} className="mb-3 last:mb-0" style={{ fontSize: 14, lineHeight: 1.7, color: "var(--color-text-secondary)" }}>
              {paragraph}
            </p>
          ) : null
        ))}
      </div>

      {/* Key findings */}
      {topic.key_findings.length > 0 && (
        <div className="mb-6">
          <h4 className="mb-3" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--color-text-muted)" }}>
            核心发现
          </h4>
          <div className="space-y-2">
            {topic.key_findings.map((finding, i) => (
              <div key={i} className="flex gap-2" style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600, color: tagColor, minWidth: 18, paddingTop: 2 }}>
                  {i + 1}
                </span>
                <span>{finding}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggestion */}
      {topic.suggestion && (
        <div className="rounded-xl p-4 mb-6" style={{ backgroundColor: "var(--color-accent-soft, #431407)", border: "1px solid rgba(251, 146, 60, 0.25)" }}>
          <div className="mb-1" style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "#FB923C" }}>
            建议
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
            {topic.suggestion}
          </div>
        </div>
      )}

      {/* Evidence: related content items */}
      {evidenceItems.length > 0 && (
        <div>
          <h4 className="mb-3" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--color-text-muted)" }}>
            相关内容 · {evidenceItems.length} 条
          </h4>
          <div>
            {evidenceItems.map(({ idx, item }) => {
              const title = item?.summary
                || item?.raw_text?.slice(0, 80)
                || item?.source_url
                || `内容 #${idx}`;
              const date = item?.captured_at?.slice(0, 10) || "";
              return (
                <div
                  key={idx}
                  className={`flex items-start gap-3 py-3 ${item ? "cursor-pointer hover:bg-white/[0.03] -mx-2 px-2 rounded-lg transition-colors" : ""}`}
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                  onClick={item ? () => setViewingContent(item) : undefined}
                >
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "'JetBrains Mono', monospace", minWidth: 44, paddingTop: 2, flexShrink: 0 }}>
                    {date}
                  </span>
                  <span style={{ fontSize: 13, color: item ? "var(--color-text-primary)" : "var(--color-text-muted)", lineHeight: 1.4 }}>
                    {title}{!item?.summary && (item?.raw_text?.length ?? 0) > 80 ? "..." : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Full text overlay portal */}
      {createPortal(
        <AnimatePresence>
          {viewingContent && (
            <FullTextOverlay
              content={viewingContent}
              copied={copied}
              onCopy={async () => {
                if (viewingContent.raw_text) {
                  await navigator.clipboard.writeText(viewingContent.raw_text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }
              }}
              onClose={() => { setViewingContent(null); setCopied(false); }}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

function trendLabel(trend: string): string {
  switch (trend) {
    case "growing": return "↑ 持续增长";
    case "emerging": return "● 新兴";
    case "stable": return "— 稳定";
    case "fading": return "↓ 消退";
    default: return "— 稳定";
  }
}
