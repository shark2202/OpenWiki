import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

const DEFAULT_COUNTDOWN = 5;
const CIRCLE_SIZE = 48;
const CIRCLE_WIN_H = 64; // Window height for circle mode (48px circle + 16px bounce padding)
const CAPSULE_W = 320;
const EXPANDED_H = 140; // Height when expanded with preview + input

interface PendingCapture {
  content_type: string;
  preview: string;
  source_app: string;
  raw_text: string | null;
  image_path: string | null;
}

export default function BubbleView() {
  const { t } = useTranslation("common");

  useEffect(() => {
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    const root = document.getElementById("root");
    if (root) root.style.background = "transparent";
  }, []);

  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [countdownMax, setCountdownMax] = useState(DEFAULT_COUNTDOWN);
  const [countdown, setCountdown] = useState(DEFAULT_COUNTDOWN);
  const [saving, setSaving] = useState(false);
  const [bubbleStyle, setBubbleStyle] = useState<"circle" | "bar">("circle");
  const [expanded, setExpanded] = useState(false);
  const [memo, setMemo] = useState("");
  const [bubblePosition, setBubblePosition] = useState("bottom-right");
  const [defaultAction, setDefaultAction] = useState<"save" | "dismiss">("dismiss");
  // ★ Key state: once confirmed, ONLY render success UI. Nothing can override this.
  const [confirmed, setConfirmed] = useState(false);
  // Failure state: when confirm_capture throws a real error (not just
  // "Moved to top" dedup), we expand to a red capsule showing the error
  // so the user can retry, copy the error, or dismiss. Without this the
  // old code silently swallowed backend errors and showed success, which
  // is how the "clicked confirm but nothing saved" report came in.
  const [failureError, setFailureError] = useState<string | null>(null);
  const [failureCountdown, setFailureCountdown] = useState(10);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRef = useRef<PendingCapture | null>(null);
  const appWindow = useRef(getCurrentWindow());
  const inputRef = useRef<HTMLInputElement>(null);
  // Snapshot of countdown when memo is expanded (for pause/resume)
  const pausedCountdownRef = useRef<number | null>(null);

  useEffect(() => { pendingRef.current = pending; }, [pending]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const closeWindow = useCallback(async () => {
    clearTimer();
    try { await appWindow.current.close(); } catch (e) { console.error("close failed:", e); }
  }, [clearTimer]);

  const dismiss = useCallback(async () => {
    const capture = pendingRef.current;
    clearTimer();
    try { await invoke("dismiss_capture", { imagePath: capture?.image_path ?? null }); } catch {}
    await closeWindow();
  }, [clearTimer, closeWindow]);

  const confirm = useCallback(async () => {
    const capture = pendingRef.current;
    if (!capture || saving || confirmed) return;
    clearTimer();
    setSaving(true);
    // Clear any prior failure so retry flow works cleanly
    setFailureError(null);

    let backendError: string | null = null;
    try {
      await invoke("confirm_capture", {
        contentType: capture.content_type,
        preview: capture.preview,
        sourceApp: capture.source_app,
        rawText: capture.raw_text,
        imagePath: capture.image_path,
        userNote: memo.trim() || null,
      });
    } catch (e) {
      console.error("confirm failed:", e);
      backendError = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
    }

    // "Moved to top" is not a real failure — it's the backend's dedup signal
    // meaning "you already have this content, I bumped it to the top of the
    // list". From the user's perspective the save succeeded, so fall through
    // to the success animation.
    const isRealFailure = backendError !== null && backendError !== "Moved to top";

    if (isRealFailure) {
      // Grow the window to capsule size so the failure UI has room to breathe.
      // (Skipped if we're already in the expanded memo state — same window size.)
      if (!expanded) {
        try {
          const win = appWindow.current;
          const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
          const scale = await win.scaleFactor();
          const pos = await win.outerPosition();
          const heightDiff = EXPANDED_H - CIRCLE_WIN_H;
          await win.setPosition(new LogicalPosition(pos.x / scale, pos.y / scale - heightDiff));
          await win.setSize(new LogicalSize(CAPSULE_W, EXPANDED_H));
        } catch {}
      }
      setSaving(false);
      setFailureError(backendError!);
      return;
    }

    // Success (or dedup). If expanded, shrink window back to circle size.
    if (expanded) {
      try {
        const win = appWindow.current;
        const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
        const scale = await win.scaleFactor();
        const pos = await win.outerPosition();
        const heightDiff = EXPANDED_H - CIRCLE_WIN_H;
        await win.setPosition(new LogicalPosition(pos.x / scale, pos.y / scale + heightDiff));
        await win.setSize(new LogicalSize(CAPSULE_W, CIRCLE_WIN_H));
      } catch {}
    }

    // Show confirmed state — no DOM swap, just CSS transitions on existing elements
    setExpanded(false);
    setConfirmed(true);

    // Close window after 1.2 seconds
    setTimeout(async () => {
      try { await appWindow.current.close(); } catch {}
    }, 1200);
  }, [saving, confirmed, clearTimer, memo, expanded, bubblePosition, bubbleStyle]);

  // Retry from the failure state: reset failureError + saving, then call
  // confirm() again. confirm() will re-invoke the backend and route to
  // either success or a fresh failure UI.
  const handleRetry = useCallback(async () => {
    setFailureError(null);
    setSaving(false);
    // Defer one tick so state updates land before confirm() re-checks them
    setTimeout(() => { confirm(); }, 0);
  }, [confirm]);

  // Copy the error to clipboard so the user can paste it to the developer.
  // Includes timestamp to disambiguate multiple failures.
  const handleCopyError = useCallback(async () => {
    if (!failureError) return;
    const report = [
      "OpenWiki 保存失败报告",
      `时间: ${new Date().toLocaleString()}`,
      `错误: ${failureError}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(report);
    } catch (e) {
      console.error("Copy failed:", e);
    }
  }, [failureError]);

  // Expand circle → card with preview + input
  const expandToCapsule = useCallback(async () => {
    if (expanded || bubbleStyle !== "circle" || confirmed) return;
    // Snapshot current countdown before pausing
    pausedCountdownRef.current = countdown;
    clearTimer();
    setExpanded(true);
    // Resize native window and move it up so it expands upward (not behind Dock)
    try {
      const win = appWindow.current;
      const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
      const scale = await win.scaleFactor();
      const pos = await win.outerPosition();
      const heightDiff = EXPANDED_H - CIRCLE_WIN_H; // 140 - 48 = 92px
      // Move window up by the height difference
      await win.setPosition(new LogicalPosition(pos.x / scale, pos.y / scale - heightDiff));
      await win.setSize(new LogicalSize(CAPSULE_W, EXPANDED_H));
    } catch (e) {
      console.error("Failed to resize bubble window:", e);
    }
    setTimeout(() => inputRef.current?.focus(), 350);
  }, [expanded, bubbleStyle, clearTimer, confirmed, countdown]);

  // Collapse memo panel back to circle, resume countdown from snapshot
  const collapseCapsule = useCallback(async () => {
    if (!expanded || confirmed) return;
    setExpanded(false);
    setMemo("");
    // Restore countdown from snapshot
    if (pausedCountdownRef.current !== null) {
      setCountdown(pausedCountdownRef.current);
      pausedCountdownRef.current = null;
    }
    // Resize window back to circle
    try {
      const win = appWindow.current;
      const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
      const scale = await win.scaleFactor();
      const pos = await win.outerPosition();
      const heightDiff = EXPANDED_H - CIRCLE_WIN_H;
      await win.setPosition(new LogicalPosition(pos.x / scale, pos.y / scale + heightDiff));
      await win.setSize(new LogicalSize(CAPSULE_W, CIRCLE_WIN_H));
    } catch {}
  }, [expanded, confirmed]);

  // On mount: fetch pending data + bubble style + default_action
  useEffect(() => {
    const init = async () => {
      try {
        const settings = await invoke<Record<string, string>>("get_settings");
        if (settings?.bubble_style === "bar") setBubbleStyle("bar");
        if (settings?.bubble_position) setBubblePosition(settings.bubble_position);
        if (settings?.countdown_seconds) {
          const secs = parseInt(settings.countdown_seconds, 10);
          if (secs >= 1 && secs <= 30) { setCountdownMax(secs); setCountdown(secs); }
        }
        if (settings?.default_action === "save") setDefaultAction("save");
      } catch {}
      try {
        const data = await invoke<PendingCapture | null>("get_pending_capture");
        if (data) { setPending(data); }
      } catch (e) { console.error("get_pending_capture failed:", e); }
    };
    const timer = setTimeout(init, 100);
    return () => clearTimeout(timer);
  }, []);

  // ★ Global keyboard listener
  useEffect(() => {
    if (!pending || confirmed) return;

    const handler = (e: KeyboardEvent) => {
      // Don't handle if input is focused (input handles its own Enter)
      const isInputFocused = document.activeElement === inputRef.current;

      if (e.key === "Enter") {
        if (isInputFocused) return; // Let input's onKeyDown handle it
        e.preventDefault();
        // Enter = always save (universal convention)
        confirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (expanded) {
          // Collapse memo, resume countdown
          collapseCapsule();
        } else {
          // Esc = always dismiss/cancel (universal convention)
          dismiss();
        }
      } else if (e.key === "Tab") {
        e.preventDefault();
        // Tab only works in circle mode to expand memo
        if (!expanded && bubbleStyle === "circle") {
          expandToCapsule();
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pending, confirmed, expanded, defaultAction, bubbleStyle, confirm, dismiss, expandToCapsule, collapseCapsule]);

  // ★ Listen for new capture events — UNSUBSCRIBE when expanded or confirmed
  useEffect(() => {
    if (expanded || confirmed) {
      invoke("debug_log", { message: `[LISTENER] expanded=${expanded} confirmed=${confirmed}, NOT listening` }).catch(() => {});
      return;
    }

    invoke("debug_log", { message: "[LISTENER] subscribing to capture:pending" }).catch(() => {});
    const unlisten = listen<PendingCapture>("capture:pending", (event) => {
      invoke("debug_log", { message: `[LISTENER] capture:pending received! type=${event.payload.content_type}` }).catch(() => {});
      clearTimer(); setPending(event.payload); setCountdown(countdownMax);
      setExpanded(false); setMemo(""); setConfirmed(false); setSaving(false);
      pausedCountdownRef.current = null;
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [expanded, confirmed, clearTimer, countdownMax]);

  // Countdown (only when NOT expanded and NOT confirmed)
  // ★ When countdown reaches 0, execute default_action (not always dismiss)
  useEffect(() => {
    if (!pending || expanded || confirmed || failureError) return;
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setTimeout(() => {
            if (defaultAction === "save") confirm();
            else dismiss();
          }, 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearTimer();
  }, [pending, expanded, confirmed, failureError, defaultAction, dismiss, confirm, clearTimer]);

  // Failure state: give the user 10 seconds to read the error + decide
  // (retry, copy, or ignore), then auto-close so the bubble doesn't
  // hang around forever if they walked away from the computer.
  useEffect(() => {
    if (!failureError) return;
    setFailureCountdown(10);
    let remaining = 10;
    const timer = setInterval(() => {
      remaining -= 1;
      setFailureCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        closeWindow();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [failureError, closeWindow]);

  const isRight = bubblePosition.includes("right");
  const isLeft = bubblePosition.includes("left");

  // Default action label for bar mode UI hint
  const barActionHint = defaultAction === "save"
    ? t("bubble.autoSaveCountdown", { countdown })
    : t("bubble.autoDismissCountdown", { countdown });

  // ════════════════════════════════════════════════════════════

  const progress = pending ? countdown / countdownMax : 0;
  const circumference = 2 * Math.PI * 16;

  if (!pending) {
    return <div style={{ background: "transparent" }} />;
  }

  const isImage = pending.content_type === "image";
  const isUrl = pending.content_type === "url";

  // Preview text for the expanded view
  const previewText = isImage
    ? ""
    : isUrl
    ? (pending.preview || pending.raw_text || "").slice(0, 60)
    : (pending.raw_text || pending.preview || "").slice(0, 60);

  // ─── Failure State (highest priority — overrides both circle and bar) ───
  // Shown when confirm_capture throws a real backend error. Unified across
  // bubble styles so the user gets the same information layout regardless
  // of whether they picked circle or bar mode.
  if (failureError) {
    return (
      <div
        className="select-none"
        style={{
          width: CAPSULE_W,
          height: EXPANDED_H,
          background: "transparent",
          display: "flex",
          justifyContent: isRight ? "flex-end" : isLeft ? "flex-start" : "center",
        }}
      >
        <div
          style={{
            width: CAPSULE_W,
            borderRadius: 14,
            background: "rgb(15, 15, 30)",
            boxShadow: [
              "0 8px 32px rgba(0, 0, 0, 0.5)",
              "0 0 12px rgba(220, 38, 38, 0.18)",
              "inset 0 1px 0 rgba(255, 255, 255, 0.08)",
              "inset 0 0 0 1px rgba(220, 38, 38, 0.22)",
            ].join(", "),
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Top: icon + message */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "rgba(220, 38, 38, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#F87171" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 2,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: "#F87171" }}>
                  {t("bubble.saveFailed")}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "JetBrains Mono, monospace",
                    color: "rgba(255, 255, 255, 0.25)",
                  }}
                >
                  {failureCountdown}s
                </span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255, 255, 255, 0.65)",
                  lineHeight: 1.5,
                  wordBreak: "break-word",
                  maxHeight: 48,
                  overflowY: "auto",
                }}
              >
                {failureError}
              </div>
            </div>
          </div>

          {/* Bottom: actions row */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              onClick={handleRetry}
              disabled={saving}
              style={{
                height: 28,
                padding: "0 10px",
                borderRadius: 8,
                background: "rgba(249, 115, 22, 0.2)",
                border: "1px solid rgba(249, 115, 22, 0.3)",
                color: "#FDBA74",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
                whiteSpace: "nowrap",
              }}
            >
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
              {t("bubble.retry")}
            </button>
            <button
              onClick={handleCopyError}
              style={{
                height: 28,
                padding: "0 10px",
                borderRadius: 8,
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                color: "rgba(255, 255, 255, 0.6)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
                whiteSpace: "nowrap",
              }}
            >
              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              {t("bubble.copyError")}
            </button>
            <button
              onClick={closeWindow}
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                color: "rgba(255, 255, 255, 0.55)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginLeft: "auto",
              }}
              aria-label={t("bubble.dismiss")}
            >
              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Countdown progress bar along the bottom edge */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 2,
              background: "rgba(255, 255, 255, 0.03)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${(failureCountdown / 10) * 100}%`,
                background: "linear-gradient(90deg, #DC2626, #F87171)",
                transition: "width 1s linear",
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ─── Circle Mode ───
  if (bubbleStyle === "circle") {
    // Expanded state: card with preview + input
    if (expanded) {
      return (
        <div
          className="select-none"
          style={{
            width: CAPSULE_W,
            height: EXPANDED_H,
            background: "transparent",
            display: "flex",
            justifyContent: isRight ? "flex-end" : isLeft ? "flex-start" : "center",
          }}
        >
          <div
            style={{
              width: CAPSULE_W,
              height: EXPANDED_H,
              borderRadius: 16,
              background: "rgb(15, 15, 30)",
              boxShadow: [
                "0 8px 32px rgba(0, 0, 0, 0.5)",
                "0 0 12px rgba(249, 115, 22, 0.15)",
                "inset 0 1px 0 rgba(255, 255, 255, 0.1)",
                "inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
              ].join(", "),
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Preview area */}
            <div className="flex-1 px-3 pt-3 pb-2 min-h-0 overflow-hidden">
              {isImage && pending.image_path ? (
                <div className="flex items-center gap-2 h-full">
                  <img
                    src={convertFileSrc(pending.image_path)}
                    alt="preview"
                    className="h-full max-h-[60px] rounded-lg object-cover border border-white/10"
                  />
                  <span className="text-[12px] text-white/40">{t("bubble.screenshotImage")}</span>
                </div>
              ) : isUrl ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px]">🔗</span>
                    <span className="text-[10px] text-white/30 uppercase">{pending.source_app}</span>
                  </div>
                  <p className="text-[12px] text-white/70 leading-snug line-clamp-2">
                    {previewText || t("bubble.linkContent")}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px]">📋</span>
                    <span className="text-[10px] text-white/30 uppercase">{pending.source_app}</span>
                  </div>
                  <p className="text-[12px] text-white/70 leading-snug line-clamp-2">
                    {previewText || t("bubble.textContent")}
                  </p>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="mx-3 h-[1px] bg-white/[0.06]" />

            {/* Input + actions */}
            <div className="flex items-center gap-2 px-3 py-2.5">
              <input
                ref={inputRef}
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    confirm();
                  }
                  // Esc is handled by global listener (collapseCapsule)
                }}
                placeholder={t("bubble.memoPlaceholder")}
                className="flex-1 bg-white/[0.06] rounded-lg px-2.5 py-1.5 text-[13px] text-white/90 placeholder-white/25
                           outline-none border border-white/[0.08] focus:border-orange-400/30 min-w-0"
                style={{ caretColor: "#F97316" }}
              />
              <button
                onClick={confirm}
                disabled={saving}
                className="h-7 px-3 rounded-lg text-[12px] font-medium
                           bg-orange-500/25 hover:bg-orange-500/40
                           text-orange-300 hover:text-orange-200
                           border border-orange-400/15 hover:border-orange-400/30
                           transition-all duration-150 cursor-pointer flex-shrink-0"
              >
                {saving ? "..." : t("action.save")}
              </button>
              <button
                onClick={collapseCapsule}
                className="w-7 h-7 rounded-lg flex items-center justify-center
                           text-white/20 hover:text-red-400 hover:bg-red-500/15
                           transition-all duration-150 cursor-pointer flex-shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Default circle state — BOTH countdown and confirmed layers always rendered.
    // Only opacity changes on confirm — zero DOM add/remove = zero flash.
    return (
      <div
        className="select-none"
        style={{
          width: CAPSULE_W,
          height: CIRCLE_WIN_H,
          background: "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: isRight ? "flex-end" : isLeft ? "flex-start" : "center",
        }}
      >
        <div
          className="relative"
          onClick={confirmed ? undefined : expandToCapsule}
          style={{
            width: CIRCLE_SIZE,
            height: CIRCLE_SIZE,
            borderRadius: "50%",
            background: confirmed ? "#16A34A" : "rgb(15, 15, 30)",
            boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.1)",
            cursor: confirmed ? "default" : "pointer",
            transition: "background 0.3s ease",
            overflow: "hidden",
          }}
        >
          {/* Layer 1: Countdown content — fades out on confirm */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ opacity: confirmed ? 0 : 1, transition: "opacity 0.25s ease" }}
          >
            <div className="relative" style={{ width: 38, height: 38 }}>
              <svg className="absolute inset-0 -rotate-90" width="38" height="38" viewBox="0 0 38 38">
                <circle cx="19" cy="19" r="15" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
                <circle
                  cx="19" cy="19" r="15"
                  fill="none" stroke="url(#cg)" strokeWidth="2" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 15}
                  strokeDashoffset={2 * Math.PI * 15 * (1 - progress)}
                  className="transition-all duration-1000 ease-linear"
                />
                <defs>
                  <linearGradient id="cg" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#F97316" />
                    <stop offset="100%" stopColor="#FDBA74" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm leading-none">{isImage ? "📷" : isUrl ? "🔗" : "📋"}</span>
              </div>
            </div>
          </div>

          {/* Layer 2: Confirmed content — fades in on confirm */}
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ opacity: confirmed ? 1 : 0, transition: "opacity 0.25s ease" }}
          >
            {/* Checkmark with draw animation */}
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            >
              <path
                d="M5 13l4 4L19 7"
                strokeDasharray="24"
                strokeDashoffset={confirmed ? "0" : "24"}
                style={{ transition: "stroke-dashoffset 0.4s ease 0.1s" }}
              />
            </svg>
          </div>

          {/* Dismiss X — always rendered, opacity controlled */}
          <button
            onClick={(e) => { e.stopPropagation(); dismiss(); }}
            className={`absolute rounded-full bg-red-500/80 hover:bg-red-500
                       flex items-center justify-center shadow-lg cursor-pointer
                       ${confirmed ? "opacity-0 pointer-events-none" : "opacity-0 hover:opacity-100"}`}
            style={{
              width: 16, height: 16,
              top: 0,
              right: isRight ? 0 : undefined,
              left: isLeft ? CIRCLE_SIZE - 16 : undefined,
              transition: "opacity 0.2s ease",
            }}
          >
            <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ─── Bar Mode (full 340x72 bar) ───
  const barPreview = isImage
    ? t("bubble.screenshotImage")
    : (pending.preview || pending.raw_text || "").length > 20
      ? (pending.preview || pending.raw_text || "").slice(0, 20) + "..."
      : (pending.preview || pending.raw_text || "");

  const iconBg = isImage
    ? "from-pink-500/20 to-rose-500/20"
    : "from-orange-500/20 to-amber-500/20";
  const iconEmoji = isImage ? "📷" : isUrl ? "🔗" : "📋";

  // In bar mode, only the explicit save button should trigger a save/dismiss
  // when the default action is "dismiss". Clicking the whole bar looked like a
  // primary confirmation target and caused accidental ignores.
  const barBodyClickable = !confirmed && defaultAction === "save";
  const barClick = barBodyClickable ? confirm : undefined;

  return (
    <div className="w-[340px] h-[72px] select-none" style={{ background: "transparent" }}>
      <div
        className={`relative w-full h-full rounded-2xl overflow-hidden group ${
          barBodyClickable ? "cursor-pointer" : "cursor-default"
        }`}
        onClick={barClick}
        style={{
          background: confirmed ? "#16A34A" : "rgb(15, 15, 30)",
          boxShadow: confirmed ? "none" : [
            "0 8px 32px rgba(0, 0, 0, 0.35)",
            "0 2px 8px rgba(249, 115, 22, 0.15)",
            "inset 0 1px 0 rgba(255, 255, 255, 0.08)",
            "inset 0 0 0 1px rgba(255, 255, 255, 0.06)",
          ].join(", "),
          transition: "background 0.3s ease",
        }}
      >
        {/* Top shimmer */}
        <div className="absolute inset-x-0 top-0 h-[1px]" style={{
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.15) 30%, rgba(249,115,22,0.3) 50%, rgba(255,255,255,0.15) 70%, transparent)",
        }} />

        {/* Bottom progress */}
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/[0.03]">
          <div className="h-full transition-all duration-1000 ease-linear" style={{
            width: `${progress * 100}%`,
            background: "linear-gradient(90deg, #F97316, #FB923C, #FDBA74)",
          }} />
        </div>

        {/* Layer 1: Bar countdown content — fades out on confirm */}
        <div className="relative flex items-center gap-3 h-full px-4"
          style={{ opacity: confirmed ? 0 : 1, transition: "opacity 0.25s ease" }}>
          <div className="relative w-10 h-10 flex-shrink-0">
            <svg className="absolute inset-0 w-10 h-10 -rotate-90" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
              <circle cx="20" cy="20" r="16" fill="none" stroke="url(#bar-grad)" strokeWidth="2" strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)}
                className="transition-all duration-1000 ease-linear" />
              <defs>
                <linearGradient id="bar-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#F97316" />
                  <stop offset="50%" stopColor="#FB923C" />
                  <stop offset="100%" stopColor="#FDBA74" />
                </linearGradient>
              </defs>
            </svg>
            <div className={`absolute inset-[5px] rounded-full bg-gradient-to-br ${iconBg} flex items-center justify-center`}>
              <span className="text-sm">{iconEmoji}</span>
            </div>
          </div>
          <div className="flex flex-col min-w-0 flex-1 gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-white/30 uppercase tracking-wider">{pending.source_app}</span>
              <span className="w-[3px] h-[3px] rounded-full bg-white/15" />
              <span className="text-[10px] text-orange-400/70">{barActionHint}</span>
            </div>
            <span className="text-[13px] font-medium text-white/85 leading-snug truncate">
              {saving ? t("bubble.saving") : barPreview}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={(e) => { e.stopPropagation(); confirm(); }} disabled={saving}
              className="w-8 h-8 rounded-xl flex items-center justify-center bg-orange-500/15 hover:bg-orange-500/30 border border-orange-400/10 hover:border-orange-400/25 transition-all duration-200 cursor-pointer">
              <svg className="w-3.5 h-3.5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </button>
            <button onClick={(e) => { e.stopPropagation(); dismiss(); }}
              className="w-6 h-6 rounded-lg flex items-center justify-center text-white/20 hover:text-red-400 hover:bg-red-500/15 transition-all duration-200 cursor-pointer">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {/* Layer 2: Bar confirmed content — fades in on confirm */}
        <div className="absolute inset-0 flex items-center justify-center gap-2 pointer-events-none"
          style={{ opacity: confirmed ? 1 : 0, transition: "opacity 0.25s ease" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7"
              strokeDasharray="24"
              strokeDashoffset={confirmed ? "0" : "24"}
              style={{ transition: "stroke-dashoffset 0.4s ease 0.1s" }}
            />
          </svg>
          <span className="text-[14px] font-semibold text-white">{t("bubble.saved")}</span>
        </div>
      </div>
    </div>
  );
}
