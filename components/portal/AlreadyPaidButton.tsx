"use client";

import { requestInstallmentProofUpload } from "@/components/portal/access/ippEvents";

/** Course-card entry point into the shared installment proof upload sheet. */
export default function AlreadyPaidButton({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => requestInstallmentProofUpload()}
      className={`min-h-[44px] text-sm font-semibold text-primary underline-offset-2 hover:underline active:scale-[0.98] ${className}`}
    >
      I&apos;ve already paid
    </button>
  );
}
