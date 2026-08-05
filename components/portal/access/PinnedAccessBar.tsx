"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Pause, X } from "lucide-react";
import { formatINR } from "@/lib/dates";
import type { InstallmentProofPromptProps } from "@/lib/installmentProofTypes";
import { formatInstalmentLabel, shortCourseTitle } from "@/lib/installmentNoticeCopy";
import { requestInstallmentProofUpload, requestInstallmentProofView } from "./ippEvents";
import { useInstallmentAccess } from "./InstallmentAccessShell";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export default function PinnedAccessBar({ prompt }: { prompt: InstallmentProofPromptProps }) {
  const { snoozeExpiring } = useInstallmentAccess();
  const [compact, setCompact] = useState(false);
  const [entered, setEntered] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const lastY = useRef(0);
  const spacerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    const t = window.setTimeout(() => setEntered(true), reduceMotion ? 0 : 120);
    return () => window.clearTimeout(t);
  }, [reduceMotion]);

  // Offset page content by measured bar height — no CLS jump.
  useEffect(() => {
    const el = barRef.current;
    const spacer = spacerRef.current;
    if (!el || !spacer) return;
    const sync = () => {
      spacer.style.height = `${el.offsetHeight}px`;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact, prompt.state, entered]);

  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY.current;
      if (y < 80) setCompact(false);
      else if (delta > 8 && y > 200) setCompact(true);
      else if (delta < -8) setCompact(false);
      lastY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const state = prompt.state;
  const instalment = formatInstalmentLabel(prompt.installmentNo);
  const course = shortCourseTitle(prompt.courseTitle);
  const days =
    prompt.daysLeft != null && prompt.daysLeft >= 0
      ? prompt.daysLeft === 1
        ? "1 more day"
        : `${prompt.daysLeft} more days`
      : null;

  const tone =
    state === "blocked"
      ? {
          shell: "border-[color-mix(in_srgb,var(--gold)_55%,transparent)] bg-[var(--gold-soft)] text-[var(--navy,#0a1f44)]",
          Icon: Pause,
        }
      : state === "pending_review"
        ? {
            shell: "border-slate-200 bg-slate-100 text-slate-800",
            Icon: Clock,
          }
        : {
            shell: "border-sky-200/80 bg-sky-50 text-sky-950",
            Icon: Clock,
          };

  const Icon = tone.Icon;

  let line = "";
  if (state === "blocked") {
    line = `Access paused · ${formatINR(prompt.amountDue)} · ${instalment} · ${course}`;
  } else if (state === "pending_review") {
    line = "Payment proof under review — we'll restore access shortly";
  } else {
    line = days
      ? `Access active for ${days} · ${instalment} of ${formatINR(prompt.amountDue)} due`
      : `Access active · ${instalment} of ${formatINR(prompt.amountDue)} due`;
  }

  const compactLine =
    state === "blocked"
      ? `Access paused · ${formatINR(prompt.amountDue)}`
      : state === "pending_review"
        ? "Proof under review"
        : days
          ? `Active ${days} · ${formatINR(prompt.amountDue)} due`
          : `${formatINR(prompt.amountDue)} due`;

  const goPay = () => {
    window.location.href = prompt.payHref;
  };

  return (
    <>
      <div
        ref={spacerRef}
        aria-hidden
        className="pointer-events-none shrink-0 md:hidden"
        style={{ height: 0 }}
      />
      <div
        ref={barRef}
        role="status"
        aria-live="polite"
        className={[
          "fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-40 w-full border-b shadow-[0_8px_24px_-16px_rgba(10,31,68,0.35)] md:sticky md:!top-14",
          tone.shell,
          reduceMotion ? "" : "transition-[transform,opacity] duration-200",
          entered || reduceMotion ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
        ].join(" ")}
        style={
          reduceMotion
            ? undefined
            : { transitionTimingFunction: EASE, transitionDuration: entered ? "240ms" : "200ms" }
        }
      >
        <div
          className={`container-wide flex items-center gap-2 ${
            compact ? "min-h-[40px] py-1.5" : "min-h-[52px] py-2 sm:min-h-[48px]"
          }`}
        >
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/70 text-[var(--navy,#0a1f44)]"
            aria-hidden
          >
            <Icon size={16} strokeWidth={1.75} />
          </span>

          <p
            className={`min-w-0 flex-1 font-medium leading-snug ${
              compact ? "truncate text-xs sm:text-sm" : "line-clamp-2 text-xs sm:line-clamp-1 sm:text-sm"
            }`}
          >
            <span className="tabular-nums font-bold">{compact ? compactLine : line}</span>
          </p>

          <div className="flex shrink-0 items-center gap-1.5">
            {state === "pending_review" ? (
              <button
                type="button"
                onClick={() => requestInstallmentProofView()}
                className="btn btn-secondary min-h-[44px] px-3 text-xs sm:text-sm active:scale-[0.98]"
              >
                View what I sent
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goPay}
                  className="btn btn-primary min-h-[44px] px-3 text-xs sm:text-sm active:scale-[0.98]"
                >
                  Pay now
                </button>
                <button
                  type="button"
                  onClick={() => requestInstallmentProofUpload()}
                  className="btn btn-secondary min-h-[44px] hidden px-3 text-xs sm:inline-flex sm:text-sm active:scale-[0.98] xs:inline-flex"
                >
                  I&apos;ve already paid
                </button>
                <button
                  type="button"
                  onClick={() => requestInstallmentProofUpload()}
                  className="btn btn-secondary min-h-[44px] px-2.5 text-xs sm:hidden active:scale-[0.98]"
                  aria-label="I've already paid"
                >
                  Paid
                </button>
              </>
            )}
            {state === "expiring" && (
              <button
                type="button"
                onClick={snoozeExpiring}
                className="grid h-11 w-11 place-items-center rounded-xl text-current/70 transition hover:bg-black/5 hover:text-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                aria-label="Dismiss for 24 hours"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
