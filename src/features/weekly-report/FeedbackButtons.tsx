import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { submitFeedback } from "../../services/reportService";
import type { FeedbackType } from "../../types/report";

type FeedbackState = "idle" | "confirming" | "confirmed";

interface FeedbackButtonsProps {
  contentId: string | null;
  sectionId: string | null;
  onFeedback?: (type: FeedbackType) => void;
}

export function FeedbackButtons({
  contentId,
  sectionId,
  onFeedback,
}: FeedbackButtonsProps) {
  const [interestedState, setInterestedState] =
    useState<FeedbackState>("idle");
  const [dismissedState, setDismissedState] = useState<FeedbackState>("idle");

  const handleFeedback = async (type: FeedbackType) => {
    const setStateFunc =
      type === "interested" ? setInterestedState : setDismissedState;

    setStateFunc("confirming");

    try {
      await submitFeedback(contentId, sectionId, type);
      setStateFunc("confirmed");
      onFeedback?.(type);

      // Reset after showing confirmation
      setTimeout(() => {
        setStateFunc("idle");
      }, 1500);
    } catch (e) {
      console.error("Failed to submit feedback:", e);
      setStateFunc("idle");
    }
  };

  const isDisabled =
    interestedState !== "idle" || dismissedState !== "idle";

  return (
    <div className="flex items-center gap-2">
      <FeedbackButton
        state={interestedState}
        disabled={isDisabled && interestedState === "idle"}
        idleLabel="感兴趣"
        idleIcon="👍"
        confirmLabel="已记录"
        onClick={() => handleFeedback("interested")}
        variant="interested"
      />
      <FeedbackButton
        state={dismissedState}
        disabled={isDisabled && dismissedState === "idle"}
        idleLabel="已了解"
        idleIcon="👋"
        confirmLabel="已记录"
        onClick={() => handleFeedback("dismissed")}
        variant="dismissed"
      />
    </div>
  );
}

interface FeedbackButtonProps {
  state: FeedbackState;
  disabled: boolean;
  idleLabel: string;
  idleIcon: string;
  confirmLabel: string;
  onClick: () => void;
  variant: "interested" | "dismissed";
}

function FeedbackButton({
  state,
  disabled,
  idleLabel,
  idleIcon,
  confirmLabel,
  onClick,
  variant,
}: FeedbackButtonProps) {
  const baseClasses =
    "relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer select-none overflow-hidden";

  const variantClasses = {
    interested: {
      idle: "bg-orange-500/10 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-500/20",
      confirming: "bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400",
      confirmed: "bg-blue-500 text-white",
    },
    dismissed: {
      idle: "bg-white/40 dark:bg-white/[0.04] text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-600",
      confirming: "bg-gray-100 dark:bg-slate-600 text-gray-500 dark:text-slate-400",
      confirmed: "bg-gray-400 dark:bg-slate-500 text-white",
    },
  };

  const disabledClasses = "opacity-40 cursor-not-allowed";

  return (
    <motion.button
      onClick={disabled ? undefined : onClick}
      className={`${baseClasses} ${variantClasses[variant][state]} ${disabled ? disabledClasses : ""}`}
      whileHover={!disabled ? { scale: 1.05 } : undefined}
      whileTap={!disabled ? { scale: 0.95 } : undefined}
      layout
    >
      <AnimatePresence mode="wait">
        {state === "idle" && (
          <motion.span
            key="idle"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1.5"
          >
            <span>{idleIcon}</span>
            <span>{idleLabel}</span>
          </motion.span>
        )}
        {state === "confirming" && (
          <motion.span
            key="confirming"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1.5"
          >
            <LoadingDots />
          </motion.span>
        )}
        {state === "confirmed" && (
          <motion.span
            key="confirmed"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1.5"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span>{confirmLabel}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function LoadingDots() {
  return (
    <span className="flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-1 h-1 rounded-full bg-current"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: i * 0.15,
          }}
        />
      ))}
    </span>
  );
}
