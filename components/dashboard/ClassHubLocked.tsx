"use client";

import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import ContentLockSheet from "@/components/portal/access/ContentLockSheet";

/**
 * Locked control: greyed, lock glyph, no href leak. Tap opens soft lock sheet.
 * Access decision must come from lectureAccessForCourse (SoT) — never recompute here.
 */
export function LockedAction({
  label,
  installmentNo,
  payHref,
  className = "",
  staggerIndex = 0,
}: {
  label: string;
  installmentNo: number | null;
  payHref: string;
  className?: string;
  staggerIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  const delay = Math.min(staggerIndex, 3) * 40;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${label} (locked)`}
        className={`inline-flex min-h-[44px] cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-line bg-slate-100 px-4 text-sm font-semibold text-slate-500 opacity-80 transition-opacity duration-300 motion-reduce:transition-none ${className}`}
        style={{ animationDelay: `${delay}ms` }}
      >
        <Lock size={16} aria-hidden />
        {label}
      </button>
      <ContentLockSheet
        open={open}
        onClose={() => setOpen(false)}
        installmentNo={installmentNo}
        payHref={payHref}
      />
    </>
  );
}

export function LockedCard({
  children,
  installmentNo,
  payHref,
  staggerIndex = 0,
}: {
  children: ReactNode;
  installmentNo: number | null;
  payHref: string;
  staggerIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  const delay = Math.min(staggerIndex, 3) * 40;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative w-full cursor-not-allowed text-left opacity-60 transition-opacity duration-300 motion-reduce:transition-none"
        style={{ animationDelay: `${delay}ms` }}
        aria-label="Locked content"
      >
        <span className="pointer-events-none block grayscale">{children}</span>
        <span className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-slate-600 shadow-sm">
          <Lock size={14} aria-hidden />
        </span>
      </button>
      <ContentLockSheet
        open={open}
        onClose={() => setOpen(false)}
        installmentNo={installmentNo}
        payHref={payHref}
      />
    </>
  );
}
