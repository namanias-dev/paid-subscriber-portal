"use client";

import { useEffect, useId, useRef } from "react";
import AccessNotice from "./AccessNotice";
import { requestInstallmentProofUpload } from "./ippEvents";
import type { InstallmentProofPromptProps } from "@/lib/installmentProofTypes";

/**
 * Soft lock sheet — uses AccessNotice sheetHeader + same action tokens.
 */
export default function ContentLockSheet({
  open,
  onClose,
  installmentNo,
  payHref,
  courseTitle = "Course",
  amountDue = 0,
}: {
  open: boolean;
  onClose: () => void;
  installmentNo: number | null;
  payHref: string;
  courseTitle?: string;
  amountDue?: number;
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
  const prompt: InstallmentProofPromptProps = {
    state: "blocked",
    enrollmentId: "lock-sheet",
    courseId: "",
    courseTitle,
    installmentNo: n,
    amountDue,
    dueDate: null,
    daysLeft: null,
    liveAccessAllowed: false,
    payHref,
    pendingProof: null,
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/45" aria-label="Close" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-md overflow-visible rounded-t-2xl sm:rounded-2xl"
      >
        <div className="mx-auto mb-0 h-1 w-10 rounded-full bg-white/40 sm:hidden" aria-hidden />
        <AccessNotice variant="sheetHeader" prompt={prompt} />
        <div className="space-y-2 bg-[#7F1D1D] px-4 pb-5 pt-3">
          <p id={titleId} className="sr-only">
            This unlocks as soon as instalment {n} is cleared.
          </p>
          <p className="text-sm text-white/90">
            This unlocks as soon as instalment {n} is cleared. Pay online or share proof if you&apos;ve already transferred.
          </p>
          <div className="flex flex-col gap-2 pt-1">
            <a
              href={payHref}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-3 text-sm font-semibold text-[#B91C1C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Pay now
            </a>
            <button
              type="button"
              onClick={() => {
                onClose();
                requestInstallmentProofUpload();
              }}
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/24 bg-white/14 px-3 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Already paid
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
