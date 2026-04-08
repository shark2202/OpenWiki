import { BookOpen, User, FileText, GitCompare, Layers, MessageCircle } from "lucide-react";
import type { WikiPage } from "../../types/wiki";

const TYPE_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string; size?: number }>; label: string; color: string }> = {
  concept: { icon: BookOpen, label: "概念", color: "#F97316" },
  entity: { icon: User, label: "实体", color: "#2563EB" },
  source: { icon: FileText, label: "来源", color: "#16A34A" },
  comparison: { icon: GitCompare, label: "对比", color: "#CA8A04" },
  overview: { icon: Layers, label: "总览", color: "#7C3AED" },
  qa: { icon: MessageCircle, label: "问答", color: "#78716C" },
};

function timeAgo(dateStr: string): string {
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now.getTime() - then.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

interface WikiPageCardProps {
  page: WikiPage;
  onClick: () => void;
}

export function WikiPageCard({ page, onClick }: WikiPageCardProps) {
  const config = TYPE_CONFIG[page.page_type] || TYPE_CONFIG.concept;
  const IconComponent = config.icon;
  const tags: string[] = page.tags ? JSON.parse(page.tags) : [];
  const isStale = page.status === "needs_recompile";

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl p-4 transition-all duration-150 hover:scale-[1.01] active:scale-[0.99]"
      style={{
        backgroundColor: "var(--color-surface, #FFFFFF)",
        border: `1px solid ${isStale ? "#CA8A0440" : "var(--color-border, #E7E5E4)"}`,
      }}
    >
      {/* Header: type badge + time */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <IconComponent size={14} style={{ color: config.color }} />
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ color: config.color, backgroundColor: `${config.color}15` }}
          >
            {config.label}
          </span>
          {isStale && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400">
              ⚠ 待更新
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: "var(--color-text-muted, #A8A29E)" }}>
          {timeAgo(page.updated_at)}
        </span>
      </div>

      {/* Title */}
      <h3
        className="font-semibold mb-1 line-clamp-2"
        style={{ fontSize: 15, color: "var(--color-text-primary, #1C1917)" }}
      >
        {page.title}
      </h3>

      {/* Summary */}
      {page.summary && (
        <p
          className="line-clamp-2 mb-2"
          style={{ fontSize: 13, lineHeight: 1.6, color: "var(--color-text-secondary, #57534E)" }}
        >
          {page.summary}
        </p>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 4).map((tag, i) => (
            <span
              key={i}
              className="rounded-full px-2 py-0.5"
              style={{
                fontSize: 11,
                color: "#F97316",
                backgroundColor: "#F9731610",
                border: "1px solid #F9731625",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Confidence bar (only show if not 1.0) */}
      {page.confidence < 0.95 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full" style={{ backgroundColor: "var(--color-border, #E7E5E4)" }}>
            <div
              className="h-1 rounded-full transition-all"
              style={{
                width: `${page.confidence * 100}%`,
                backgroundColor: page.confidence >= 0.8 ? "#16A34A" : page.confidence >= 0.5 ? "#CA8A04" : "#DC2626",
              }}
            />
          </div>
          <span style={{ fontSize: 10, color: "var(--color-text-muted, #A8A29E)" }}>
            {Math.round(page.confidence * 100)}%
          </span>
        </div>
      )}
    </button>
  );
}
