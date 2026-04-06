import type { ReportStats } from "../../types/report";

export type FilterMode = "all" | "text" | "url" | "image";

interface ActivityStatsCardProps {
  stats: ReportStats;
  activeFilter: FilterMode;
  onFilterChange: (filter: FilterMode) => void;
}

const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * Transparent filter tabs — no container, no background box.
 * Looks like iOS Segment Control floating on the page.
 */
export function ActivityStatsCard({ stats, activeFilter, onFilterChange }: ActivityStatsCardProps) {
  const maxCount = Math.max(...stats.daily_counts, 1);
  const typeCounts = stats.type_counts ?? { text: 0, url: 0, image: 0 };

  return (
    <div className="flex items-center gap-0.5">
      {/* Segment-style filter tabs */}
      <div className="flex items-center glass rounded-xl p-0.5">
        <SegmentTab
          label="全部"
          count={stats.total_items}
          active={activeFilter === "all"}
          onClick={() => onFilterChange("all")}
        />
        {typeCounts.text > 0 && (
          <SegmentTab
            label="文本"
            count={typeCounts.text}
            active={activeFilter === "text"}
            onClick={() => onFilterChange("text")}
            color="blue"
          />
        )}
        {typeCounts.url > 0 && (
          <SegmentTab
            label="链接"
            count={typeCounts.url}
            active={activeFilter === "url"}
            onClick={() => onFilterChange("url")}
            color="orange"
          />
        )}
        {typeCounts.image > 0 && (
          <SegmentTab
            label="图片"
            count={typeCounts.image}
            active={activeFilter === "image"}
            onClick={() => onFilterChange("image")}
            color="amber"
          />
        )}
      </div>

      {/* Mini sparkline — just a subtle line, no text */}
      <div className="flex items-end gap-[2px] ml-auto opacity-40">
        {stats.daily_counts.map((count, i) => {
          const h = count === 0 ? 1 : Math.max(2, Math.round((count / maxCount) * 12));
          return (
            <div
              key={i}
              className={`w-[2px] rounded-full ${
                count === 0
                  ? "bg-gray-300 dark:bg-slate-600"
                  : "bg-gray-500 dark:bg-slate-400"
              }`}
              style={{ height: `${h}px` }}
              title={`周${DAY_LABELS[i]}: ${count}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ---- Segment Tab — iOS-style ---- */

function SegmentTab({
  label,
  count,
  active,
  onClick,
  color,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: "blue" | "orange" | "amber";
}) {
  const activeCountColor: Record<string, string> = {
    blue: "text-orange-600 dark:text-orange-400",
    orange: "text-orange-600 dark:text-orange-400",
    amber: "text-amber-600 dark:text-amber-400",
  };

  return (
    <button
      onClick={onClick}
      className={`
        px-2 py-1 rounded-md text-[11px] font-medium transition-all duration-150 cursor-pointer select-none
        ${active
          ? "glass shadow-sm text-gray-800 dark:text-gray-100"
          : "text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"
        }
      `}
    >
      <span className={active && color ? activeCountColor[color] : ""}>{count}</span>
      <span className="ml-0.5">{label}</span>
    </button>
  );
}
