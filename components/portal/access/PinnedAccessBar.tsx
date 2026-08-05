"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Pause, X } from "lucide-react";
import { formatINR } from "@/lib/dates";
import type { InstallmentProofPromptProps } from "@/lib/installmentProofTypes";
import { formatInstalmentLabel } from "@/lib/installmentNoticeCopy";
import { requestInstallmentProofUpload, requestInstallmentProofView } from "./ippEvents";
import { useInstallmentAccess } from "./InstallmentAccessShell";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Prefer full label; fall back to short form — never bare "Paid". */
const ALREADY_PAID_FULL = "I've already paid";
const ALREADY_PAID_SHORT = "Already paid";

export default function PinnedAccessBar({ prompt }: { prompt: InstallmentProofPromptProps }) {
  const { snoozeExpiring } = useInstallmentAccess();
  const [compact, setCompact] = useState(false);
  const [entered, setEntered] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [useShortPaid, setUseShortPaid] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const paidBtnRef = useRef<HTMLButtonElement>(null);
  const lastY = useRef(0);
  const spacerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    const t = window.setTimeout(() => setEntered(true), reduceMotion ? 0 : 120);
    return () => window.clearTimeout(t);
  }, [reduceMotion]);

  // Reserve layout height = measured bar — content pushed, zero CLS.
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
  }, [compact, prompt.state, entered, useShortPaid]);

  // If full "I've already paid" overflows its equal-width cell at ~360px, use "Already paid".
  useEffect(() => {
    const btn = paidBtnRef.current;
    if (!btn || prompt.state === "pending_review") return;
    const measure = () => {
      // Reset to full, then check overflow.
      setUseShortPaid(false);
      requestAnimationFrame(() => {
        const el = paidBtnRef.current;
        if (!el) return;
        setUseShortPaid(el.scrollWidth > el.clientWidth + 1);
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [prompt.state, compact]);

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
  const instShort = `Inst ${prompt.installmentNo}`;
  const amount = formatINR(prompt.amountDue);
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

  // Primary line — never ellipsised. Course name only on ≥640px.
  let primary = "";
  if (state === "blocked") {
    primary = `Access paused · ${amount} · ${instalment}`;
  } else if (state === "pending_review") {
    primary = "Payment proof under review — we'll restore access shortly";
  } else {
    primary = days
      ? `Access active for ${days} · ${instalment} of ${amount} due`
      : `Access active · ${instalment} of ${amount} due`;
  }

  const compactPrimary =
    state === "blocked"
      ? `${amount} · ${instShort}`
      : state === "pending_review"
        ? "Proof under review"
        : days
          ? `${amount} · ${instShort}`
          : `${amount} · ${instShort}`;

  const goPay = () => {
    window.location.href = prompt.payHref;
  };

  const paidLabel = useShortPaid ? ALREADY_PAID_SHORT : ALREADY_PAID_FULL;
  // Compact = reduced vertical padding only; layout stays two-row on mobile (never ellipsis amount/actions).
  const isCompact = compact;
  // Mobile course name: only when short enough to sit cleanly on a second line; else drop.
  const mobileCourse =
    prompt.courseTitle && prompt.courseTitle.trim().length > 0 && prompt.courseTitle.trim().length <= 32
      ? prompt.courseTitle.trim()
      : null;

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
          "pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]",
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
        {/* ——— Mobile (<640): two rows, no truncation ——— */}
        <div className={`container-wide sm:hidden ${isCompact ? "py-1.5" : "py-2.5"}`}>
          <div className="flex items-start gap-2">
            <span
              className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/70 text-[var(--navy,#0a1f44)]"
              aria-hidden
            >
              <Icon size={14} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="whitespace-normal break-words text-[13px] font-medium leading-snug [overflow-wrap:anywhere]">
                <span className="tabular-nums font-bold">{isCompact ? compactPrimary : primary}</span>
              </p>
              {!isCompact && mobileCourse && state !== "pending_review" ? (
                <p className="mt-0.5 whitespace-normal text-[11px] font-medium leading-snug opacity-75">
                  {mobileCourse}
                </p>
              ) : null}
            </div>
            {state === "expiring" && (
              <button
                type="button"
                onClick={snoozeExpiring}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-current/70 transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                aria-label="Dismiss for 24 hours"
              >
                <X size={18} />
              </button>
            )}
          </div>

          {state === "pending_review" ? (
            <button
              type="button"
              onClick={() => requestInstallmentProofView()}
              className="btn btn-secondary mt-2 flex min-h-[44px] w-full items-center justify-center text-sm active:scale-[0.98]"
            >
              View what I sent
            </button>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={goPay}
                className="btn btn-primary flex min-h-[44px] w-full items-center justify-center px-2 text-sm active:scale-[0.98]"
              >
                Pay now
              </button>
              <button
                ref={paidBtnRef}
                type="button"
                onClick={() => requestInstallmentProofUpload()}
                className="btn btn-secondary flex min-h-[44px] w-full items-center justify-center px-2 text-sm active:scale-[0.98]"
                aria-label={ALREADY_PAID_FULL}
              >
                <span className="whitespace-nowrap">{paidLabel}</span>
              </button>
            </div>
          )}
        </div>

        {/* ——— Desktop (≥640): one row ——— */}
        <div
          className={`container-wide hidden items-center gap-3 sm:flex ${
            isCompact ? "min-h-[40px] py-1.5" : "min-h-[48px] py-2"
          }`}
        >
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/70 text-[var(--navy,#0a1f44)]"
            aria-hidden
          >
            <Icon size={16} strokeWidth={1.75} />
          </span>
          <p className="min-w-0 flex-1 whitespace-normal text-sm font-medium leading-snug">
            <span className="tabular-nums font-bold">{primary}</span>
            {state !== "pending_review" && prompt.courseTitle ? (
              <span className="font-medium opacity-80"> · {prompt.courseTitle}</span>
            ) : null}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {state === "pending_review" ? (
              <button
                type="button"
                onClick={() => requestInstallmentProofView()}
                className="btn btn-secondary min-h-[44px] px-3 text-sm active:scale-[0.98]"
              >
                View what I sent
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goPay}
                  className="btn btn-primary min-h-[44px] px-3 text-sm active:scale-[0.98]"
                >
                  Pay now
                </button>
                <button
                  type="button"
                  onClick={() => requestInstallmentProofUpload()}
                  className="btn btn-secondary min-h-[44px] px-3 text-sm active:scale-[0.98]"
                  aria-label={ALREADY_PAID_FULL}
                >
                  {ALREADY_PAID_FULL}
                </button>
              </>
            )}
            {state === "expiring" && (
              <button
                type="button"
                onClick={snoozeExpiring}
                className="grid h-11 w-11 place-items-center rounded-xl text-current/70 transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
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
