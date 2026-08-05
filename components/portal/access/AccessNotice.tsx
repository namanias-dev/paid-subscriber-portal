"use client";

/**
 * Single AccessNotice primitive — bar / lockCard / sheetHeader / pill.
 * Visual + layout only. Access decisions stay in lectureAccessForCourse.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Lock, Clock, CheckCircle2, X } from "lucide-react";
import { formatINR } from "@/lib/dates";
import { formatInstalmentLabel } from "@/lib/installmentNoticeCopy";
import type { InstallmentProofPromptProps } from "@/lib/installmentProofTypes";
import { requestInstallmentProofUpload, requestInstallmentProofView } from "./ippEvents";

export type AccessNoticeTone = "blocked" | "expiring" | "pending_review";
export type AccessNoticeVariant = "bar" | "lockCard" | "sheetHeader" | "pill";

const TONE: Record<
  AccessNoticeTone,
  {
    gradient: string;
    glow: string;
    Icon: typeof Lock;
    primaryBtn: string;
    secondaryBtn: string;
    progress: string;
  }
> = {
  blocked: {
    gradient: "linear-gradient(135deg, #7F1D1D 0%, #B91C1C 55%, #991B1B 100%)",
    glow: "0 8px 32px rgba(185,28,28,0.28)",
    Icon: Lock,
    primaryBtn: "bg-white text-[#B91C1C] hover:bg-white/95",
    secondaryBtn: "bg-white/14 text-white border border-white/24 hover:bg-white/20",
    progress: "#FBBF24",
  },
  expiring: {
    gradient: "linear-gradient(135deg, #B45309 0%, #D97706 55%, #F59E0B 100%)",
    glow: "0 8px 32px rgba(217,119,6,0.28)",
    Icon: Clock,
    primaryBtn: "bg-white text-[#B45309] hover:bg-white/95",
    secondaryBtn: "bg-white/14 text-white border border-white/24 hover:bg-white/20",
    progress: "#FEF3C7",
  },
  pending_review: {
    gradient: "linear-gradient(135deg, #1E293B 0%, #334155 100%)",
    glow: "0 8px 32px rgba(30,41,59,0.28)",
    Icon: CheckCircle2,
    primaryBtn: "bg-white text-[#1E293B] hover:bg-white/95",
    secondaryBtn: "bg-white/14 text-white border border-white/24 hover:bg-white/20",
    progress: "#94A3B8",
  },
};

function toneFromPrompt(state: InstallmentProofPromptProps["state"]): AccessNoticeTone {
  if (state === "blocked") return "blocked";
  if (state === "pending_review") return "pending_review";
  return "expiring";
}

function useContainerTier(ref: RefObject<HTMLElement | null>) {
  const [tier, setTier] = useState<"stacked" | "split" | "row">("stacked");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const w = el.clientWidth;
      if (w < 480) setTier("stacked");
      else if (w < 1024) setTier("split");
      else setTier("row");
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return tier;
}

function Shimmer({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  if (reduce || !active) return null;
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ delay: 1.2, duration: 0.2 }}
    >
      <motion.span
        className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent"
        initial={{ x: "-120%" }}
        animate={{ x: "320%" }}
        transition={{ duration: 1.2, ease: "easeInOut" }}
        style={{ willChange: "transform" }}
      />
    </motion.span>
  );
}

export interface AccessNoticeProps {
  variant?: AccessNoticeVariant;
  prompt: InstallmentProofPromptProps;
  compact?: boolean;
  onDismiss?: () => void;
  className?: string;
  /** When true, measure height into --access-bar-h on :root */
  measureHeight?: boolean;
  children?: ReactNode;
}

export default function AccessNotice({
  variant = "bar",
  prompt,
  compact = false,
  onDismiss,
  className = "",
  measureHeight = false,
}: AccessNoticeProps) {
  const toneKey = toneFromPrompt(prompt.state);
  const tone = TONE[toneKey];
  const Icon = tone.Icon;
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const tier = useContainerTier(rootRef);
  const [shimmerOn] = useState(true);
  const instalment = formatInstalmentLabel(prompt.installmentNo);
  const amount = formatINR(prompt.amountDue);
  const pct = prompt.pctPaid != null ? Math.min(100, Math.max(0, prompt.pctPaid)) : null;

  const days =
    prompt.daysLeft != null && prompt.daysLeft >= 0
      ? prompt.daysLeft === 1
        ? "1 more day"
        : `${prompt.daysLeft} more days`
      : null;

  const status =
    toneKey === "blocked"
      ? "Access paused"
      : toneKey === "pending_review"
        ? "Payment proof under review"
        : days
          ? `Access active for ${days}`
          : "Access active";

  const hero =
    toneKey === "pending_review"
      ? "We'll restore access shortly"
      : `${amount} · ${instalment}`;

  const goPay = () => {
    window.location.href = prompt.payHref;
  };

  // Runtime height → --access-bar-h (never hardcoded offsets).
  useEffect(() => {
    if (!measureHeight) return;
    const el = rootRef.current;
    if (!el) return;
    const sync = () => {
      document.documentElement.style.setProperty("--access-bar-h", `${el.offsetHeight}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty("--access-bar-h", "0px");
    };
  }, [measureHeight, compact, prompt.state, tier]);

  const shellStyle: CSSProperties = {
    background: tone.gradient,
    boxShadow: `${tone.glow}, inset 0 1px 0 rgba(255,255,255,0.12)`,
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
  };

  const btnBase =
    "inline-flex min-h-12 min-w-[44px] flex-1 items-center justify-center rounded-xl px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

  const actions =
    toneKey === "pending_review" ? (
      <motion.button
        type="button"
        whileTap={reduce ? undefined : { scale: 0.97 }}
        transition={{ duration: 0.12 }}
        onClick={() => requestInstallmentProofView()}
        className={`${btnBase} ${tone.secondaryBtn} w-full`}
      >
        View what I sent
      </motion.button>
    ) : (
      <>
        <motion.button
          type="button"
          whileTap={reduce ? undefined : { scale: 0.97 }}
          transition={{ duration: 0.12 }}
          onClick={goPay}
          className={`${btnBase} ${tone.primaryBtn}`}
        >
          Pay now
        </motion.button>
        <motion.button
          type="button"
          whileTap={reduce ? undefined : { scale: 0.97 }}
          transition={{ duration: 0.12 }}
          onClick={() => requestInstallmentProofUpload()}
          className={`${btnBase} ${tone.secondaryBtn}`}
          aria-label="I've already paid"
        >
          Already paid
        </motion.button>
      </>
    );

  /* ——— lockCard / sheetHeader compact surfaces ——— */
  if (variant === "lockCard" || variant === "sheetHeader") {
    return (
      <div
        ref={rootRef}
        className={`relative overflow-visible rounded-xl text-white ${className}`}
        style={shellStyle}
        role="status"
      >
        <div className="relative z-[1] flex items-start gap-3 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/15">
            <Icon size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-snug">{status}</p>
            <p className="mt-1 text-[17px] font-bold tabular-nums leading-snug">{hero}</p>
            {prompt.courseTitle ? (
              <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-white/70">{prompt.courseTitle}</p>
            ) : null}
            {variant === "lockCard" ? (
              <div className="mt-3 flex gap-2">{actions}</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const stacked = tier === "stacked" || compact;
  const split = tier === "split" && !compact;
  const row = tier === "row" && !compact;

  // Sticky lives on an untransformed wrapper — Framer transform would break sticky.
  return (
    <div
      ref={rootRef}
      className={[
        "access-notice-bar sticky top-[var(--header-h,3.5rem)] z-40 w-full overflow-visible",
        "pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]",
        className,
      ].join(" ")}
      data-access-notice="bar"
      data-tier={tier}
      data-compact={compact ? "1" : "0"}
    >
      <motion.div
        role="status"
        aria-live="polite"
        layout={!reduce}
        initial={reduce ? false : { y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={
          reduce
            ? { duration: 0 }
            : { type: "spring", stiffness: 320, damping: 30 }
        }
        className={[
          "relative w-full overflow-visible text-white",
          stacked ? "rounded-none" : "sm:rounded-b-xl",
        ].join(" ")}
        style={{ ...shellStyle, willChange: reduce ? undefined : "transform, opacity" }}
      >
        <Shimmer active={shimmerOn && !reduce} />

        <div
          className={[
            "relative z-[1] mx-auto w-full max-w-[1120px] px-4",
            compact ? "py-2" : "py-3",
            row || split ? "flex items-center gap-4" : "",
          ].join(" ")}
        >
          <div className={`min-w-0 ${row || split ? "flex-1" : ""}`}>
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-white/15">
                <Icon size={16} strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="whitespace-normal text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">
                  {status}
                </p>
                <p className="mt-0.5 whitespace-normal text-[17px] font-bold tabular-nums leading-snug [overflow-wrap:anywhere]">
                  {hero}
                </p>
                {prompt.courseTitle && !compact ? (
                  <p className="mt-0.5 line-clamp-2 whitespace-normal text-[13px] leading-snug text-white/70 [overflow-wrap:anywhere]">
                    {prompt.courseTitle}
                  </p>
                ) : null}
              </div>
              {toneKey === "expiring" && onDismiss ? (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="grid size-11 shrink-0 place-items-center rounded-xl text-white/80 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  aria-label="Dismiss for 24 hours"
                >
                  <X size={18} />
                </button>
              ) : null}
            </div>
          </div>

          <div className={`flex gap-2 ${stacked ? "mt-3 w-full" : "shrink-0"}`}>{actions}</div>
        </div>

        {pct != null ? (
          <div className="relative z-[1] h-0.5 w-full bg-black/20" aria-hidden>
            <motion.div
              className="h-full origin-left"
              style={{ background: tone.progress, willChange: "transform" }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: pct / 100 }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 200, damping: 28 }}
            />
          </div>
        ) : (
          <div className="h-0.5 w-full bg-black/10" aria-hidden />
        )}
      </motion.div>
    </div>
  );
}
