import { useState, useEffect } from "react";
import { useDataHubStore } from "../../stores/dataHubStore";
import { exportAll, openExportDir } from "../../services/dataHubService";

interface ExportPanelProps {
  onClose: () => void;
}

export function ExportPanel({ onClose }: ExportPanelProps) {
  const exportDir = useDataHubStore((s) => s.exportDir);
  const loadExportDir = useDataHubStore((s) => s.loadExportDir);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<number | null>(null);

  useEffect(() => {
    loadExportDir();
  }, [loadExportDir]);

  const handleExportAll = async () => {
    setIsExporting(true);
    setExportResult(null);
    try {
      const count = await exportAll();
      setExportResult(count);
    } catch (e) {
      console.error("Failed to export all:", e);
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await openExportDir();
    } catch (e) {
      console.error("Failed to open export dir:", e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 dark:bg-black/40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative glass-elevated rounded-2xl w-full max-w-sm mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/30 dark:border-white/[0.06]">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span>📤</span>
            导出设置
          </h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg
                       text-gray-400 dark:text-slate-500 hover:bg-white/50 dark:hover:bg-white/[0.08]
                       transition-colors text-lg"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Export directory */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              导出目录
            </label>
            <div
              className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 bg-white/40 dark:bg-white/[0.04] rounded-xl
                         border border-white/50 dark:border-white/[0.06] font-mono break-all"
            >
              {exportDir || "未设置"}
            </div>
          </div>

          {/* Export all button */}
          <button
            onClick={handleExportAll}
            disabled={isExporting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border
                       bg-orange-500/10 dark:bg-orange-500/15
                       border-orange-300/60 dark:border-orange-500/30
                       text-orange-700 dark:text-orange-400
                       hover:bg-orange-500/15 dark:hover:bg-orange-500/20
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-150"
          >
            {isExporting ? (
              <>
                <span className="animate-spin">⏳</span>
                <span>导出中...</span>
              </>
            ) : (
              <>
                <span>📦</span>
                <span>导出全部</span>
              </>
            )}
          </button>

          {/* Export result */}
          {exportResult !== null && (
            <div className="px-3 py-2 rounded-xl bg-green-500/10 dark:bg-green-500/15 border border-green-300/40 dark:border-green-500/20">
              <p className="text-xs text-green-700 dark:text-green-400 text-center">
                已导出 {exportResult} 个文件
              </p>
            </div>
          )}

          {/* Open in Finder */}
          <button
            onClick={handleOpenFolder}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border
                       bg-white/50 dark:bg-white/[0.04] border-white/60 dark:border-white/[0.08]
                       text-gray-600 dark:text-slate-300
                       hover:bg-white/80 dark:hover:bg-white/[0.08]
                       transition-all duration-150"
          >
            <span>📁</span>
            <span>在 Finder 中打开</span>
          </button>
        </div>
      </div>
    </div>
  );
}
