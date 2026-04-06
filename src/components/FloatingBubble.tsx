import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";

/** Countdown seconds before auto-dismiss */
const COUNTDOWN_SECONDS = 5;

interface PendingCapture {
  content_type: string;
  preview: string;
  source_app: string;
  raw_text: string | null;
  image_path: string | null;
}

export function FloatingBubble() {
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear timer
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Dismiss: clean up temp image, hide bubble
  const dismiss = useCallback(
    async (capture: PendingCapture | null) => {
      clearTimer();
      if (capture?.image_path) {
        try {
          await invoke("dismiss_capture", { imagePath: capture.image_path });
        } catch (e) {
          console.error("dismiss_capture failed:", e);
        }
      }
      setPending(null);
      setCountdown(COUNTDOWN_SECONDS);
    },
    [clearTimer]
  );

  // Confirm: save to database
  const confirm = useCallback(async () => {
    if (!pending || saving) return;
    clearTimer();
    setSaving(true);

    try {
      await invoke("confirm_capture", {
        contentType: pending.content_type,
        preview: pending.preview,
        sourceApp: pending.source_app,
        rawText: pending.raw_text,
        imagePath: pending.image_path,
      });
    } catch (e) {
      console.error("confirm_capture failed:", e);
    }

    setSaving(false);
    setPending(null);
    setCountdown(COUNTDOWN_SECONDS);
  }, [pending, saving, clearTimer]);

  // Listen for pending capture events from Rust
  useEffect(() => {
    const unlisten = listen<PendingCapture>("capture:pending", (event) => {
      // If already showing a bubble, dismiss the old one first (without cleanup — it will be replaced)
      clearTimer();
      setPending(event.payload);
      setCountdown(COUNTDOWN_SECONDS);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [clearTimer]);

  // Countdown timer
  useEffect(() => {
    if (!pending) return;

    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Time's up — dismiss
          dismiss(pending);
          return COUNTDOWN_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearTimer();
  }, [pending, dismiss, clearTimer]);

  // Content preview text
  const previewText = pending
    ? pending.content_type === "image"
      ? "📷 截图 / 图片"
      : pending.preview.length > 30
        ? pending.preview.slice(0, 30) + "..."
        : pending.preview
    : "";

  // Countdown progress (0 → 1)
  const progress = countdown / COUNTDOWN_SECONDS;

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.8 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
          className="fixed bottom-6 right-6 z-[9999]"
        >
          <button
            onClick={confirm}
            disabled={saving}
            className="
              group relative flex items-center gap-3
              pl-4 pr-5 py-3 rounded-2xl
              bg-white/80 dark:bg-slate-800/90
              backdrop-blur-xl
              border border-white/50 dark:border-white/[0.1]
              shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(249,115,22,0.15)]
              dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),0_2px_8px_rgba(249,115,22,0.2)]
              hover:shadow-[0_8px_40px_rgba(249,115,22,0.25)]
              hover:scale-[1.03]
              active:scale-[0.98]
              transition-all duration-200
              cursor-pointer select-none
            "
          >
            {/* Countdown ring */}
            <div className="relative w-10 h-10 flex-shrink-0">
              <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
                {/* Background ring */}
                <circle
                  cx="20" cy="20" r="17"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-gray-200 dark:text-slate-700"
                />
                {/* Progress ring */}
                <circle
                  cx="20" cy="20" r="17"
                  fill="none"
                  stroke="url(#countdown-gradient)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 17}`}
                  strokeDashoffset={`${2 * Math.PI * 17 * (1 - progress)}`}
                  className="transition-all duration-1000 ease-linear"
                />
                <defs>
                  <linearGradient id="countdown-gradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#F97316" />
                    <stop offset="100%" stopColor="#FB923C" />
                  </linearGradient>
                </defs>
              </svg>
              {/* Countdown number */}
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-orange-500 dark:text-orange-400">
                {countdown}
              </span>
            </div>

            {/* Content preview */}
            <div className="flex flex-col min-w-0 max-w-[200px]">
              <span className="text-[11px] text-gray-400 dark:text-slate-500 leading-none mb-0.5">
                {pending.source_app} · 点击保存
              </span>
              <span className="text-[13px] font-medium text-gray-800 dark:text-gray-200 leading-snug truncate">
                {saving ? "保存中..." : previewText}
              </span>
            </div>

            {/* Save icon — appears on hover */}
            <div className="w-7 h-7 rounded-lg bg-orange-500/10 dark:bg-orange-500/20 flex items-center justify-center flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
              <svg className="w-4 h-4 text-orange-500 dark:text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
          </button>

          {/* Dismiss button — small X at top-right */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss(pending);
            }}
            className="
              absolute -top-2 -right-2
              w-6 h-6 rounded-full
              bg-gray-200 dark:bg-slate-700
              flex items-center justify-center
              text-gray-400 dark:text-slate-500
              hover:bg-red-100 hover:text-red-500
              dark:hover:bg-red-500/20 dark:hover:text-red-400
              transition-colors cursor-pointer
              shadow-sm
            "
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
