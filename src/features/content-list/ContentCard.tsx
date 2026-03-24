import { useState, useRef, useEffect, forwardRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import type { CapturedContent } from "../../types/content";
import { deleteContent, retryUrlFetch, ocrImage } from "../../services/storageService";
import { chatWithContent, getChatHistory, saveChatMessage, clearChatHistory, type ChatMessage } from "../../services/chatService";
import { useContentStore } from "../../stores/contentStore";
import { useDataHubStore } from "../../stores/dataHubStore";
import { ImagePreview } from "./ImagePreview";

interface ContentCardProps {
  content: CapturedContent;
  isHighlighted?: boolean;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffHour < 24) return `${diffHour} 小时前`;
  if (diffDay < 7) return `${diffDay} 天前`;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export const ContentCard = forwardRef<HTMLDivElement, ContentCardProps>(
  function ContentCard({ content, isHighlighted = false }, ref) {
  const removeContent = useContentStore((s) => s.removeContent);
  const removeFromDataHub = useDataHubStore((s) => s.removeContent);
  const updateContent = useContentStore((s) => s.updateContent);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleteState, setDeleteState] = useState<"idle" | "confirm" | "deleting">("idle");
  const [ocrState, setOcrState] = useState<"idle" | "running" | "done">("idle");
  const [ocrText, setOcrText] = useState<string | null>(null);

  const handleDelete = async () => {
    if (deleteState === "idle") {
      setDeleteState("confirm");
      return;
    }
    if (deleteState === "confirm") {
      setDeleteState("deleting");
      try {
        await deleteContent(content.id);
        removeContent(content.id);
        removeFromDataHub(content.id);
      } catch (e) {
        console.error("Failed to delete:", e);
        setDeleteState("idle");
      }
    }
  };

  const cancelDelete = () => {
    setDeleteState("idle");
  };

  const handleCopy = async () => {
    if (!content.raw_text) return;
    try {
      await navigator.clipboard.writeText(content.raw_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  };

  const handleOcr = async () => {
    setOcrState("running");
    try {
      const text = await ocrImage(content.id);
      setOcrText(text);
      setOcrState("done");
      // Update content in store so copy button works with OCR text
      updateContent({ ...content, raw_text: text });
    } catch (e) {
      console.error("OCR failed:", e);
      setOcrText(`识别失败: ${e}`);
      setOcrState("done");
    }
  };

  const typeConfig = {
    image: { icon: "🖼️", label: "图片", accent: "bg-amber-500/10 dark:bg-amber-500/20" },
    url: { icon: "🔗", label: "链接", accent: "bg-purple-500/10 dark:bg-purple-500/20" },
    text: { icon: "📝", label: "文本", accent: "bg-indigo-500/10 dark:bg-indigo-500/20" },
    mixed: { icon: "📎", label: "混合", accent: "bg-gray-500/10 dark:bg-gray-500/20" },
  };

  const { icon: typeIcon, label: typeLabel, accent: typeAccent } = typeConfig[content.content_type] || typeConfig.text;
  const timeStr = formatRelativeTime(content.captured_at);

  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await retryUrlFetch(content.id);
    } catch (e) {
      console.error("Retry failed:", e);
    }
    // Don't reset retrying — the list will reload when content:url-fetched fires
  };

  // URL content states
  const isUrlContent = content.content_type === "url";
  const hasSourceUrl = isUrlContent && !!content.source_url;
  // Check if URL fetch failed (raw_text starts with [读取失败])
  const isFailedUrl = hasSourceUrl && content.raw_text?.startsWith("[读取失败]");
  // raw_text 明显长于 source_url 才认为已读取内容
  const isFetchedUrl = hasSourceUrl && !isFailedUrl && content.raw_text &&
    content.raw_text.length > (content.source_url?.length || 0) + 50;
  const isLoadingUrl = hasSourceUrl && !isFetchedUrl && !isFailedUrl;

  const imageSrc =
    content.content_type === "image"
      ? content.thumbnail_path
        ? convertFileSrc(content.thumbnail_path)
        : content.image_path
          ? convertFileSrc(content.image_path)
          : null
      : null;

  const fullImageSrc =
    content.content_type === "image" && content.image_path
      ? convertFileSrc(content.image_path)
      : null;

  return (
    <>
      <div
        ref={ref}
        className={`
        group rounded-2xl transition-all duration-300
        ${isHighlighted
          ? "ring-2 ring-indigo-300/60 dark:ring-indigo-500/30 animate-highlight-fade"
          : deleteState !== "idle"
            ? "ring-1 ring-red-200/80 dark:ring-red-500/30"
            : "hover:translate-y-[-1px] hover:shadow-[0_12px_40px_rgba(99,102,241,0.12)] dark:hover:shadow-[0_12px_40px_rgba(0,0,0,0.3)]"
        }
        glass
      `}>
        {/* Main content area */}
        <div className="p-4">
          <div className="flex items-start gap-3">
            {/* Type icon */}
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors duration-300 ${typeAccent} backdrop-blur-sm`}>
              <span className="text-base">{typeIcon}</span>
            </div>

            {/* Content body */}
            <div className="min-w-0 flex-1">
              {/* Image thumbnail + OCR side by side */}
              {imageSrc && (
                <div className="mb-2.5 flex gap-3 items-start">
                  {/* Left: image */}
                  <div
                    className="cursor-pointer group/img flex-shrink-0"
                    onClick={() => setPreviewOpen(true)}
                  >
                    <img
                      src={imageSrc}
                      alt="Captured"
                      className="w-40 max-h-36 rounded-xl border border-white/50 dark:border-white/10
                                 group-hover/img:border-indigo-300/60 dark:group-hover/img:border-indigo-500/40
                                 group-hover/img:shadow-md transition-all object-cover"
                      loading="lazy"
                    />
                    <span className="text-[11px] text-gray-400 dark:text-slate-500
                                     group-hover/img:text-indigo-500 dark:group-hover/img:text-indigo-400 transition-colors mt-1 block">
                      点击查看大图
                    </span>
                  </div>

                  {/* Right: OCR result */}
                  {content.content_type === "image" && (content.raw_text || ocrText) && (
                    <div
                      className="flex-1 min-w-0 px-2.5 py-2 rounded-lg cursor-pointer
                                    bg-amber-500/[0.06] dark:bg-amber-500/[0.08]
                                    border border-amber-200/40 dark:border-amber-500/15
                                    hover:bg-amber-500/[0.12] dark:hover:bg-amber-500/[0.15]
                                    transition-colors duration-150"
                      onClick={() => setTextExpanded(true)}
                      title="点击查看完整文字并与 AI 对话"
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">识别文字</span>
                        <span className="text-[10px] text-amber-500/60 dark:text-amber-400/50">点击展开</span>
                      </div>
                      <p className="text-xs text-gray-700 dark:text-gray-200 leading-relaxed line-clamp-8 whitespace-pre-wrap">
                        {ocrText || content.raw_text}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* OCR loading indicator for images */}
              {content.content_type === "image" && !content.raw_text && !ocrText && ocrState === "running" && (
                <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-500 dark:text-amber-400">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  正在识别文字...
                </div>
              )}

              {/* URL content: three states */}
              {isUrlContent && isFetchedUrl && (
                <div>
                  <div
                    className="cursor-pointer group/text"
                    onClick={() => setTextExpanded(true)}
                  >
                    <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed line-clamp-4">
                      {content.raw_text}
                    </p>
                    <span className="text-[11px] text-gray-400 dark:text-slate-500
                                     group-hover/text:text-indigo-500 dark:group-hover/text:text-indigo-400
                                     transition-colors mt-1 inline-block">
                      点击查看全文
                    </span>
                  </div>
                  <button
                    onClick={() => content.source_url && open(content.source_url)}
                    className="inline-flex items-center gap-1 mt-1 text-xs text-indigo-500 dark:text-indigo-400 hover:underline"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    打开原文
                  </button>
                </div>
              )}

              {isUrlContent && isLoadingUrl && (
                <div className="flex items-center gap-2">
                  <p className="text-sm text-indigo-500 dark:text-indigo-400 truncate flex-1">
                    {content.source_url}
                  </p>
                  <span className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-slate-500 flex-shrink-0">
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    读取中
                  </span>
                </div>
              )}

              {isUrlContent && isFailedUrl && (
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs text-red-500 dark:text-red-400 font-medium">读取失败</span>
                    <button
                      onClick={handleRetry}
                      disabled={retrying}
                      className="inline-flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400
                                 hover:text-indigo-600 dark:hover:text-indigo-300
                                 disabled:opacity-50 transition-colors"
                    >
                      <svg className={`w-3 h-3 ${retrying ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {retrying ? "重试中..." : "重试"}
                    </button>
                  </div>
                  <p className="text-sm text-indigo-500 dark:text-indigo-400 truncate">
                    {content.source_url}
                  </p>
                </div>
              )}

              {/* Non-URL, non-image text content */}
              {!isUrlContent && content.content_type !== "image" && content.raw_text && (
                <div
                  className="cursor-pointer group/text"
                  onClick={() => setTextExpanded(true)}
                >
                  <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed line-clamp-4" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                    {content.raw_text}
                  </p>
                  <span className="text-[11px] text-gray-400 dark:text-slate-500
                                   group-hover/text:text-indigo-500 dark:group-hover/text:text-indigo-400
                                   transition-colors mt-1 inline-block">
                    点击展开 · AI 对话
                  </span>
                </div>
              )}

              {/* No content fallback */}
              {!imageSrc && !content.raw_text && !isUrlContent && (
                <p className="text-sm text-gray-400 dark:text-slate-500 italic">无内容</p>
              )}

              {/* User note / memo */}
              {content.user_note && (
                <div className="mt-2 flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg
                                bg-indigo-500/[0.06] dark:bg-indigo-500/[0.08]
                                border border-indigo-200/40 dark:border-indigo-500/15">
                  <span className="text-xs leading-none mt-0.5">💬</span>
                  <span className="text-xs text-indigo-600 dark:text-indigo-300 leading-relaxed">
                    {content.user_note}
                  </span>
                </div>
              )}

              {/* Footer: meta + actions */}
              <div className="flex items-center justify-between mt-2.5">
                <div className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-slate-500">
                  <span>{timeStr}</span>
                  <span className="text-gray-300/80 dark:text-slate-600">·</span>
                  <span>{content.source_app}</span>
                  <span className="text-gray-300/80 dark:text-slate-600">·</span>
                  <span>{typeLabel}</span>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1">
                  {/* AI Chat button — for text and image content with text */}
                  {!isUrlContent && (content.raw_text || ocrText) && (
                    <button
                      onClick={() => setTextExpanded(true)}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium
                                 text-gray-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400
                                 hover:bg-emerald-500/10 dark:hover:bg-emerald-500/15 transition-all"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                      </svg>
                      AI 对话
                    </button>
                  )}
                  {/* OCR button — only shown if auto-OCR didn't run (fallback) */}
                  {content.content_type === "image" && !content.raw_text && !ocrText && ocrState === "idle" && (
                    <button
                      onClick={handleOcr}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium
                                 text-gray-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400
                                 hover:bg-amber-500/10 dark:hover:bg-amber-500/15 transition-all"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      识别文字
                    </button>
                  )}
                  {hasSourceUrl && (
                    <button
                      onClick={() => content.source_url && open(content.source_url)}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium
                                 text-gray-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400
                                 hover:bg-indigo-500/10 dark:hover:bg-indigo-500/15 transition-all"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                      打开链接
                    </button>
                  )}
                  {content.raw_text && (
                    <button
                      onClick={handleCopy}
                      className={`
                        flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all
                        ${copied
                          ? "bg-green-500/10 dark:bg-green-500/15 text-green-600 dark:text-green-400"
                          : "text-gray-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-500/10 dark:hover:bg-indigo-500/15"
                        }
                      `}
                    >
                      {copied ? (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          已复制
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                          </svg>
                          复制
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={handleDelete}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium
                               text-gray-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400
                               hover:bg-red-500/10 dark:hover:bg-red-500/15 transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                    删除
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Delete confirmation bar */}
        {deleteState !== "idle" && (
          <div className="px-4 py-3 bg-red-500/5 dark:bg-red-500/[0.03] border-t border-red-200/40 dark:border-red-500/10 rounded-b-2xl
                          flex items-center justify-between">
            <span className="text-sm text-red-600 dark:text-red-400 font-medium">
              {deleteState === "deleting" ? "正在删除..." : "确定要删除这条内容吗？"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={cancelDelete}
                disabled={deleteState === "deleting"}
                className="px-3 py-1.5 text-xs font-medium rounded-lg
                           text-gray-600 dark:text-slate-300 bg-white/80 dark:bg-white/[0.08]
                           border border-white/60 dark:border-white/[0.1]
                           hover:bg-white dark:hover:bg-white/[0.12] transition-colors
                           disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteState === "deleting"}
                className="px-3 py-1.5 text-xs font-medium rounded-lg
                           text-white bg-red-500 hover:bg-red-600
                           disabled:opacity-50 transition-colors"
              >
                {deleteState === "deleting" ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        )}
      </div>

      {previewOpen && fullImageSrc && (
        <ImagePreview
          src={fullImageSrc}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {/* Full text overlay — portal to body to escape overflow-hidden */}
      {createPortal(
        <AnimatePresence>
          {textExpanded && (content.raw_text || ocrText || fullImageSrc) && (
            <FullTextOverlay
              content={content}
              copied={copied}
              onCopy={handleCopy}
              onClose={() => setTextExpanded(false)}
              imageSrc={fullImageSrc}
              ocrText={ocrText}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
});

/* ================================================================
   AUTO-FORMAT — turn plain text into styled paragraphs
   ================================================================ */
function FormattedText({ text }: { text: string }) {
  // Split into paragraphs by double newlines or single newlines
  const paragraphs = text.split(/\n{2,}/);

  return (
    <div className="space-y-4" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
      {paragraphs.map((para, i) => {
        const trimmed = para.trim();
        if (!trimmed) return null;

        // Detect heading-like lines: starts with # or is short + bold-looking
        if (/^#{1,3}\s+/.test(trimmed)) {
          const level = (trimmed.match(/^(#+)/))?.[1]?.length || 1;
          const headingText = trimmed.replace(/^#{1,3}\s+/, "");
          const cls = level === 1
            ? "text-lg font-bold text-gray-900 dark:text-gray-100 mt-2"
            : level === 2
            ? "text-base font-semibold text-gray-800 dark:text-gray-200 mt-1"
            : "text-sm font-semibold text-gray-700 dark:text-gray-300";
          return <h3 key={i} className={cls}>{headingText}</h3>;
        }

        // Short standalone lines (< 30 chars, no punctuation at end) → treat as sub-heading
        if (trimmed.length < 40 && !trimmed.endsWith("。") && !trimmed.endsWith("，") && !trimmed.endsWith(".") && !trimmed.endsWith(",") && !trimmed.includes("\n")) {
          return (
            <h4 key={i} className="text-[15px] font-semibold text-gray-800 dark:text-gray-200 mt-1">
              {trimmed}
            </h4>
          );
        }

        // Multi-line paragraph: split by single newlines and render with line breaks
        const lines = trimmed.split("\n");

        // Check if it looks like a list (lines starting with - or • or number.)
        const isList = lines.length > 1 && lines.every(l => /^\s*[-•·]\s|^\s*\d+[.)、]\s/.test(l.trim()) || !l.trim());
        if (isList) {
          return (
            <ul key={i} className="space-y-1.5 pl-1">
              {lines.filter(l => l.trim()).map((line, j) => (
                <li key={j} className="flex gap-2 text-[14px] text-gray-700 dark:text-gray-200 leading-relaxed">
                  <span className="text-indigo-400 dark:text-indigo-500 flex-shrink-0 mt-1">•</span>
                  <span>{line.replace(/^\s*[-•·]\s*|^\s*\d+[.)、]\s*/, "")}</span>
                </li>
              ))}
            </ul>
          );
        }

        // Regular paragraph
        return (
          <p key={i} className="text-[14px] text-gray-700 dark:text-gray-200 leading-[1.85]">
            {lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/* ================================================================
   FULL TEXT OVERLAY — with optional AI chat split panel
   ================================================================ */

function FullTextOverlay({
  content,
  copied,
  onCopy,
  onClose,
  imageSrc,
  ocrText,
}: {
  content: CapturedContent;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
  imageSrc?: string | null;
  ocrText?: string | null;
}) {
  const isImage = content.content_type === "image";
  const isUrl = content.content_type === "url";
  // For images, prefer ocrText over content.raw_text
  const displayText = isImage ? (ocrText || content.raw_text) : content.raw_text;
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load chat history from database when chat opens
  useEffect(() => {
    if (chatOpen && !historyLoaded) {
      getChatHistory(content.id).then((history) => {
        if (history.length > 0) {
          setMessages(history);
        }
        setHistoryLoaded(true);
      }).catch((e) => {
        console.error("Failed to load chat history:", e);
        setHistoryLoaded(true);
      });
    }
  }, [chatOpen, historyLoaded, content.id]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (chatOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [chatOpen]);

  // Lock background scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const handleSend = async (text?: string) => {
    const input = (text ?? inputValue).trim();
    if (!input || isLoading || !displayText) return;

    const userMsg: ChatMessage = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsLoading(true);

    // Save user message to database
    saveChatMessage(content.id, "user", input).catch(console.error);

    try {
      const reply = await chatWithContent(displayText, messages, input);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      // Save AI reply to database
      saveChatMessage(content.id, "assistant", reply).catch(console.error);
    } catch (e) {
      const errorMsg = `AI 回复失败: ${e}`;
      setMessages((prev) => [...prev, { role: "assistant", content: errorMsg }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickQuestions = isImage
    ? ["描述这张图片的内容", "提取图片中的关键信息", "总结图片传达的要点"]
    : ["总结这篇文章的要点", "这篇文章的核心观点是什么？", "提取关键信息"];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
      {/* Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        layout
        className={`relative rounded-2xl overflow-hidden glass-elevated flex flex-col
                    ${chatOpen ? "w-full max-w-5xl" : "w-full max-w-2xl"} max-h-[85vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top accent line */}
        <div className="absolute inset-x-0 top-0 h-[2px] z-10"
          style={{ background: "linear-gradient(90deg, transparent, rgba(99,102,241,0.4) 30%, rgba(168,85,247,0.5) 50%, rgba(99,102,241,0.4) 70%, transparent)" }}
        />
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center flex-shrink-0 border
              ${isImage
                ? "from-amber-500/15 to-orange-500/15 dark:from-amber-500/20 dark:to-orange-500/20 border-amber-200/30 dark:border-amber-500/15"
                : isUrl
                  ? "from-indigo-500/15 to-purple-500/15 dark:from-indigo-500/20 dark:to-purple-500/20 border-indigo-200/30 dark:border-indigo-500/15"
                  : "from-blue-500/15 to-indigo-500/15 dark:from-blue-500/20 dark:to-indigo-500/20 border-blue-200/30 dark:border-blue-500/15"
              }`}>
              <span className="text-base">{isImage ? "🖼️" : isUrl ? "🔗" : "📝"}</span>
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-gray-800 dark:text-gray-100 truncate">
                {content.raw_text?.split("\n")[0]?.slice(0, 60) || (isImage ? "图片内容" : "内容详情")}
              </div>
              <div className="text-[11px] text-gray-400 dark:text-slate-500 truncate mt-0.5">
                {content.source_url || `${content.source_app} · ${content.content_type}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
            {/* AI Chat toggle */}
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`h-8 px-3 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5
                ${chatOpen
                  ? "bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "text-gray-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-500/8 dark:hover:bg-emerald-500/10"
                }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
              AI 对话
            </button>
            {content.source_url && (
              <button
                onClick={() => open(content.source_url!)}
                className="h-8 px-3 rounded-xl text-xs font-medium transition-all
                           text-gray-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400
                           hover:bg-indigo-500/8 dark:hover:bg-indigo-500/10
                           flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
                原文
              </button>
            )}
            <button
              onClick={onCopy}
              className={`h-8 px-3 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5
                ${copied
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "text-gray-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-500/8 dark:hover:bg-indigo-500/10"
                }`}
            >
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  已复制
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                  </svg>
                  复制
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl flex items-center justify-center
                         text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300
                         hover:bg-gray-500/8 dark:hover:bg-white/[0.08] transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {/* Divider */}
        <div className="mx-6 h-[1px] bg-gradient-to-r from-transparent via-gray-200/80 dark:via-white/[0.06] to-transparent flex-shrink-0" />

        {/* Body — split layout when chat is open */}
        <div className={`flex-1 min-h-0 flex ${chatOpen ? "flex-row" : "flex-col"}`}>
          {/* Content panel (left side) */}
          <div className={`overflow-y-auto ${chatOpen ? "w-[55%] border-r border-gray-200/40 dark:border-white/[0.06]" : "w-full"}`}>
            <div className="px-6 py-5">
              {/* Image display */}
              {isImage && imageSrc && (
                <div className="mb-4 flex justify-center">
                  <img
                    src={imageSrc}
                    alt="Captured"
                    className="max-w-full max-h-[50vh] rounded-xl border border-white/50 dark:border-white/10 object-contain"
                  />
                </div>
              )}
              {/* Text content — auto-formatted */}
              {displayText && (
                <article className="selection:bg-indigo-500/20 dark:selection:bg-indigo-500/30 overflow-hidden">
                  {isImage && (
                    <div className="flex items-center gap-1.5 mb-3">
                      <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium px-2 py-0.5 rounded-md bg-amber-500/10">识别文字</span>
                    </div>
                  )}
                  <FormattedText text={displayText} />
                </article>
              )}
              {/* No text fallback for images */}
              {isImage && !displayText && (
                <p className="text-sm text-gray-400 dark:text-slate-500 italic text-center">
                  暂无识别文字
                </p>
              )}
            </div>
          </div>

          {/* AI Chat panel */}
          <AnimatePresence>
            {chatOpen && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "45%", opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="flex flex-col min-w-0 overflow-hidden"
              >
                {/* Chat header with clear button */}
                {messages.length > 0 && (
                  <div className="flex items-center justify-between px-4 pt-3 pb-1 flex-shrink-0">
                    <span className="text-[11px] text-gray-400 dark:text-slate-500">
                      {messages.length} 条对话
                    </span>
                    <button
                      onClick={async () => {
                        await clearChatHistory(content.id).catch(console.error);
                        setMessages([]);
                      }}
                      className="text-[11px] text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                    >
                      清空记录
                    </button>
                  </div>
                )}
                {/* Chat messages */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                  {messages.length === 0 && !isLoading && (
                    <div className="flex flex-col items-center justify-center h-full text-center px-4">
                      <div className="w-12 h-12 rounded-2xl glass flex items-center justify-center mb-3">
                        <svg className="w-5 h-5 text-emerald-500 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                      </div>
                      <p className="text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1">
                        AI 阅读助手
                      </p>
                      <p className="text-[11px] text-gray-400 dark:text-slate-500 mb-4">
                        针对这篇文章提问，AI 会基于内容回答
                      </p>
                      {/* Quick questions */}
                      <div className="flex flex-col gap-1.5 w-full">
                        {quickQuestions.map((q) => (
                          <button
                            key={q}
                            onClick={() => handleSend(q)}
                            className="w-full px-3 py-2 rounded-xl glass text-left text-[12px]
                                       text-gray-600 dark:text-gray-300
                                       hover:bg-white/60 dark:hover:bg-white/[0.04]
                                       transition-colors cursor-pointer"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap
                          ${msg.role === "user"
                            ? "bg-indigo-500 text-white rounded-br-md"
                            : "glass text-gray-700 dark:text-gray-200 rounded-bl-md"
                          }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}

                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="glass px-3.5 py-2.5 rounded-2xl rounded-bl-md">
                        <div className="flex items-center gap-1.5">
                          <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-slate-500 animate-bounce [animation-delay:0ms]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-slate-500 animate-bounce [animation-delay:150ms]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-slate-500 animate-bounce [animation-delay:300ms]" />
                          </div>
                          <span className="text-[11px] text-gray-400 dark:text-slate-500 ml-1">思考中...</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input area */}
                <div className="flex-shrink-0 px-4 pb-4 pt-2">
                  <div className="flex items-end gap-2 glass rounded-xl p-2">
                    <textarea
                      ref={inputRef}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="输入你的问题..."
                      rows={1}
                      className="flex-1 bg-transparent text-[13px] text-gray-700 dark:text-gray-200
                                 placeholder:text-gray-400 dark:placeholder:text-slate-500
                                 resize-none outline-none min-h-[32px] max-h-[80px] py-1 px-1"
                      style={{ height: "auto", overflow: "auto" }}
                    />
                    <button
                      onClick={() => handleSend()}
                      disabled={!inputValue.trim() || isLoading}
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                                 bg-indigo-500 text-white hover:bg-indigo-600
                                 disabled:opacity-30 disabled:cursor-not-allowed
                                 transition-all cursor-pointer"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-300 dark:text-slate-600 mt-1.5 text-center">
                    Enter 发送 · Shift+Enter 换行
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
