import { useState, useEffect, Component, type ReactNode } from "react";
import { RefreshCw, Key, Target, Search } from "lucide-react";
import { useRadarStore } from "../../stores/radarStore";
import type {
  Glance,
  InfoDiet,
  SubconsciousItem,
  Graveyard,
  BlindSpot,
  Action,
  HeatmapDay,
  TopicItem,
  Verdict,
  Footer,
  BriefingTopic,
} from "../../services/radarService";

const ACCENT = "#F97316";

// Error boundary
class RadarErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="px-5 py-8" style={{ color: "var(--color-text-primary)" }}>
          <h2 className="text-lg font-bold mb-2">洞察加载出错</h2>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{this.state.error}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-3 font-medium"
            style={{ fontSize: 13, color: ACCENT }}
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
    report,
    contentCount,
    hasNewContent,
    errorMessage,
    isLoading,
    loadRadar,
    triggerAnalysis,
    setupEventListener,
  } = useRadarStore();

  useEffect(() => {
    loadRadar();
    let unlisten: (() => void) | undefined;
    setupEventListener().then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [loadRadar, setupEventListener]);

  const isAnalyzing = status === "analyzing";
  const hasReport = report !== null;
  const hasLegacy = analysis !== null && (analysis.topics?.length ?? 0) > 0;
  const hasFindings = hasReport || hasLegacy;

  return (
    <div className="overflow-y-auto" style={{ height: "calc(100vh - 44px)", color: "var(--color-text-primary)" }}>

      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between mb-1">
          <h2
            style={{
              fontSize: 22,
              fontFamily: "'Cabinet Grotesk', sans-serif",
              fontWeight: 700,
              color: "var(--color-text-primary)",
              letterSpacing: "-0.3px",
            }}
          >
            深度洞察
          </h2>
          <div className="flex items-center gap-1">
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
        {!isLoading && hasFindings && (
          <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            AI 深度分析你的信息收藏行为
          </p>
        )}
      </div>

      <div className="px-5 pb-8">
        {/* Loading */}
        {isLoading && <LoadingSkeleton />}

        {/* Empty states */}
        {!isLoading && status === "no_api_key" && (
          <EmptyState
            icon={<Key size={48} className="text-stone-300 dark:text-stone-600 mb-4" strokeWidth={1.5} />}
            title="需要配置 AI 服务"
            desc="洞察报告需要 AI 来分析你的内容"
          />
        )}
        {!isLoading && status === "not_enough_content" && (
          <EmptyState
            icon={<Target size={48} className="text-stone-300 dark:text-stone-600 mb-4" strokeWidth={1.5} />}
            title="你离洞察只差几步"
            desc="继续保存你感兴趣的内容，积累到 5 条就能开始分析"
          />
        )}
        {!isLoading && !isAnalyzing && !hasFindings &&
         status !== "no_api_key" && status !== "not_enough_content" &&
         status !== "error" && (
          <EmptyState
            icon={<Search size={48} className="text-stone-300 dark:text-stone-600 mb-4" strokeWidth={1.5} />}
            title="这两周比较分散"
            desc="没有特别集中的方向。继续保存，下次分析可能会有新发现。"
          />
        )}
        {!isLoading && status === "error" && (
          <div className="rounded-xl p-4 mt-4" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
            <p className="text-red-700 dark:text-red-400 mb-2" style={{ fontSize: 13 }}>
              {errorMessage || "分析时出现错误"}
            </p>
            <button onClick={() => triggerAnalysis()} className="font-medium hover:underline" style={{ fontSize: 13, color: ACCENT }}>
              重新分析
            </button>
          </div>
        )}

        {/* V3 RadarReport */}
        {!isLoading && hasReport && report && (
          <div>
            <StatsGrid report={report} />
            <Section num="01" title="一眼看穿" subtitle="At a Glance">
              <AtAGlanceBody items={report.at_a_glance} />
            </Section>
            <Section num="02" title="信息食谱" subtitle="摄入结构">
              <InfoDietBody diet={report.info_diet} />
            </Section>
            <Section num="03" title="潜意识洞察" subtitle="没意识到的关注">
              <SubconsciousBody items={report.subconscious} />
            </Section>
            <Section num="04" title="收藏夹坟场" subtitle="沉没风险">
              <GraveyardBody graveyard={report.graveyard} />
            </Section>
            <Section num="05" title="知识空白" subtitle="被忽视的角度">
              <BlindSpotsBody items={report.blind_spots} />
            </Section>
            <Section num="06" title="行动建议" subtitle="可执行">
              <ActionsBody items={report.actions} />
            </Section>
            <Section num="⊹" title="时间热力图" subtitle="每日分布">
              <HeatmapBody days={report.heatmap} />
              <div style={{ height: 1, backgroundColor: "var(--color-border)", margin: "16px 0" }} />
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase", marginBottom: 10 }}>主题分布</div>
              <TopicCloudBody items={report.topic_cloud} />
            </Section>
            <Section num="07" title="一句话总结" subtitle="Final Verdict">
              <VerdictBody verdict={report.verdict} />
            </Section>
            <ReportFooter footer={report.footer} />

            {isAnalyzing && (
              <div className="text-center py-6">
                <RefreshCw size={16} className="animate-spin text-stone-400 mx-auto mb-2" />
                <p className="text-stone-400" style={{ fontSize: 13 }}>正在更新分析...</p>
              </div>
            )}
          </div>
        )}

        {/* V2 Legacy fallback */}
        {!isLoading && !hasReport && hasLegacy && analysis && (
          <>
            <LegacyBriefingHero topic={analysis.topics[0]} />
            {analysis.topics.length > 1 && (
              <div className="grid grid-cols-2 gap-3 mb-6">
                {analysis.topics.slice(1).map((topic) => (
                  <LegacyBriefingSecondary key={topic.id} topic={topic} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Analyzing with no data */}
        {!isLoading && isAnalyzing && !hasFindings && <AnalyzingSkeleton />}

        {/* Wiki health section */}
        <WikiLintSectionLazy />
      </div>
    </div>
  );
}

function WikiLintSectionLazy() {
  const [WikiLint, setWikiLint] = useState<React.ComponentType<{ compact?: boolean }> | null>(null);
  useEffect(() => {
    import("../wiki/WikiLintSection").then((m) => setWikiLint(() => m.WikiLintSection));
  }, []);
  if (!WikiLint) return null;
  return (
    <div className="mt-6 pt-4" style={{ borderTop: "1px solid var(--color-border, #E7E5E4)" }}>
      <WikiLint compact />
    </div>
  );
}

// ====================================================================
// Stats Grid (top 5 numbers)
// ====================================================================

function StatsGrid({ report }: { report: { meta: { total_items: number; active_days: number; annotated_items: number; annotation_rate: string; source_count: number }; footer: { total_days: number } } }) {
  const { meta } = report;
  const stats = [
    { n: meta.total_items, l: "保存条目" },
    { n: meta.active_days, l: "活跃天数" },
    { n: meta.annotated_items, l: "带备注" },
    { n: meta.annotation_rate, l: "主动率" },
    { n: meta.source_count, l: "信息源" },
  ];

  return (
    <div
      className="grid grid-cols-5 mb-6 overflow-hidden"
      style={{ borderRadius: 14, border: "1px solid var(--color-border)" }}
    >
      {stats.map((s, i) => (
        <div
          key={i}
          className="text-center py-4 px-2"
          style={{
            backgroundColor: "var(--color-surface)",
            borderRight: i < 4 ? "1px solid var(--color-border)" : undefined,
          }}
        >
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              fontFamily: "'JetBrains Mono', monospace",
              color: ACCENT,
            }}
          >
            {s.n}
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4, textTransform: "uppercase" }}>
            {s.l}
          </div>
        </div>
      ))}
    </div>
  );
}

// ====================================================================
// Section wrapper with numbered tag
// ====================================================================

function Section({ num, title, subtitle, children }: { num: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="mb-5" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 16 }}>
      {/* Section header */}
      <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: ACCENT,
            backgroundColor: `${ACCENT}15`,
            border: `1px solid ${ACCENT}30`,
            borderRadius: 6,
            padding: "2px 8px",
            flexShrink: 0,
          }}
        >
          {num}
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
          {title}{" "}
          <span style={{ color: ACCENT }}>{subtitle}</span>
        </span>
      </div>
      {/* Section body */}
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

// ====================================================================
// 01 At a Glance
// ====================================================================

function AtAGlanceBody({ items }: { items: Glance[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div
          key={i}
          className="rounded-xl p-4"
          style={{
            backgroundColor: `${ACCENT}08`,
            border: `1px solid ${ACCENT}20`,
          }}
        >
          <p style={{ fontSize: 14, lineHeight: 1.8, color: "var(--color-text-secondary)" }}>
            <HighlightText text={item.text} highlight={item.highlight} />
          </p>
        </div>
      ))}
    </div>
  );
}

// ====================================================================
// 02 Info Diet
// ====================================================================

function InfoDietBody({ diet }: { diet: InfoDiet }) {
  const maxCount = Math.max(...diet.sources.map((s) => s.count), 1);

  return (
    <>
      <div style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase", marginBottom: 10 }}>来源分布</div>
      <div className="space-y-2 mb-4">
        {diet.sources.map((src) => (
          <div key={src.name} className="flex items-center gap-3">
            <span className="w-20 text-right shrink-0" style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {src.name}
            </span>
            <div className="flex-1 rounded-md overflow-hidden" style={{ height: 24, backgroundColor: "var(--color-surface-raised, #F5F5F0)" }}>
              <div
                className="h-full rounded-md flex items-center justify-end px-2"
                style={{
                  width: `${Math.max((src.count / maxCount) * 100, 8)}%`,
                  background: sourceGradient(src.color),
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>{src.count}条</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <MiniCard title="深度vs碎片" value={diet.depth_ratio.label} percent={parsePercent(diet.depth_ratio.label)} />
        <MiniCard
          title="偏食度"
          value={`${diet.dominant_topic.name} ${diet.dominant_topic.percent.toFixed(0)}%`}
          percent={diet.dominant_topic.percent}
        />
      </div>

      {/* Alert */}
      {diet.alert && (
        <div
          className="flex gap-2 rounded-xl px-4 py-3"
          style={{
            fontSize: 13,
            backgroundColor: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.2)",
            color: "var(--color-text-secondary)",
          }}
        >
          <span>⚠️</span>
          <span>{diet.alert}</span>
        </div>
      )}
    </>
  );
}

function MiniCard({ title, value, percent }: { title: string; value: string; percent: number }) {
  return (
    <div className="rounded-xl p-3" style={{ backgroundColor: "var(--color-surface-raised, #F5F5F0)", border: "1px solid var(--color-border)" }}>
      <div style={{ fontSize: 10, color: "var(--color-text-muted)", textTransform: "uppercase", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{value}</div>
      <div className="mt-2 rounded-full overflow-hidden" style={{ height: 4, backgroundColor: "var(--color-border)" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(percent, 100)}%`, background: `linear-gradient(90deg, ${ACCENT}, #FB923C)` }} />
      </div>
    </div>
  );
}

// ====================================================================
// 03 Subconscious
// ====================================================================

function SubconsciousBody({ items }: { items: SubconsciousItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div
          key={i}
          className="rounded-r-xl py-3 px-4"
          style={{
            backgroundColor: "var(--color-surface-raised, #F5F5F0)",
            borderLeft: `3px solid ${ACCENT}`,
          }}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>
              🎯 {item.title}
            </span>
            {item.evidence_count != null && (
              <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: ACCENT, whiteSpace: "nowrap" }}>
                {item.evidence_count} 条证据
              </span>
            )}
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>{item.body}</p>
        </div>
      ))}
    </div>
  );
}

// ====================================================================
// 04 Graveyard
// ====================================================================

function GraveyardBody({ graveyard }: { graveyard: Graveyard }) {
  return (
    <>
      {/* Alert */}
      <div
        className="flex gap-2 rounded-xl px-4 py-3 mb-4"
        style={{
          fontSize: 13,
          backgroundColor: "rgba(245, 158, 11, 0.08)",
          border: "1px solid rgba(245, 158, 11, 0.2)",
          color: "var(--color-text-secondary)",
        }}
      >
        <span>🪦</span>
        <span>{graveyard.alert}</span>
      </div>

      <div style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase", marginBottom: 10 }}>值得重读</div>

      <div className="space-y-3">
        {graveyard.top_picks.map((pick) => (
          <div
            key={pick.rank}
            className="rounded-xl p-4 flex gap-3"
            style={{ backgroundColor: "var(--color-surface-raised, #F5F5F0)", border: "1px solid var(--color-border)" }}
          >
            {/* Numbered circle */}
            <div
              className="shrink-0 flex items-center justify-center"
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: `linear-gradient(135deg, ${ACCENT}, #EA580C)`,
                color: "#fff",
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              {pick.rank}
            </div>
            <div className="min-w-0 flex-1">
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 4 }}>{pick.title}</div>
              <p style={{ fontSize: 12, lineHeight: 1.6, color: "var(--color-text-secondary)", marginBottom: 8 }}>{pick.reason}</p>
              {pick.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pick.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full px-2.5 py-0.5"
                      style={{
                        fontSize: 10,
                        color: ACCENT,
                        backgroundColor: `${ACCENT}10`,
                        border: `1px solid ${ACCENT}25`,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ====================================================================
// 05 Blind Spots
// ====================================================================

function BlindSpotsBody({ items }: { items: BlindSpot[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div
          key={i}
          className="rounded-xl p-4"
          style={{
            backgroundColor: `${ACCENT}08`,
            border: `1px solid ${ACCENT}20`,
          }}
        >
          <h4 className="mb-1" style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>{item.title}</h4>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>{item.body}</p>
        </div>
      ))}
    </div>
  );
}

// ====================================================================
// 06 Actions
// ====================================================================

function ActionsBody({ items }: { items: Action[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div
          key={i}
          className="rounded-xl p-4 flex gap-3"
          style={{ backgroundColor: "var(--color-surface-raised, #F5F5F0)", border: "1px solid var(--color-border)" }}
        >
          <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{item.icon}</span>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 4 }}>{item.title}</div>
            <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-text-secondary)", marginBottom: 8 }}>{item.desc}</p>
            <div className="flex items-center gap-2">
              <span
                className="rounded-full px-2.5 py-0.5"
                style={{ fontSize: 10, color: ACCENT, backgroundColor: `${ACCENT}10`, border: `1px solid ${ACCENT}25` }}
              >
                {item.ref}
              </span>
              <span
                className="rounded-full px-2.5 py-0.5"
                style={{ fontSize: 10, color: "#10B981", backgroundColor: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.18)" }}
              >
                ⏱ {item.time}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ====================================================================
// Heatmap
// ====================================================================

function HeatmapBody({ days }: { days: HeatmapDay[] }) {
  const maxCount = Math.max(...days.map((d) => d.count), 1);

  return (
    <div className="flex gap-2 flex-wrap">
      {days.map((day) => {
        const intensity = day.count / maxCount;
        const isPeak = intensity > 0.8 && day.count > 0;
        const bg = day.count === 0
          ? "var(--color-surface-raised, #F5F5F0)"
          : `rgba(249, 115, 22, ${0.15 + intensity * 0.85})`;

        return (
          <div key={day.date} className="flex flex-col items-center gap-1">
            <div
              className="flex items-center justify-center rounded-lg"
              style={{
                width: 40,
                height: 40,
                backgroundColor: bg,
                border: day.count === 0 ? "1px solid var(--color-border)" : undefined,
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: intensity > 0.4 ? "#fff" : "var(--color-text-muted)",
                }}
              >
                {day.count > 0 ? day.count : ""}
              </span>
            </div>
            <span
              style={{
                fontSize: 9,
                fontFamily: "'JetBrains Mono', monospace",
                color: "var(--color-text-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {formatHeatDate(day.date)}{isPeak ? "⚡" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ====================================================================
// Topic Cloud (pill style)
// ====================================================================

function TopicCloudBody({ items }: { items: TopicItem[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item.name}
          className="rounded-full px-3 py-1"
          style={{
            fontSize: 13,
            color: ACCENT,
            backgroundColor: `${ACCENT}10`,
            border: `1px solid ${ACCENT}25`,
          }}
        >
          {item.name} ({item.percent.toFixed(0)}%)
        </span>
      ))}
    </div>
  );
}

// ====================================================================
// 07 Verdict
// ====================================================================

function VerdictBody({ verdict }: { verdict: Verdict }) {
  return (
    <div
      className="rounded-xl py-6 px-5 text-center"
      style={{
        background: `linear-gradient(135deg, ${ACCENT}12, rgba(234, 88, 12, 0.08))`,
        border: `1px solid ${ACCENT}30`,
      }}
    >
      <p
        style={{
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1.7,
          fontFamily: "'Cabinet Grotesk', sans-serif",
          color: "var(--color-text-primary)",
        }}
      >
        <HighlightVerdict text={verdict.text} highlights={verdict.highlights} />
      </p>
    </div>
  );
}

// ====================================================================
// Footer
// ====================================================================

function ReportFooter({ footer }: { footer: Footer }) {
  return (
    <div className="text-center py-4 mt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
      <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "var(--color-text-muted)" }}>
        <strong>小云洞察</strong> · {footer.date_range} · {footer.total} 条内容 · {footer.active_days}/{footer.total_days} 天活跃
      </div>
    </div>
  );
}

// ====================================================================
// Legacy v2 Briefing cards (fallback)
// ====================================================================

function LegacyBriefingHero({ topic }: { topic: BriefingTopic }) {
  return (
    <div className="rounded-xl p-4 mb-3" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: ACCENT }}>{topic.tag}</span>
      </div>
      <h3 className="mb-3" style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.4, fontFamily: "'Cabinet Grotesk', sans-serif" }}>{topic.insight_title}</h3>
      {topic.key_findings.length > 0 && (
        <div className="mb-3 space-y-2">
          {topic.key_findings.map((finding, i) => (
            <div key={i} className="flex gap-2" style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600, color: ACCENT, minWidth: 18, paddingTop: 2 }}>{i + 1}</span>
              <span>{finding}</span>
            </div>
          ))}
        </div>
      )}
      {topic.suggestion && (
        <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: `${ACCENT}10`, border: `1px solid ${ACCENT}30` }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: ACCENT, marginBottom: 4 }}>建议</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-text-secondary)" }}>{topic.suggestion}</div>
        </div>
      )}
      <div className="pt-3" style={{ borderTop: "1px solid var(--color-border)", fontSize: 11, color: "var(--color-text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
        {topic.content_count} 条内容 · 持续 {topic.span_days} 天
      </div>
    </div>
  );
}

function LegacyBriefingSecondary({ topic }: { topic: BriefingTopic }) {
  const tagColor = topic.tag === "新兴关注" ? "#4ADE80" : "#3B82F6";
  const truncatedAnalysis = topic.deep_analysis.length > 80 ? topic.deep_analysis.slice(0, 80) + "..." : topic.deep_analysis;

  return (
    <div className="rounded-xl p-3" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="w-1 h-1 rounded-full" style={{ backgroundColor: tagColor }} />
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: tagColor }}>{topic.tag}</span>
      </div>
      <h4 className="mb-1.5" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{topic.insight_title}</h4>
      <p className="mb-2.5" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-text-muted)" }}>{truncatedAnalysis}</p>
      <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
        {topic.content_count} 条 · {topic.span_days} 天
      </div>
    </div>
  );
}

// ====================================================================
// Helpers
// ====================================================================

function HighlightText({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight) return <>{text}</>;
  const idx = text.indexOf(highlight);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: ACCENT, fontWeight: 600 }}>{highlight}</span>
      {text.slice(idx + highlight.length)}
    </>
  );
}

function HighlightVerdict({ text, highlights }: { text: string; highlights: string[] }) {
  if (!highlights.length) return <>{text}</>;
  let parts: (string | { hl: string })[] = [text];
  for (const hl of highlights) {
    const newParts: (string | { hl: string })[] = [];
    for (const part of parts) {
      if (typeof part !== "string") { newParts.push(part); continue; }
      const idx = part.indexOf(hl);
      if (idx === -1) { newParts.push(part); } else {
        if (idx > 0) newParts.push(part.slice(0, idx));
        newParts.push({ hl });
        if (idx + hl.length < part.length) newParts.push(part.slice(idx + hl.length));
      }
    }
    parts = newParts;
  }
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string"
          ? <span key={i}>{p}</span>
          : <span key={i} style={{ color: ACCENT }}>{p.hl}</span>
      )}
    </>
  );
}

function sourceGradient(color: string): string {
  switch (color) {
    case "wechat": return "linear-gradient(90deg, #15803D, #22C55E)";
    case "chrome": return "linear-gradient(90deg, #1D4ED8, #3B82F6)";
    case "xiaoyun": return `linear-gradient(90deg, #EA580C, ${ACCENT})`;
    default: return "linear-gradient(90deg, #78716C, #A8A29E)";
  }
}

function formatHeatDate(date: string): string {
  // "2026-03-21" -> "3/21"
  const parts = date.split("-");
  if (parts.length === 3) return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
  return date;
}

function parsePercent(label: string): number {
  const m = label.match(/(\d+)/);
  return m ? parseInt(m[1]) : 50;
}

function EmptyState({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
      {icon}
      <p className="text-base font-medium mb-1">{title}</p>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{desc}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 mt-6">
      <div className="h-20 bg-stone-100 dark:bg-white/[0.06] rounded-xl animate-pulse" />
      <div className="h-48 bg-stone-100 dark:bg-white/[0.06] rounded-xl animate-pulse" />
      <div className="h-32 bg-stone-100 dark:bg-white/[0.06] rounded-xl animate-pulse" />
    </div>
  );
}

function AnalyzingSkeleton() {
  return (
    <div className="space-y-3 mt-6">
      <div className="h-20 bg-stone-100 dark:bg-white/[0.06] rounded-xl animate-pulse" />
      <div className="h-48 bg-stone-100 dark:bg-white/[0.06] rounded-xl animate-pulse" />
      <div className="text-center py-4">
        <RefreshCw size={16} className="animate-spin text-stone-400 mx-auto mb-2" />
        <p className="text-stone-400" style={{ fontSize: 13 }}>正在深度分析你的内容...</p>
      </div>
    </div>
  );
}

// ====================================================================
// HTML Export — self-contained report for browser viewing
// ====================================================================

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildExportHtml(r: import("../../services/radarService").RadarReport): string {
  const accent = "#F97316";
  const date = new Date().toISOString().slice(0, 10);

  const statsHtml = `
    <div class="stats-grid">
      <div class="stat"><div class="stat-num">${r.meta.total_items}</div><div class="stat-label">保存总数</div></div>
      <div class="stat"><div class="stat-num">${r.meta.active_days}</div><div class="stat-label">活跃天数</div></div>
      <div class="stat"><div class="stat-num">${r.meta.annotated_items}</div><div class="stat-label">有标签</div></div>
      <div class="stat"><div class="stat-num">${esc(r.meta.annotation_rate)}</div><div class="stat-label">标注率</div></div>
      <div class="stat"><div class="stat-num">${r.meta.source_count}</div><div class="stat-label">信息源</div></div>
    </div>`;

  const glanceHtml = r.at_a_glance.map(g =>
    `<div class="glance-item"><p>${esc(g.text)}</p></div>`
  ).join("");

  const sourcesHtml = r.info_diet.sources.map(s =>
    `<div class="source-row">
      <span class="source-name">${esc(s.name)}</span>
      <div class="source-bar"><div class="source-fill" style="width:${s.percent}%;background:${sourceGradientCss(s.color)}"></div></div>
      <span class="source-count">${s.count}</span>
    </div>`
  ).join("");

  const subconsciousHtml = r.subconscious.map(s =>
    `<div class="card">
      <div class="card-title">${esc(s.title)}</div>
      <p>${esc(s.body)}</p>
      ${s.evidence_count ? `<span class="badge">${s.evidence_count} 条证据</span>` : ""}
    </div>`
  ).join("");

  const graveyardHtml = r.graveyard.top_picks.map(p =>
    `<div class="card">
      <div class="pick-rank">${p.rank}</div>
      <div class="pick-body">
        <div class="card-title">${esc(p.title)}</div>
        <p>${esc(p.reason)}</p>
        <div class="tag-row">${p.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      </div>
    </div>`
  ).join("");

  const blindSpotsHtml = r.blind_spots.map(b =>
    `<div class="card"><div class="card-title">${esc(b.title)}</div><p>${esc(b.body)}</p></div>`
  ).join("");

  const actionsHtml = r.actions.map(a =>
    `<div class="card action-card">
      <span class="action-icon">${a.icon}</span>
      <div>
        <div class="card-title">${esc(a.title)}</div>
        <p>${esc(a.desc)}</p>
        <div class="action-meta">${esc(a.action_ref)} · ${esc(a.time)}</div>
      </div>
    </div>`
  ).join("");

  const heatmapHtml = r.heatmap.map(d => {
    const intensity = Math.min(d.count / Math.max(...r.heatmap.map(h => h.count)), 1);
    const bg = d.count === 0 ? "#1C1917" : `rgba(249,115,22,${0.2 + intensity * 0.8})`;
    return `<div class="heat-cell" style="background:${bg}" title="${d.date}: ${d.count}条">${d.count || ""}</div>`;
  }).join("");

  const topicHtml = r.topic_cloud.map(t =>
    `<span class="topic-tag">${esc(t.name)} ${t.percent.toFixed(0)}%</span>`
  ).join("");

  const verdictText = r.verdict.highlights.reduce(
    (text, hl) => text.replace(hl, `<span class="hl">${hl}</span>`),
    esc(r.verdict.text)
  );

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>小云洞察 · ${date}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700,800&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0C0A09; color: #FAFAF8; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; padding: 40px 20px; max-width: 640px; margin: 0 auto; -webkit-font-smoothing: antialiased; }
  h1 { font-family: 'Cabinet Grotesk', sans-serif; font-size: 28px; font-weight: 700; margin-bottom: 6px; letter-spacing: -0.5px; }
  h1 span { color: ${accent}; }
  .subtitle { font-size: 13px; color: #A8A29E; margin-bottom: 32px; }
  .section { margin-bottom: 28px; }
  .section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid #292524; }
  .section-num { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; color: ${accent}; background: ${accent}15; border: 1px solid ${accent}30; border-radius: 6px; padding: 2px 8px; }
  .section-title { font-family: 'Cabinet Grotesk', sans-serif; font-size: 16px; font-weight: 700; }
  .section-subtitle { font-size: 12px; color: #A8A29E; margin-left: auto; }
  .stats-grid { display: flex; gap: 12px; margin-bottom: 28px; }
  .stat { flex: 1; text-align: center; background: #1C1917; border: 1px solid #292524; border-radius: 12px; padding: 16px 8px; }
  .stat-num { font-family: 'Cabinet Grotesk', sans-serif; font-size: 24px; font-weight: 700; color: ${accent}; }
  .stat-label { font-size: 11px; color: #A8A29E; margin-top: 4px; }
  .card { background: #1C1917; border: 1px solid #292524; border-radius: 12px; padding: 16px; margin-bottom: 10px; }
  .card-title { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
  .card p { font-size: 13px; line-height: 1.7; color: #A8A29E; }
  .badge { display: inline-block; font-size: 11px; color: ${accent}; background: ${accent}15; border: 1px solid ${accent}25; border-radius: 99px; padding: 2px 10px; margin-top: 8px; }
  .pick-rank { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: ${accent}; color: white; font-weight: 700; font-size: 13px; float: left; margin-right: 12px; margin-top: 2px; }
  .pick-body { overflow: hidden; }
  .tag-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .tag { font-size: 12px; color: ${accent}; background: ${accent}10; border: 1px solid ${accent}25; border-radius: 99px; padding: 3px 12px; }
  .action-card { display: flex; gap: 12px; align-items: flex-start; }
  .action-icon { font-size: 20px; flex-shrink: 0; margin-top: 2px; }
  .action-meta { font-size: 11px; color: #78716C; margin-top: 6px; font-family: 'JetBrains Mono', monospace; }
  .source-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .source-name { font-size: 12px; color: #A8A29E; width: 70px; flex-shrink: 0; text-align: right; }
  .source-bar { flex: 1; height: 20px; background: #292524; border-radius: 4px; overflow: hidden; }
  .source-fill { height: 100%; border-radius: 4px; }
  .source-count { font-size: 12px; color: #78716C; width: 30px; font-family: 'JetBrains Mono', monospace; }
  .alert { font-size: 12px; color: #CA8A04; background: #422006; border: 1px solid #854D0E44; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; }
  .glance-item { margin-bottom: 12px; }
  .glance-item p { font-size: 14px; line-height: 1.8; color: #D6D3D1; }
  .heat-row { display: flex; gap: 4px; margin-bottom: 12px; flex-wrap: wrap; }
  .heat-cell { width: 36px; height: 36px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-family: 'JetBrains Mono', monospace; color: rgba(255,255,255,0.7); }
  .topic-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .topic-tag { font-size: 13px; color: ${accent}; background: ${accent}10; border: 1px solid ${accent}25; border-radius: 99px; padding: 4px 14px; }
  .verdict { text-align: center; padding: 24px 20px; background: linear-gradient(135deg, ${accent}12, rgba(234,88,12,0.08)); border: 1px solid ${accent}30; border-radius: 12px; margin-bottom: 20px; }
  .verdict p { font-family: 'Cabinet Grotesk', sans-serif; font-size: 18px; font-weight: 700; line-height: 1.7; }
  .hl { color: ${accent}; }
  .footer { text-align: center; font-size: 11px; color: #78716C; font-family: 'JetBrains Mono', monospace; padding: 16px 0; border-top: 1px solid #292524; }
  .depth-row { display: flex; gap: 16px; margin: 12px 0; }
  .depth-item { flex: 1; background: #1C1917; border: 1px solid #292524; border-radius: 10px; padding: 12px; text-align: center; }
  .depth-label { font-size: 11px; color: #78716C; text-transform: uppercase; }
  .depth-value { font-size: 16px; font-weight: 700; margin-top: 4px; }
</style>
</head>
<body>
  <h1>小云<span>洞察</span></h1>
  <div class="subtitle">${esc(r.meta.date_range)} · ${r.meta.total_items} 条内容 · ${r.meta.active_days} 天活跃</div>

  ${statsHtml}

  <div class="section">
    <div class="section-header"><span class="section-num">01</span><span class="section-title">一眼看穿</span><span class="section-subtitle">At a Glance</span></div>
    ${glanceHtml}
  </div>

  <div class="section">
    <div class="section-header"><span class="section-num">02</span><span class="section-title">信息食谱</span><span class="section-subtitle">摄入结构</span></div>
    ${sourcesHtml}
    <div class="depth-row">
      <div class="depth-item"><div class="depth-label">深度/碎片</div><div class="depth-value">${esc(r.info_diet.depth_ratio.label)}</div></div>
      <div class="depth-item"><div class="depth-label">主题</div><div class="depth-value">${esc(r.info_diet.dominant_topic.name)} ${r.info_diet.dominant_topic.percent.toFixed(0)}%</div></div>
    </div>
    <div class="alert">⚠ ${esc(r.info_diet.alert)}</div>
  </div>

  <div class="section">
    <div class="section-header"><span class="section-num">03</span><span class="section-title">潜意识洞察</span><span class="section-subtitle">没意识到的关注</span></div>
    ${subconsciousHtml}
  </div>

  <div class="section">
    <div class="section-header"><span class="section-num">04</span><span class="section-title">收藏夹坟场</span><span class="section-subtitle">沉没风险</span></div>
    <div class="alert">🪦 ${esc(r.graveyard.alert)}</div>
    ${graveyardHtml}
  </div>

  <div class="section">
    <div class="section-header"><span class="section-num">05</span><span class="section-title">知识空白</span><span class="section-subtitle">被忽视的角度</span></div>
    ${blindSpotsHtml}
  </div>

  <div class="section">
    <div class="section-header"><span class="section-num">06</span><span class="section-title">行动建议</span><span class="section-subtitle">可执行</span></div>
    ${actionsHtml}
  </div>

  <div class="section">
    <div class="section-header"><span class="section-num">⊹</span><span class="section-title">时间热力图</span><span class="section-subtitle">每日分布</span></div>
    <div class="heat-row">${heatmapHtml}</div>
    <div style="font-size:11px;color:#78716C;text-transform:uppercase;margin:12px 0 8px">主题分布</div>
    <div class="topic-row">${topicHtml}</div>
  </div>

  <div class="section">
    <div class="section-header"><span class="section-num">07</span><span class="section-title">一句话总结</span><span class="section-subtitle">Final Verdict</span></div>
    <div class="verdict"><p>${verdictText}</p></div>
  </div>

  <div class="footer"><strong>小云洞察</strong> · ${esc(r.footer.date_range)} · ${r.footer.total} 条内容 · ${r.footer.active_days}/${r.footer.total_days} 天活跃</div>
</body>
</html>`;
}

function sourceGradientCss(color: string): string {
  switch (color) {
    case "wechat": return "linear-gradient(90deg, #15803D, #22C55E)";
    case "chrome": return "linear-gradient(90deg, #1D4ED8, #3B82F6)";
    case "xiaoyun": return `linear-gradient(90deg, #EA580C, ${ACCENT})`;
    default: return "linear-gradient(90deg, #78716C, #A8A29E)";
  }
}
