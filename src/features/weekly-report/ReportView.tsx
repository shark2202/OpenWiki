import { useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useReportStore } from "../../stores/reportStore";
import {
  generateReport,
  getReport,
  getAllReports,
  submitFeedback,
} from "../../services/reportService";
import { getAllContent } from "../../services/storageService";
import { ReportSummaryCard } from "./ReportSummary";
import { SECTION_THEME } from "./ReportCard";
import { ImageFilmstrip } from "./ImageFilmstrip";
import { CompactLinkList } from "./CompactLinkList";
import { TextContentList } from "./TextContentList";
import type { FilterMode } from "./ActivityStatsCard";
import type { ReportSummary, ReportSection, WeeklyReport, FeedbackType } from "../../types/report";
import type { CapturedContent } from "../../types/content";

export function ReportView() {
  const {
    currentReport,
    reportList,
    isGenerating,
    error,
    setCurrentReport,
    setReportList,
    setIsGenerating,
    setError,
  } = useReportStore();

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [weekContents, setWeekContents] = useState<CapturedContent[]>([]);

  useEffect(() => {
    loadReportList();
  }, []);

  useEffect(() => {
    if (currentReport) {
      loadWeekContent(currentReport.week_start, currentReport.week_end);
    }
  }, [currentReport?.id]);

  useEffect(() => {
    setFilterMode("all");
  }, [currentReport?.id]);

  const loadWeekContent = async (weekStart: string, weekEnd: string) => {
    try {
      const allContent = await getAllContent(500, 0);
      const filtered = allContent.filter((c) => {
        return c.captured_at >= weekStart && c.captured_at <= weekEnd && !c.is_deleted;
      });
      setWeekContents(filtered);
    } catch (e) {
      console.error("Failed to load week content:", e);
    }
  };

  const loadReportList = async () => {
    try {
      const reports = await getAllReports();
      setReportList(reports);
      if (reports.length > 0 && !currentReport) {
        await loadReport(reports[0].week_start);
      }
    } catch (e) {
      console.error("Failed to load report list:", e);
    }
  };

  const loadReport = async (weekStart: string) => {
    try {
      setError(null);
      const report = await getReport(weekStart);
      setCurrentReport(report);
      setIsHistoryOpen(false);
    } catch (e) {
      console.error("Failed to load report:", e);
      setError("加载周报失败，请稍后重试");
    }
  };

  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setError(null);

    try {
      const report = await generateReport();
      setCurrentReport(report);
      const reports = await getAllReports();
      setReportList(reports);
    } catch (e) {
      console.error("Failed to generate report:", e);
      setError("生成周报失败，请确认已配置 AI 服务后重试");
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, setIsGenerating, setError, setCurrentReport, setReportList]);

  const weekRange = currentReport
    ? formatDateRange(currentReport.week_start, currentReport.week_end)
    : formatCurrentWeekRange();

  return (
    <div className="min-h-screen">
      {/* ── Header ── */}
      <div className="sticky top-0 z-20 glass-heavy">
        <div className="px-4 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                周报
              </h1>
              <span className="text-[11px] text-gray-400 dark:text-slate-500">
                {weekRange}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {reportList.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-gray-400 dark:text-slate-500
                               hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    历史
                  </button>
                  <AnimatePresence>
                    {isHistoryOpen && (
                      <HistoryDropdown
                        reports={reportList}
                        currentWeekStart={currentReport?.week_start ?? null}
                        onSelect={loadReport}
                        onClose={() => setIsHistoryOpen(false)}
                      />
                    )}
                  </AnimatePresence>
                </div>
              )}
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className={`
                  flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer
                  ${isGenerating
                    ? "bg-blue-50 dark:bg-blue-500/10 text-blue-400 cursor-not-allowed"
                    : "bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:opacity-80 shadow-sm"
                  }
                `}
              >
                {isGenerating ? (
                  <>
                    <LoadingSpinner />
                    生成中
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                    生成
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content area ── */}
      <div className="px-3 pb-4">
        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-3 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-xs text-red-600 dark:text-red-400 flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              {error}
              <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600 cursor-pointer">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {isGenerating && !currentReport && <GeneratingState />}
        {!isGenerating && !currentReport && <EmptyState onGenerate={handleGenerate} />}
        {currentReport && (
          <CardGridLayout
            report={currentReport}
            filterMode={filterMode}
            onFilterChange={setFilterMode}
            weekContents={weekContents}
          />
        )}
      </div>
    </div>
  );
}

/* ================================================================
   MASTER-DETAIL LAYOUT

   Top: Dashboard cards (Stats + Rankings)
   Middle: Single-column ranked list of sections (one-line summaries)
   Detail: Full-width slide-in panel on section click
           → AI advice + agree/disagree feedback
           → Event description
           → Related captured content
   ================================================================ */

function CardGridLayout({
  report,
  filterMode,
  onFilterChange,
  weekContents,
}: {
  report: WeeklyReport;
  filterMode: FilterMode;
  onFilterChange: (f: FilterMode) => void;
  weekContents: CapturedContent[];
}) {
  // Sort all sections by importance (relevance_score descending)
  const rankedSections = useMemo(() => {
    return [...report.sections].sort(
      (a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
    );
  }, [report.sections]);

  const filteredContents = useMemo(() => {
    if (filterMode === "all") return [];
    return weekContents.filter((c) => c.content_type === filterMode);
  }, [weekContents, filterMode]);

  // Detail panel state
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);

  const selectedSection = useMemo(
    () => rankedSections.find((s) => s.id === selectedSectionId) ?? null,
    [rankedSections, selectedSectionId]
  );

  const selectedContentItems = useMemo(() => {
    if (!selectedSection) return [];
    const idSet = new Set(selectedSection.content_ids);
    return weekContents.filter((c) => idSet.has(c.id));
  }, [selectedSection, weekContents]);

  return (
    <motion.div
      key={report.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="space-y-3"
    >
      {/* ── Filter tabs ── */}
      <ReportSummaryCard
        report={report}
        activeFilter={filterMode}
        onFilterChange={onFilterChange}
      />

      {/* ── Content switches by filter ── */}
      <AnimatePresence mode="wait">
        {filterMode === "all" ? (
          <motion.div
            key="grid"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            {/* ── Top 2-card dashboard: Stats + Rankings ── */}
            <div className="grid grid-cols-2 gap-2.5 mb-2.5">
              <StatsCard report={report} />
              <RankingCard
                sections={report.sections}
                onSelectSection={(id) => setSelectedSectionId(id)}
              />
            </div>

            {/* AI summary */}
            {report.summary_text && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.05 }}
                className="text-[13px] font-medium leading-relaxed text-gray-500 dark:text-slate-400 mb-2.5"
              >
                {report.summary_text}
              </motion.p>
            )}

            {/* ── Ranked section list ── */}
            <div className="space-y-1">
              {rankedSections.map((section, i) => (
                <SectionListItem
                  key={section.id}
                  section={section}
                  index={i}
                  isSelected={section.id === selectedSectionId}
                  onClick={() => setSelectedSectionId(
                    section.id === selectedSectionId ? null : section.id
                  )}
                />
              ))}
            </div>
          </motion.div>
        ) : filterMode === "image" ? (
          <motion.div
            key="image-view"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <ImageFilmstrip items={filteredContents} />
          </motion.div>
        ) : filterMode === "url" ? (
          <motion.div
            key="url-view"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <CompactLinkList items={filteredContents} />
          </motion.div>
        ) : (
          <motion.div
            key="text-view"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <TextContentList items={filteredContents} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <p className="text-center text-[10px] text-gray-300 dark:text-slate-600 py-2">
        {report.content_count} 条内容 · {report.sections.length} 项分析
      </p>

      {/* Detail Panel — rendered via Portal to escape parent transform context */}
      {createPortal(
        <AnimatePresence>
          {selectedSection && (
            <SectionDetailPanel
              section={selectedSection}
              contentItems={selectedContentItems}
              onClose={() => setSelectedSectionId(null)}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </motion.div>
  );
}

/* ================================================================
   SECTION LIST ITEM — one row in the ranked list.
   Shows rank indicator, type badge, title (one line).
   ================================================================ */

const DEFAULT_THEME = SECTION_THEME.routine;

function SectionListItem({
  section,
  index,
  isSelected,
  onClick,
}: {
  section: ReportSection;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const theme = SECTION_THEME[section.section_type] || DEFAULT_THEME;
  const score = section.relevance_score ?? 0;

  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      onClick={onClick}
      className={`
        w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all duration-150 cursor-pointer
        ${isSelected
          ? "glass shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)]"
          : "hover:bg-white/60 dark:hover:bg-slate-800/40"
        }
      `}
    >
      {/* Type indicator dot */}
      <div className={`w-6 h-6 rounded-lg ${theme.accent} flex items-center justify-center flex-shrink-0`}>
        <svg className={`w-3 h-3 ${theme.accentText}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={theme.iconPath} />
        </svg>
      </div>

      {/* Title — one line */}
      <div className="flex-1 min-w-0">
        <p className={`text-[13px] font-medium leading-snug truncate ${
          isSelected
            ? "text-gray-900 dark:text-gray-100"
            : "text-gray-700 dark:text-gray-300"
        }`}>
          {section.title}
        </p>
        {/* One-line body excerpt */}
        <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate mt-0.5">
          {section.body.slice(0, 60)}
          {section.body.length > 60 ? "..." : ""}
        </p>
      </div>

      {/* Score bar — subtle importance indicator */}
      {score > 0 && (
        <div className="flex-shrink-0 w-8 h-1 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
          <div
            className={`h-full rounded-full ${
              score >= 0.8 ? "bg-red-400 dark:bg-red-500" :
              score >= 0.5 ? "bg-blue-400 dark:bg-blue-500" :
              "bg-gray-300 dark:bg-slate-500"
            }`}
            style={{ width: `${Math.round(score * 100)}%` }}
          />
        </div>
      )}

      {/* Arrow indicator */}
      <svg
        className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200 ${
          isSelected ? "rotate-90 text-gray-500 dark:text-slate-400" : "text-gray-300 dark:text-slate-600"
        }`}
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
    </motion.button>
  );
}

/* ================================================================
   SECTION DETAIL PANEL — full-screen slide-in overlay.

   Structure:
   1. AI advice / recommendation for this topic
   2. Agree / Disagree feedback buttons
   3. Description summary of the event
   4. Related captured content items
   ================================================================ */

function SectionDetailPanel({
  section,
  contentItems,
  onClose,
}: {
  section: ReportSection;
  contentItems: CapturedContent[];
  onClose: () => void;
}) {
  const theme = SECTION_THEME[section.section_type] || DEFAULT_THEME;
  const [feedbackGiven, setFeedbackGiven] = useState<FeedbackType | null>(null);

  // Close on Escape + lock background scroll
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const handleFeedback = async (type: FeedbackType) => {
    try {
      await submitFeedback(null, section.id, type);
      setFeedbackGiven(type);
    } catch (e) {
      console.error("Failed to submit feedback:", e);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

      {/* Panel — slides from right */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="relative ml-auto w-full max-w-[400px] h-full glass-elevated overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex-shrink-0 px-4 pt-4 pb-3 glass border-b ">
          <div className="flex items-start gap-3">
            {/* Back button */}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center
                         text-gray-400 dark:text-slate-500 hover:bg-gray-200 dark:hover:bg-slate-600
                         transition-colors cursor-pointer flex-shrink-0 mt-0.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>

            <div className="flex-1 min-w-0">
              {/* Type badge */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className={`w-5 h-5 rounded-md ${theme.accent} flex items-center justify-center`}>
                  <svg className={`w-2.5 h-2.5 ${theme.accentText}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={theme.iconPath} />
                  </svg>
                </div>
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${theme.accentText}`}>
                  {theme.keyword}
                </span>
              </div>

              {/* Title */}
              <h2 className="text-[16px] font-bold text-gray-900 dark:text-gray-50 leading-snug">
                {section.title}
              </h2>
            </div>
          </div>
        </div>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto">
          {/* ── AI Advice Section ── */}
          <div className="px-4 py-4">
            <div className="flex items-center gap-1.5 mb-2">
              <svg className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
              </svg>
              <span className="text-[12px] font-bold text-gray-800 dark:text-gray-200">
                AI 建议
              </span>
            </div>

            <div className="rounded-xl bg-emerald-50/50 dark:bg-emerald-500/5 border border-emerald-100 dark:border-emerald-500/10 p-3">
              <p className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">
                {section.body}
              </p>
            </div>

            {/* ── Feedback buttons ── */}
            <div className="flex items-center gap-2 mt-3">
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mr-1">这个分析有用吗？</p>
              <FeedbackButton
                type="interested"
                icon="👍"
                label="赞同"
                isActive={feedbackGiven === "interested"}
                isDisabled={feedbackGiven !== null && feedbackGiven !== "interested"}
                onClick={() => handleFeedback("interested")}
              />
              <FeedbackButton
                type="dismissed"
                icon="👎"
                label="不赞同"
                isActive={feedbackGiven === "dismissed"}
                isDisabled={feedbackGiven !== null && feedbackGiven !== "dismissed"}
                onClick={() => handleFeedback("dismissed")}
              />
              <FeedbackButton
                type="bookmarked"
                icon="⭐"
                label="收藏"
                isActive={feedbackGiven === "bookmarked"}
                isDisabled={feedbackGiven !== null && feedbackGiven !== "bookmarked"}
                onClick={() => handleFeedback("bookmarked")}
              />
            </div>
          </div>

          {/* ── Divider ── */}
          <div className="mx-4 h-px bg-gray-100 dark:bg-slate-800" />

          {/* ── Related content items ── */}
          {contentItems.length > 0 && (
            <div className="px-4 py-4">
              <div className="flex items-center gap-1.5 mb-2.5">
                <svg className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <span className="text-[12px] font-bold text-gray-800 dark:text-gray-200">
                  相关内容
                </span>
                <span className="text-[11px] text-gray-400 dark:text-slate-500">
                  {contentItems.length} 条
                </span>
              </div>

              <div className="space-y-2">
                {contentItems.map((item) => (
                  <DetailContentItem key={item.id} content={item} />
                ))}
              </div>
            </div>
          )}

          {contentItems.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-[12px] text-gray-300 dark:text-slate-600">暂无关联内容</p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── Feedback Button ── */

function FeedbackButton({
  icon,
  label,
  isActive,
  isDisabled,
  onClick,
}: {
  type: FeedbackType;
  icon: string;
  label: string;
  isActive: boolean;
  isDisabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={`
        flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-150 cursor-pointer
        ${isActive
          ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-500/20"
          : isDisabled
            ? "bg-gray-50 dark:bg-slate-800 text-gray-300 dark:text-slate-600 cursor-not-allowed"
            : "glass text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 shadow-sm"
        }
      `}
    >
      <span className="text-[13px]">{icon}</span>
      {label}
    </button>
  );
}

/* ── Detail Content Item — shown inside detail panel ── */

function DetailContentItem({ content }: { content: CapturedContent }) {
  const typeConfig: Record<string, { icon: string; label: string }> = {
    image: { icon: "🖼️", label: "图片" },
    url: { icon: "🔗", label: "链接" },
    text: { icon: "📝", label: "文本" },
    mixed: { icon: "📎", label: "混合" },
  };
  const { icon, label } = typeConfig[content.content_type] || typeConfig.text;

  const isUrl = content.content_type === "url";
  const hasSourceUrl = isUrl && !!content.source_url;
  const hasFetchedText = hasSourceUrl && content.raw_text !== content.source_url;

  const imageSrc =
    content.content_type === "image"
      ? content.thumbnail_path
        ? convertFileSrc(content.thumbnail_path)
        : content.image_path
          ? convertFileSrc(content.image_path)
          : null
      : null;

  const timeStr = (() => {
    const d = new Date(content.captured_at);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  })();

  return (
    <div className="rounded-xl glass p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.15)]">
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-white/40 dark:bg-white/[0.04] flex items-center justify-center flex-shrink-0 shadow-sm">
          <span className="text-sm">{icon}</span>
        </div>

        <div className="flex-1 min-w-0">
          {/* Image */}
          {imageSrc && (
            <img
              src={imageSrc}
              alt="Preview"
              className="max-w-full max-h-40 rounded-lg object-cover mb-2 border border-gray-200 dark:border-slate-600"
              loading="lazy"
            />
          )}

          {/* URL with fetched text */}
          {isUrl && hasFetchedText && (
            <>
              <p className="text-[13px] text-gray-700 dark:text-gray-200 leading-relaxed line-clamp-4">
                {content.raw_text}
              </p>
              <a
                href={content.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1.5 text-[11px] text-blue-500 hover:text-blue-600 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                {(() => { try { return new URL(content.source_url!).hostname.replace(/^www\./, ""); } catch { return content.source_url; } })()}
              </a>
            </>
          )}

          {/* URL without fetched text */}
          {isUrl && !hasFetchedText && content.source_url && (
            <a
              href={content.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-blue-500 hover:text-blue-600 break-all transition-colors"
            >
              {content.source_url}
            </a>
          )}

          {/* Plain text */}
          {!isUrl && content.raw_text && (
            <p className="text-[13px] text-gray-700 dark:text-gray-200 leading-relaxed line-clamp-6">
              {content.raw_text}
            </p>
          )}

          {/* Meta footer */}
          <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-400 dark:text-slate-500">
            <span>{timeStr}</span>
            <span>·</span>
            <span>{content.source_app}</span>
            <span>·</span>
            <span>{label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   STATS CARD — Left dashboard card.
   Big total number, mini sparkline, type breakdown.
   ================================================================ */

function StatsCard({ report }: { report: WeeklyReport }) {
  const stats = report.report_json?.stats;
  if (!stats) return <div className="rounded-2xl glass p-4" />;

  const maxCount = Math.max(...stats.daily_counts, 1);
  const typeCounts = stats.type_counts ?? { text: 0, url: 0, image: 0 };
  const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="rounded-2xl glass
                 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]
                 dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)]
                 p-3.5 flex flex-col justify-between"
    >
      {/* Header */}
      <p className="text-[10px] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wider">
        本周数据
      </p>

      {/* Big number */}
      <div className="mt-1.5">
        <span className="text-[28px] font-black text-gray-900 dark:text-gray-50 leading-none tracking-tight">
          {stats.total_items}
        </span>
        <span className="text-[11px] text-gray-400 dark:text-slate-500 ml-1">条内容</span>
      </div>

      {/* Sparkline bar chart */}
      <div className="flex items-end gap-[3px] mt-3 h-[28px]">
        {stats.daily_counts.map((count, i) => {
          const h = count === 0 ? 2 : Math.max(4, Math.round((count / maxCount) * 28));
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
              <div
                className={`w-full rounded-sm ${
                  count === 0
                    ? "bg-gray-100 dark:bg-slate-700"
                    : "bg-gray-800 dark:bg-slate-300"
                }`}
                style={{ height: `${h}px` }}
              />
              <span className="text-[8px] text-gray-300 dark:text-slate-600 leading-none">{DAY_LABELS[i]}</span>
            </div>
          );
        })}
      </div>

      {/* Type pills */}
      <div className="flex items-center gap-1 mt-2.5">
        {typeCounts.text > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-50 dark:bg-blue-500/10 text-blue-500 dark:text-blue-400">
            {typeCounts.text} 文本
          </span>
        )}
        {typeCounts.url > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-orange-50 dark:bg-orange-500/10 text-orange-500 dark:text-orange-400">
            {typeCounts.url} 链接
          </span>
        )}
        {typeCounts.image > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-500 dark:text-amber-400">
            {typeCounts.image} 图片
          </span>
        )}
      </div>
    </motion.div>
  );
}

/* ================================================================
   RANKING CARD — Right dashboard card.
   Top 3 sections ranked by relevance_score.
   ================================================================ */

const RANK_COLORS = [
  { bg: "bg-amber-400", text: "text-white", label: "1" },
  { bg: "bg-gray-300 dark:bg-slate-500", text: "text-white", label: "2" },
  { bg: "bg-amber-700/60", text: "text-white", label: "3" },
];

function RankingCard({ sections, onSelectSection }: {
  sections: ReportSection[];
  onSelectSection: (sectionId: string) => void;
}) {
  const topSections = useMemo(() => {
    return [...sections]
      .filter((s) => s.section_type !== "recommendation" && s.section_type !== "routine")
      .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
      .slice(0, 3);
  }, [sections]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05, ease: "easeOut" }}
      className="rounded-2xl glass
                 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]
                 dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)]
                 p-3.5 flex flex-col"
    >
      {/* Header */}
      <p className="text-[10px] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wider">
        重要内容
      </p>

      {/* Ranked list */}
      <div className="flex flex-col gap-2 mt-2.5 flex-1">
        {topSections.map((section, i) => {
          const rank = RANK_COLORS[i] || RANK_COLORS[2];
          return (
            <button
              key={section.id}
              onClick={() => onSelectSection(section.id)}
              className="flex items-start gap-2 text-left group cursor-pointer"
            >
              {/* Rank badge */}
              <div className={`w-4 h-4 rounded ${rank.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                <span className={`text-[9px] font-bold ${rank.text} leading-none`}>{rank.label}</span>
              </div>
              {/* Title */}
              <p className="text-[11px] font-medium text-gray-700 dark:text-gray-200 leading-snug line-clamp-2
                            group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                {section.title}
              </p>
            </button>
          );
        })}

        {topSections.length === 0 && (
          <p className="text-[11px] text-gray-300 dark:text-slate-600 italic mt-2">暂无数据</p>
        )}
      </div>
    </motion.div>
  );
}


/* ── Empty State ── */

function EmptyState({ onGenerate }: { onGenerate: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center py-24 text-center"
    >
      <div className="w-16 h-16 rounded-2xl glass shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-gray-300 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <p className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">还没有周报</p>
      <p className="text-xs text-gray-400 dark:text-slate-500 mb-4">AI 自动分析你本周的内容</p>
      <button
        onClick={onGenerate}
        className="px-4 py-2 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-medium
                   hover:opacity-80 transition-opacity cursor-pointer shadow-sm"
      >
        开始生成
      </button>
    </motion.div>
  );
}

/* ── Generating State ── */

function GeneratingState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-24 text-center"
    >
      <div className="relative mb-5">
        <div className="w-14 h-14 rounded-2xl glass shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] flex items-center justify-center">
          <motion.svg
            className="w-6 h-6 text-gray-400 dark:text-slate-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </motion.svg>
        </div>
        <motion.div
          className="absolute -inset-2 rounded-2xl border-2 "
          animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      </div>
      <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">AI 分析中...</p>
      <p className="text-xs text-gray-400 dark:text-slate-500">需要几秒钟</p>
    </motion.div>
  );
}

/* ── History Dropdown ── */

function HistoryDropdown({
  reports,
  currentWeekStart,
  onSelect,
  onClose,
}: {
  reports: ReportSummary[];
  currentWeekStart: string | null;
  onSelect: (weekStart: string) => void;
  onClose: () => void;
}) {
  const fmtDate = (s: string) => {
    const d = new Date(s);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.97 }}
        transition={{ duration: 0.15 }}
        className="absolute right-0 top-full mt-1 w-52 glass-heavy rounded-2xl shadow-lg
                    overflow-hidden z-40"
      >
        <div className="max-h-52 overflow-y-auto">
          {reports.map((r) => {
            const active = r.week_start === currentWeekStart;
            return (
              <button
                key={r.id}
                onClick={() => onSelect(r.week_start)}
                className={`
                  w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors cursor-pointer
                  ${active ? "bg-white/40 dark:bg-white/[0.04] text-gray-900 dark:text-gray-100 font-medium" : "text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700/50"}
                `}
              >
                <span>{fmtDate(r.week_start)} - {fmtDate(r.week_end)}</span>
                <span className="text-gray-300 dark:text-slate-600 ml-auto">{r.content_count}</span>
                {active && <div className="w-1 h-1 rounded-full bg-gray-900 dark:bg-white" />}
              </button>
            );
          })}
        </div>
      </motion.div>
    </>
  );
}

/* ── Utility ── */

function LoadingSpinner() {
  return (
    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) => `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")}`;
  return `${s.getFullYear()}.${fmt(s)} - ${fmt(e)}`;
}

function formatCurrentWeekRange(): string {
  const now = new Date();
  const dow = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d: Date) => `${d.getFullYear()}.${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")}`;
  return `${fmt(mon)} - ${fmt(sun)}`;
}
