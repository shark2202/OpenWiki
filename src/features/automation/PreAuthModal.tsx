import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Clipboard } from "lucide-react";
import {
  requestAutomationPermission,
  dismissAutomationPrompt,
} from "../../services/automationService";

/**
 * First-launch pre-authorization modal.
 *
 * Shown when the backend emits `automation-needed` during startup. Gives the
 * user a friendly explanation of *why* we need Apple Events permission
 * before macOS's scary "wants to control System Events" system dialog
 * appears. The system dialog is only triggered when the user clicks the
 * primary "开始授权" button inside this modal.
 */
export function PreAuthModal() {
  const { t } = useTranslation("automation");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unlisten = listen("automation-needed", () => {
      setOpen(true);
    });
    // Also reachable from Settings → Diagnostics "重新授权" button, which
    // fires this same window event so there's only one modal codepath.
    const manualHandler = () => setOpen(true);
    window.addEventListener("automation-needed-manual", manualHandler);
    return () => {
      unlisten.then((fn) => fn());
      window.removeEventListener("automation-needed-manual", manualHandler);
    };
  }, []);

  if (!open) return null;

  const emitToast = (
    detail: { type: "granted" | "dismissed" },
  ) => {
    window.dispatchEvent(
      new CustomEvent("automation-toast", { detail }),
    );
  };

  const handleGrant = async () => {
    setBusy(true);
    try {
      const snapshot = await requestAutomationPermission();
      setBusy(false);
      setOpen(false);
      if (snapshot.status === "granted") {
        emitToast({ type: "granted" });
        // Let the banner listener know to hide itself if it was showing.
        window.dispatchEvent(new CustomEvent("automation-granted"));
      } else {
        // User clicked "Don't Allow" in the system dialog. Show the red banner.
        window.dispatchEvent(new CustomEvent("automation-denied"));
      }
    } catch (err) {
      console.error("[automation] request failed:", err);
      setBusy(false);
      setOpen(false);
    }
  };

  const handleLater = async () => {
    try {
      await dismissAutomationPrompt();
    } catch (err) {
      console.error("[automation] dismiss failed:", err);
    }
    emitToast({ type: "dismissed" });
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center
                 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-[460px] max-w-[90vw] rounded-2xl
                   bg-[#18181c] border border-white/10
                   shadow-[0_30px_80px_rgba(0,0,0,0.7)]
                   p-9 text-gray-100
                   animate-in slide-in-from-bottom-4 duration-300"
      >
        {/* Icon */}
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl
                        bg-gradient-to-br from-orange-400 to-orange-600
                        shadow-[0_8px_24px_rgba(255,107,26,0.25)]">
          <Clipboard className="h-7 w-7 text-white" strokeWidth={2.25} />
        </div>

        {/* Title */}
        <h2 className="mb-2.5 text-xl font-bold tracking-tight text-white">
          {t("modal.title")}
        </h2>

        {/* Intro */}
        <p className="mb-4 text-sm leading-relaxed text-gray-400">
          {t("modal.intro")}
        </p>

        {/* Examples list */}
        <div className="mb-5 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3.5 space-y-1.5">
          <div className="flex items-center gap-2.5 text-[13px] text-gray-200">
            <span className="h-1 w-1 flex-shrink-0 rounded-full bg-orange-500" />
            {t("modal.examples.wechat")}
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-gray-200">
            <span className="h-1 w-1 flex-shrink-0 rounded-full bg-orange-500" />
            {t("modal.examples.chrome")}
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-gray-200">
            <span className="h-1 w-1 flex-shrink-0 rounded-full bg-orange-500" />
            {t("modal.examples.notes")}
          </div>
        </div>

        {/* Note */}
        <p className="mb-6 text-xs leading-relaxed text-gray-500">
          {t("modal.note")}
        </p>

        {/* Buttons */}
        <div className="flex gap-2.5">
          <button
            onClick={handleGrant}
            disabled={busy}
            className="flex-1 rounded-xl bg-orange-500 py-2.5 text-sm font-semibold text-white
                       transition-colors hover:bg-orange-600
                       disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("modal.grant")}
          </button>
          <button
            onClick={handleLater}
            disabled={busy}
            className="flex-1 rounded-xl bg-white/[0.06] py-2.5 text-sm font-semibold text-gray-300
                       transition-colors hover:bg-white/[0.1]
                       disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("modal.later")}
          </button>
        </div>
      </div>
    </div>
  );
}
