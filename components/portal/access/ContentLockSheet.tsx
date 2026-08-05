"use client";

import { useEffect, useId, useRef } from "react";
import { Lock, X } from "lucide-react";
import { requestInstallmentProofUpload } from "./ippEvents";

/**
 * Soft lock sheet for gated Class Hub surfaces.
 * Mobile: bottom sheet · Desktop: centred modal.
 */
export default function ContentLockSheet({
  open,
  onClose,
  installmentNo,
  payHref,
}: {
  open: boolean;
  onClose: () => void;
  installmentNo: number | null;
  payHref: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button,a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  const n = installmentNo ?? 1;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-md rounded-t-2xl border border-line bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-600">
            <Lock size={18} aria-hidden />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-xl text-muted hover:bg-surface2"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <h2 id={titleId} className="mt-3 font-heading text-lg font-bold text-ink">
          This unlocks as soon as instalment {n} is cleared.
        </h2>
        <p className="mt-1 text-sm text-ink2">Pay online or share proof if you&apos;ve already transferred.</p>
        <div className="mt-5 flex flex-col gap-2">
          <a href={payHref} className="btn btn-primary min-h-[44px] w-full justify-center active:scale-[0.98]">
            Pay now
          </a>
          <button
            type="button"
            onClick={() => {
              onClose();
              requestInstallmentProofUpload();
            }}
            className="btn btn-secondary min-h-[44px] w-full justify-center active:scale-[0.98]"
          >
            I&apos;ve already paid
          </button>
        </div>
      </div>
    </div>
  );
}
