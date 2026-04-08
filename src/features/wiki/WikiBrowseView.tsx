import { useEffect, useState, useCallback } from "react";
import { Search, BookOpen, User, FileText, GitCompare, Layers } from "lucide-react";
import { useWikiStore } from "../../stores/wikiStore";
import { WikiPageCard } from "./WikiPageCard";
import { WikiPageDetail } from "./WikiPageDetail";

const TYPE_FILTERS = [
  { id: null, label: "全部", icon: null },
  { id: "concept", label: "概念", icon: BookOpen },
  { id: "entity", label: "实体", icon: User },
  { id: "source", label: "来源", icon: FileText },
  { id: "comparison", label: "对比", icon: GitCompare },
  { id: "overview", label: "总览", icon: Layers },
] as const;

export function WikiBrowseView() {
  const {
    pages, selectedPage, isLoadingPages, filterType, error,
    loadPages, searchPages, selectPage, clearSelection, setFilterType, deletePage,
  } = useWikiStore();

  const [searchInput, setSearchInput] = useState("");
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  const handleSearch = useCallback((value: string) => {
    setSearchInput(value);
    if (searchTimer) clearTimeout(searchTimer);
    const timer = setTimeout(() => {
      searchPages(value);
    }, 300);
    setSearchTimer(timer);
  }, [searchPages, searchTimer]);

  const handleNavigateToContent = useCallback((contentId: string) => {
    clearSelection();
    window.dispatchEvent(
      new CustomEvent("navigate-to-content", { detail: { contentIds: [contentId] } })
    );
  }, [clearSelection]);

  return (
    <div className="flex gap-0 h-full">
      {/* Left sidebar: filters */}
      <div className="w-36 flex-shrink-0 pr-3 border-r" style={{ borderColor: "var(--color-border, #E7E5E4)" }}>
        <div className="space-y-0.5">
          {TYPE_FILTERS.map((f) => {
            const isActive = filterType === f.id;
            const Icon = f.icon;
            return (
              <button
                key={f.id ?? "all"}
                onClick={() => setFilterType(f.id ?? null)}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-colors"
                style={{
                  fontSize: 13,
                  backgroundColor: isActive ? "#FFF7ED" : "transparent",
                  color: isActive ? "#F97316" : "var(--color-text-secondary, #57534E)",
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {Icon && <Icon size={14} />}
                <span>{f.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 pl-4">
        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Loading */}
        {isLoadingPages && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!isLoadingPages && pages.length === 0 && (
          <div className="text-center py-16">
            <BookOpen size={40} className="mx-auto mb-3" style={{ color: "var(--color-text-muted)" }} />
            <p style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>
              知识库还是空的
            </p>
            <p className="mt-1" style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              捕获的内容会自动编译成知识页面，或在内容列表中点击「加入知识库」
            </p>
          </div>
        )}

        {/* Page grid */}
        {!isLoadingPages && pages.length > 0 && (
          <div className="grid grid-cols-1 gap-3">
            {pages.map((page) => (
              <WikiPageCard
                key={page.id}
                page={page}
                onClick={() => selectPage(page.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Page detail overlay */}
      {selectedPage && (
        <WikiPageDetail
          page={selectedPage}
          onClose={clearSelection}
          onDelete={(id) => { deletePage(id); clearSelection(); }}
          onNavigateToContent={handleNavigateToContent}
        />
      )}
    </div>
  );
}
