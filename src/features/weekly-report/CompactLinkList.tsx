import { motion } from "framer-motion";
import type { CapturedContent } from "../../types/content";

interface CompactLinkListProps {
  items: CapturedContent[];
}

export function CompactLinkList({ items }: CompactLinkListProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-xs text-gray-400 dark:text-slate-500">
        本周没有链接内容
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Section label */}
      <div className="flex items-center gap-1.5 px-0.5">
        <svg className="w-3 h-3 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.56a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.343 8.28" />
        </svg>
        <span className="text-[11px] font-medium text-gray-500 dark:text-slate-400">
          {items.length} 个链接
        </span>
      </div>

      {/* Link list */}
      <div className="glass rounded-2xl overflow-hidden divide-y divide-gray-50 dark:divide-slate-700/50">
        {items.map((item, idx) => (
          <LinkRow key={item.id} item={item} index={idx} />
        ))}
      </div>
    </div>
  );
}

function LinkRow({ item, index }: { item: CapturedContent; index: number }) {
  const url = item.source_url || "";
  const title = extractTitle(item);
  const domain = extractDomain(url);
  const faviconUrl = domain
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
    : null;

  return (
    <motion.a
      href={url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15, delay: index * 0.02 }}
      className="flex items-center gap-2 px-2.5 py-2 hover:bg-white/60 dark:hover:bg-white/[0.06]/50 transition-colors cursor-pointer group"
      onClick={(e) => {
        if (!url) e.preventDefault();
      }}
    >
      {/* Favicon or fallback icon */}
      <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 bg-white/40 dark:bg-white/[0.04] overflow-hidden">
        {faviconUrl ? (
          <img
            src={faviconUrl}
            alt=""
            className="w-3.5 h-3.5"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <svg className="w-2.5 h-2.5 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
        )}
      </div>

      {/* Title + domain */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-700 dark:text-gray-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {title}
        </p>
        {domain && (
          <p className="text-[10px] text-gray-400 dark:text-slate-500 truncate">
            {domain}
          </p>
        )}
      </div>

      {/* Source app + time */}
      <div className="flex-shrink-0 text-right">
        <p className="text-[10px] text-gray-400 dark:text-slate-500">
          {item.source_app}
        </p>
        <p className="text-[9px] text-gray-300 dark:text-slate-600">
          {formatTime(item.captured_at)}
        </p>
      </div>

      {/* External link icon */}
      {url && (
        <svg className="w-2.5 h-2.5 text-gray-300 dark:text-slate-600 group-hover:text-blue-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      )}
    </motion.a>
  );
}

function extractTitle(item: CapturedContent): string {
  // For URL content, raw_text often contains the page title or text
  // If raw_text is just the URL itself, use the URL
  if (item.raw_text && item.raw_text !== item.source_url) {
    // Take first line as title
    const firstLine = item.raw_text.split("\n")[0].trim();
    return firstLine.length > 80 ? firstLine.slice(0, 80) + "..." : firstLine;
  }
  return item.source_url || "未知链接";
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
