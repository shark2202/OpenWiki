import { useState } from "react";
import { motion } from "framer-motion";
import type { ReportSection } from "../../types/report";

interface ReportCardProps {
  section: ReportSection;
  index: number;
  variant?: "feature" | "compact" | "tip";
  /** span 2 columns in grid */
  wide?: boolean;
  /** Called when user wants to view source content */
  onViewSource?: (contentIds: string[]) => void;
}

/* ---- Section type → visual theme ---- */

export const SECTION_THEME: Record<string, {
  iconPath: string;
  keyword: string;
  accent: string;
  accentText: string;
}> = {
  key_insight: {
    iconPath: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z",
    keyword: "ALERT",
    accent: "bg-red-50 dark:bg-red-500/15",
    accentText: "text-red-500 dark:text-red-400",
  },
  highlight: {
    iconPath: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z",
    keyword: "STAR",
    accent: "bg-amber-50 dark:bg-amber-500/15",
    accentText: "text-amber-500 dark:text-amber-400",
  },
  trend: {
    iconPath: "M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941",
    keyword: "TREND",
    accent: "bg-orange-500/10 dark:bg-orange-500/20",
    accentText: "text-orange-500 dark:text-orange-400",
  },
  routine: {
    iconPath: "M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z",
    keyword: "NOTE",
    accent: "bg-gray-50 dark:bg-slate-500/15",
    accentText: "text-gray-400 dark:text-slate-400",
  },
  recommendation: {
    iconPath: "M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18",
    keyword: "IDEA",
    accent: "bg-emerald-50 dark:bg-emerald-500/15",
    accentText: "text-emerald-500 dark:text-emerald-400",
  },
  topic: {
    iconPath: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z",
    keyword: "TAG",
    accent: "bg-gray-50 dark:bg-slate-500/15",
    accentText: "text-gray-400 dark:text-slate-400",
  },
};

const DEFAULT_THEME = SECTION_THEME.routine;

export function ReportCard({ section, index, variant = "feature", wide = false, onViewSource }: ReportCardProps) {
  if (variant === "tip") return <TipCard section={section} index={index} />;
  if (variant === "compact") return <CompactCard section={section} index={index} />;
  return <FeatureCard section={section} index={index} wide={wide} onViewSource={onViewSource} />;
}

/* ================================================================
   FEATURE CARD — Karma-style white card.
   ================================================================ */

function FeatureCard({ section, index, wide, onViewSource }: {
  section: ReportSection;
  index: number;
  wide: boolean;
  onViewSource?: (contentIds: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const theme = SECTION_THEME[section.section_type] || DEFAULT_THEME;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05, ease: "easeOut" }}
      className={`
        relative overflow-hidden rounded-2xl
        glass
        shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]
        dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)]
        p-4 cursor-pointer
        hover:shadow-[0_2px_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)]
        dark:hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)]
        transition-shadow duration-200
        ${wide ? "col-span-2" : ""}
      `}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Decorative icon — floating at bottom-right, inside a colored circle */}
      <div className={`absolute -bottom-3 -right-3 w-16 h-16 rounded-full ${theme.accent} flex items-center justify-center opacity-60`}>
        <svg
          className={`w-7 h-7 ${theme.accentText} opacity-60`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={theme.iconPath} />
        </svg>
      </div>

      {/* Content */}
      <div className="relative z-10 pr-8">
        <h3 className="text-[15px] font-bold text-gray-900 dark:text-gray-50 leading-snug tracking-tight">
          {section.title}
        </h3>
        <p className={`text-[12px] leading-relaxed text-gray-500 dark:text-slate-400 mt-1.5 ${expanded ? "" : "line-clamp-2"}`}>
          {section.body}
        </p>

        {/* Source link — opens preview panel */}
        {expanded && section.content_ids.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewSource?.(section.content_ids);
            }}
            className={`inline-flex items-center gap-1 mt-2.5 text-[11px] ${theme.accentText} hover:opacity-70 transition-opacity cursor-pointer`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            查看原文
          </button>
        )}
      </div>
    </motion.div>
  );
}

/* ================================================================
   COMPACT CARD — smaller, for routine items.
   ================================================================ */

function CompactCard({ section, index }: { section: ReportSection; index: number }) {
  const theme = SECTION_THEME[section.section_type] || DEFAULT_THEME;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      className="flex items-start gap-2.5 px-3 py-2 rounded-xl
                 glass
                 shadow-[0_1px_2px_rgba(0,0,0,0.03)]
                 dark:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
    >
      <div className={`w-6 h-6 rounded-lg ${theme.accent} flex items-center justify-center flex-shrink-0 mt-0.5`}>
        <svg className={`w-3 h-3 ${theme.accentText}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={theme.iconPath} />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-gray-700 dark:text-gray-200 leading-snug truncate">{section.title}</p>
        <p className="text-[11px] text-gray-400 dark:text-slate-500 line-clamp-1 mt-0.5">{section.body}</p>
      </div>
    </motion.div>
  );
}

/* ================================================================
   TIP CARD — AI recommendation.
   ================================================================ */

function TipCard({ section, index }: { section: ReportSection; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.03 }}
      className="relative overflow-hidden rounded-2xl
                 glass
                 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]
                 dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)]
                 p-4 cursor-pointer col-span-2"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-emerald-400 dark:bg-emerald-500" />

      <div className="pl-3 flex items-start gap-2">
        <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
          <svg className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{section.title}</p>
          <p className={`text-[12px] text-gray-500 dark:text-slate-400 leading-relaxed mt-0.5 ${expanded ? "" : "line-clamp-2"}`}>
            {section.body}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
