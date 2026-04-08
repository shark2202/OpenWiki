import { useState, useEffect, useCallback } from "react";
import { List, Share2, MessageCircle, Send, BookOpen, Loader } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useWikiStore } from "../../stores/wikiStore";
import { wikiAsk, saveAnswerAsPage } from "../../services/wikiService";
import { WikiBrowseView } from "./WikiBrowseView";
import { WikiGraphView } from "./WikiGraphView";

type SubView = "browse" | "graph";

export function WikiView() {
  const [subView, setSubView] = useState<SubView>("browse");
  const { stats, loadStats, loadPages } = useWikiStore();
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ text: string; convId: string; confidence: number; followup: string } | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [savedAsPage, setSavedAsPage] = useState(false);

  const handleAsk = useCallback(async () => {
    if (!question.trim() || isAsking) return;
    setIsAsking(true);
    setAnswer(null);
    setSavedAsPage(false);
    try {
      const result = await wikiAsk(question.trim());
      setAnswer({
        text: result.answer,
        convId: result.conversation_id,
        confidence: result.confidence,
        followup: result.suggested_followup,
      });
    } catch (e) {
      setAnswer({ text: `查询失败: ${e}`, convId: "", confidence: 0, followup: "" });
    }
    setIsAsking(false);
  }, [question, isAsking]);

  const handleSaveAsPage = useCallback(async () => {
    if (!answer?.convId || savedAsPage) return;
    try {
      await saveAnswerAsPage(answer.convId);
      setSavedAsPage(true);
      loadPages();
      loadStats();
    } catch (e) {
      console.error("Save as page failed:", e);
    }
  }, [answer, savedAsPage, loadPages, loadStats]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  return (
    <div className="relative px-5 py-4 flex flex-col" style={{ height: "calc(100vh - 44px)", overflow: subView === "graph" ? "hidden" : "auto" }}>
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

        {/* Sub-view switcher + ask button */}
        <div className="flex items-center gap-2">
        <button
          onClick={() => setAskOpen(!askOpen)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all
            ${askOpen
              ? "bg-orange-500 text-white"
              : "text-stone-400 hover:text-orange-500 hover:bg-orange-500/10"
            }`}
        >
          <MessageCircle size={13} />
          <span>提问</span>
        </button>
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
      </div>

      {/* Q&A panel — collapsible */}
      {askOpen && (
        <div className="mb-4 rounded-xl p-4" style={{
          backgroundColor: "var(--color-surface, #FFFFFF)",
          border: "1px solid var(--color-border, #E7E5E4)",
        }}>
          <div className="flex items-center gap-2 mb-3">
            <MessageCircle size={14} style={{ color: "#F97316" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>向知识库提问</span>
            <button
              onClick={() => { setAskOpen(false); setAnswer(null); setQuestion(""); }}
              className="ml-auto text-[11px] text-stone-400 hover:text-stone-600 transition-colors"
            >
              收起
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAsk(); }}
              placeholder="基于你积累的知识回答问题..."
              className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                backgroundColor: "var(--color-surface-raised, #F5F5F0)",
                border: "1px solid var(--color-border, #E7E5E4)",
                color: "var(--color-text-primary)",
              }}
            />
            <button
              onClick={handleAsk}
              disabled={isAsking || !question.trim()}
              className="px-3 py-2 rounded-lg text-white text-sm font-medium transition-all
                         disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: "#F97316" }}
            >
              {isAsking ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>

          {/* Answer */}
          {answer && (
            <div className="mt-3 p-3 rounded-lg" style={{
              backgroundColor: "var(--color-surface-raised, #F5F5F0)",
              border: "1px solid var(--color-border, #E7E5E4)",
            }}>
              <article
                className="prose prose-sm prose-stone dark:prose-invert max-w-none
                           prose-a:text-orange-500 prose-code:text-orange-600
                           prose-code:bg-orange-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                           prose-code:before:content-none prose-code:after:content-none"
                style={{ fontSize: 13, lineHeight: 1.7 }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer.text}</ReactMarkdown>
              </article>

              <div className="flex items-center justify-between mt-3 pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
                <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                  置信度 {Math.round(answer.confidence * 100)}%
                  {answer.followup && ` · 追问: ${answer.followup}`}
                </span>
                {answer.convId && (
                  <button
                    onClick={handleSaveAsPage}
                    disabled={savedAsPage}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all
                               hover:bg-orange-500/10 disabled:opacity-40"
                    style={{ color: savedAsPage ? "#16A34A" : "#F97316" }}
                  >
                    <BookOpen size={12} />
                    {savedAsPage ? "已保存为知识页面" : "保存为知识页面"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sub-view content */}
      {subView === "browse" && <WikiBrowseView />}
      {subView === "graph" && <WikiGraphView />}
    </div>
  );
}
