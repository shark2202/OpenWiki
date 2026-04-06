import { useMemo, useState } from "react";
import { useDataHubStore } from "../../stores/dataHubStore";
import { exportDay } from "../../services/dataHubService";
import type { CapturedContent, ContentType } from "../../types/content";
import { ContentCard } from "../content-list/ContentCard";

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

const TYPE_CONFIG: Record<
  ContentType,
  { icon: string; label: string; order: number }
> = {
  text: { icon: "📝", label: "文本", order: 0 },
  url: { icon: "🔗", label: "链接", order: 1 },
  image: { icon: "📷", label: "图片", order: 2 },
  mixed: { icon: "📎", label: "混合", order: 3 },
};

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = WEEKDAY_NAMES[d.getDay()];
  return `${month}月${day}日 星期${weekday}`;
}

interface ContentGroupProps {
  type: ContentType;
  items: CapturedContent[];
}

function ContentGroup({ type, items }: ContentGroupProps) {
  const [expanded, setExpanded] = useState(true);
  const config = TYPE_CONFIG[type];

  return (
    <div className="mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 mb-2 px-1 text-sm font-medium text-gray-700 dark:text-gray-300
                   hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
      >
        <span className="text-xs text-gray-400 dark:text-slate-500">
          {expanded ? "▼" : "►"}
        </span>
        <span>
          {config.icon} {config.label}
        </span>
        <span className="text-xs text-gray-400 dark:text-slate-500">
          ({items.length})
        </span>
      </button>

      {expanded && (
        <div className="space-y-2">
          {items.map((item) => (
            <ContentCard key={item.id} content={item} />
          ))}
        </div>
      )}
    </div>
  );
}

// Welcome / overview when no date is selected
function WelcomeView() {
  const totalDates = useDataHubStore((s) => s.totalDates);
  const totalItems = useDataHubStore((s) => s.totalItems);

  return (
    <div className="flex flex-col items-center justify-center h-full py-20">
      <div className="w-20 h-20 rounded-2xl glass flex items-center justify-center mb-6">
        <span className="text-4xl">📂</span>
      </div>
      <p className="text-lg font-medium text-gray-700 dark:text-gray-200 mb-2">
        选择左侧日期查看内容
      </p>
      <p className="text-sm text-gray-400 dark:text-slate-500 mb-8">
        浏览和管理你的所有历史数据
      </p>

      {/* Stats cards */}
      <div className="flex gap-4">
        <div className="glass rounded-2xl p-5 text-center min-w-[120px]">
          <div className="text-2xl font-bold text-orange-500">
            {totalItems}
          </div>
          <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
            总条目
          </div>
        </div>
        <div className="glass rounded-2xl p-5 text-center min-w-[120px]">
          <div className="text-2xl font-bold text-orange-500">
            {totalDates}
          </div>
          <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
            活跃天数
          </div>
        </div>
      </div>
    </div>
  );
}

export function DayDetail() {
  const selectedDate = useDataHubStore((s) => s.selectedDate);
  const dayContents = useDataHubStore((s) => s.dayContents);
  const isLoading = useDataHubStore((s) => s.isLoading);
  const [isExporting, setIsExporting] = useState(false);

  // Group contents by type
  const groupedContents = useMemo(() => {
    const groups = new Map<ContentType, CapturedContent[]>();
    for (const item of dayContents) {
      const t = item.content_type;
      if (!groups.has(t)) {
        groups.set(t, []);
      }
      groups.get(t)!.push(item);
    }

    // Sort groups by the defined order
    const sorted = Array.from(groups.entries()).sort(
      (a, b) =>
        (TYPE_CONFIG[a[0]]?.order ?? 99) - (TYPE_CONFIG[b[0]]?.order ?? 99)
    );

    return sorted;
  }, [dayContents]);

  const handleExportDay = async () => {
    if (!selectedDate) return;
    setIsExporting(true);
    try {
      await exportDay(selectedDate);
    } catch (e) {
      console.error("Failed to export:", e);
    } finally {
      setIsExporting(false);
    }
  };

  if (!selectedDate) {
    return <WelcomeView />;
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        <div className="h-8 w-48 bg-white/50 dark:bg-white/[0.06] rounded-lg animate-pulse" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass rounded-xl p-4">
            <div className="space-y-2">
              <div className="h-3 bg-gray-200/50 dark:bg-white/[0.06] rounded w-1/4 animate-pulse" />
              <div className="h-4 bg-gray-200/30 dark:bg-white/[0.04] rounded w-3/4 animate-pulse" />
              <div className="h-3 bg-gray-200/30 dark:bg-white/[0.04] rounded w-1/2 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Day header */}
      <div className="px-6 py-4 border-b border-white/30 dark:border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <span>📅</span>
              {formatDateHeader(selectedDate)}
            </h2>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
              {dayContents.length} 条内容
            </p>
          </div>
          <button
            onClick={handleExportDay}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border
                       bg-white/50 dark:bg-white/[0.04] border-white/60 dark:border-white/[0.08]
                       text-gray-600 dark:text-slate-300
                       hover:bg-white/80 dark:hover:bg-white/[0.08]
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-150"
          >
            {isExporting ? (
              <span className="animate-spin text-sm">⏳</span>
            ) : (
              <span className="text-sm">📤</span>
            )}
            <span>导出此日</span>
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-6">
        {dayContents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="text-3xl mb-3">📭</span>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              这一天没有记录的内容
            </p>
          </div>
        ) : (
          groupedContents.map(([type, items]) => (
            <ContentGroup key={type} type={type} items={items} />
          ))
        )}
      </div>
    </div>
  );
}
