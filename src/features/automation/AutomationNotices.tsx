import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { openAutomationSettings } from "../../services/automationService";

/**
 * Two transient UI surfaces in one component:
 *
 * 1. **Denial banner** — sticky at the top of the main window when the user
 *    has previously denied automation at the macOS level. Has a "fix it"
 *    button that deep-links to System Settings → Privacy → Automation.
 *
 * 2. **Success/dismissal toast** — a small notification in the bottom-right
 *    corner that fades away after a few seconds, used to confirm grant
 *    events and the "later" dismissal.
 *
 * Both react to events fired by `PreAuthModal.tsx` and by the Rust startup
 * check (`automation-denied` / `automation-granted`).
 */

type ToastState = {
  type: "granted" | "dismissed";
  id: number;
} | null;

export function AutomationNotices() {
  const { t } = useTranslation("automation");
  const [bannerOpen, setBannerOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  // ---- Banner wiring ----
  useEffect(() => {
    const unlistenDenied = listen("automation-denied", () => {
      setBannerOpen(true);
    });
    const unlistenGranted = listen("automation-granted", () => {
      setBannerOpen(false);
    });
    // Mirror window events from PreAuthModal for immediate feedback.
    const manualDenied = () => setBannerOpen(true);
    const manualGranted = () => setBannerOpen(false);
    window.addEventListener("automation-denied", manualDenied);
    window.addEventListener("automation-granted", manualGranted);
    return () => {
      unlistenDenied.then((fn) => fn());
      unlistenGranted.then((fn) => fn());
      window.removeEventListener("automation-denied", manualDenied);
      window.removeEventListener("automation-granted", manualGranted);
    };
  }, []);

  // ---- Toast wiring ----
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ type: "granted" | "dismissed" }>;
      if (!ce.detail) return;
      setToast({ type: ce.detail.type, id: Date.now() });
    };
    window.addEventListener("automation-toast", handler);
    return () => window.removeEventListener("automation-toast", handler);
  }, []);

  // Auto-hide toast after 3 seconds.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleFix = async () => {
    try {
      await openAutomationSettings();
    } catch (err) {
      console.error("[automation] failed to open settings:", err);
    }
  };

  return (
    <>
      {/* Red denial banner (sits just below the header) */}
      {bannerOpen && (
        <div
          role="alert"
          className="sticky top-[40px] z-[9] border-b border-red-500/25
                     bg-red-500/[0.08] backdrop-blur-xl
                     animate-in fade-in slide-in-from-top-2 duration-300"
        >
          <div className="flex items-center gap-3 px-4 py-2.5 max-w-full">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />

            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-red-700 dark:text-red-300 truncate">
                {t("banner.title")}
              </div>
              <div className="text-[11px] text-red-500/80 dark:text-red-300/60 truncate">
                {t("banner.subtitle")}
              </div>
            </div>

            <button
              onClick={handleFix}
              className="flex-shrink-0 px-3 py-1 text-[12px] font-semibold rounded-md
                         bg-red-500 text-white hover:bg-red-600 transition-colors
                         shadow-sm"
            >
              {t("banner.fix")}
            </button>

            <button
              onClick={() => setBannerOpen(false)}
              aria-label={t("banner.close")}
              className="flex-shrink-0 p-1 rounded text-red-400 hover:text-red-600
                         dark:text-red-300/60 dark:hover:text-red-200
                         hover:bg-red-500/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Toast — bottom-right, 3s auto-dismiss */}
      {toast && (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-[90]
                     flex items-center gap-2.5 px-4 py-3 rounded-xl
                     bg-green-900/95 border border-green-700/50
                     text-green-100 text-[13px]
                     shadow-[0_20px_40px_rgba(0,0,0,0.5)]
                     animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
          <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
          <span>
            {toast.type === "granted"
              ? t("toast.granted")
              : t("toast.dismissed")}
          </span>
        </div>
      )}
    </>
  );
}
