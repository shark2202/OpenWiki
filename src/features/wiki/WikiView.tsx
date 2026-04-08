import { useState, useEffect } from "react";
import { List, Share2 } from "lucide-react";
import { useWikiStore } from "../../stores/wikiStore";
import { WikiBrowseView } from "./WikiBrowseView";
import { WikiGraphView } from "./WikiGraphView";

type SubView = "browse" | "graph";

export function WikiView() {
  const [subView, setSubView] = useState<SubView>("browse");
  const { stats, loadStats } = useWikiStore();

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  return (
    <div className="px-5 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2
            style={{
              fontSize: 20,
              fontWeight: 700,
              fontFamily: "'Cabinet Grotesk', sans-serif",
              color: "var(--color-text-primary, #1C1917)",
              letterSpacing: "-0.3px",
            }}
          >
            知识库
          </h2>
          {stats && stats.total_pages > 0 && (
            <p style={{ fontSize: 12, color: "var(--color-text-muted, #A8A29E)", marginTop: 2 }}>
              {stats.total_pages} 个知识页面 · {stats.total_edges} 个关联 · {stats.total_sources} 条来源
              {stats.needs_recompile > 0 && (
                <span className="text-amber-500"> · {stats.needs_recompile} 个待更新</span>
              )}
            </p>
          )}
        </div>

        {/* Sub-view switcher */}
        <div className="inline-flex bg-stone-100/60 dark:bg-white/[0.06] rounded-md p-0.5">
          <button
            onClick={() => setSubView("browse")}
            className={`flex items-center gap-1 px-3 py-1 text-[12px] font-medium rounded transition-all duration-200
              ${subView === "browse"
                ? "bg-white dark:bg-white/[0.15] text-orange-500 shadow-sm"
                : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
              }`}
          >
            <List size={13} />
            <span>浏览</span>
          </button>
          <button
            onClick={() => setSubView("graph")}
            className={`flex items-center gap-1 px-3 py-1 text-[12px] font-medium rounded transition-all duration-200
              ${subView === "graph"
                ? "bg-white dark:bg-white/[0.15] text-orange-500 shadow-sm"
                : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
              }`}
          >
            <Share2 size={13} />
            <span>图谱</span>
          </button>
        </div>
      </div>

      {/* Sub-view content */}
      {subView === "browse" && <WikiBrowseView />}
      {subView === "graph" && <WikiGraphView />}
    </div>
  );
}
