import { useDataHubStore } from "../../stores/dataHubStore";
import { openExportDir } from "../../services/dataHubService";

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDate();
  const weekday = WEEKDAY_NAMES[d.getDay()];
  return `${day}日 周${weekday}`;
}

interface DateSidebarProps {
  totalItems: number;
  totalDates: number;
  onOpenExportPanel: () => void;
}

export function DateSidebar({ totalItems, totalDates, onOpenExportPanel }: DateSidebarProps) {
  const monthGroups = useDataHubStore((s) => s.monthGroups);
  const selectedDate = useDataHubStore((s) => s.selectedDate);
  const selectDate = useDataHubStore((s) => s.selectDate);
  const toggleMonth = useDataHubStore((s) => s.toggleMonth);
  const handleOpenFolder = async () => {
    try {
      await openExportDir();
    } catch (e) {
      console.error("Failed to open export dir:", e);
    }
  };

  return (
    <div className="w-60 flex flex-col h-full border-r border-white/30 dark:border-white/[0.06]">
      {/* Stats header */}
      <div className="px-3 pt-3 pb-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">
            {totalItems} 条 · {totalDates} 天
          </span>
        </div>
      </div>

      {/* Month groups */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {monthGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="text-2xl mb-2">📭</span>
            <p className="text-xs text-gray-400 dark:text-slate-500">
              暂无数据
            </p>
          </div>
        ) : (
          monthGroups.map((group) => (
            <div key={group.month} className="mb-1">
              {/* Month header */}
              <button
                onClick={() => toggleMonth(group.month)}
                className="w-full flex items-center justify-between px-2 py-2 text-sm font-medium
                           text-gray-700 dark:text-gray-300 hover:bg-white/40 dark:hover:bg-white/[0.06]
                           rounded-lg transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400 dark:text-slate-500">
                    {group.expanded ? "▼" : "►"}
                  </span>
                  <span>{group.label}</span>
                </div>
                <span
                  className="px-1.5 py-0.5 text-[10px] rounded-full
                             bg-gray-200/60 dark:bg-white/[0.08] text-gray-500 dark:text-slate-400"
                >
                  {group.totalCount}
                </span>
              </button>

              {/* Date entries */}
              {group.expanded && (
                <div className="ml-2 space-y-0.5">
                  {group.dates.map((entry) => {
                    const isSelected = selectedDate === entry.date;
                    return (
                      <button
                        key={entry.date}
                        onClick={() => selectDate(entry.date)}
                        className={`
                          w-full flex items-center justify-between px-3 py-1.5 text-sm rounded-lg
                          transition-all duration-150
                          ${
                            isSelected
                              ? "bg-orange-500/15 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400 border border-orange-300/40 dark:border-orange-500/20"
                              : "text-gray-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-white/[0.06]"
                          }
                        `}
                      >
                        <span>{formatDateLabel(entry.date)}</span>
                        <span
                          className={`
                            px-1.5 py-0.5 text-[10px] rounded-full
                            ${
                              isSelected
                                ? "bg-orange-500/15 dark:bg-orange-500/25 text-orange-600 dark:text-orange-400"
                                : "bg-gray-200/50 dark:bg-white/[0.06] text-gray-400 dark:text-slate-500"
                            }
                          `}
                        >
                          {entry.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Bottom actions */}
      <div className="p-3 pt-2 border-t border-white/30 dark:border-white/[0.06] space-y-1.5">
        <button
          onClick={onOpenExportPanel}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-slate-300
                     hover:bg-white/50 dark:hover:bg-white/[0.06] rounded-lg transition-colors"
        >
          <span>&#x2699;&#xFE0F;</span>
          <span>导出设置</span>
        </button>
        <button
          onClick={handleOpenFolder}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-slate-300
                     hover:bg-white/50 dark:hover:bg-white/[0.06] rounded-lg transition-colors"
        >
          <span>&#x1F4C1;</span>
          <span>打开文件夹</span>
        </button>
      </div>
    </div>
  );
}
