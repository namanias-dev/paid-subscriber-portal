"use client";

/**
 * Payment-abandoned recovery card. Uses REAL, human-safe status copy (never
 * "failed"; never claims a seat is confirmed unless truly PAID — that logic lives
 * server-side). Offers a safe way to resume the EXISTING payment flow.
 */
import type { PaymentRecoveryCardData } from "@/lib/ai-agent/providers/types";

export default function PaymentRecoveryCard({
  data,
  onResume,
}: {
  data: PaymentRecoveryCardData;
  onResume: (link: string | null) => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-heading text-sm font-bold text-ink">{data.itemTitle}</h4>
        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-muted">
          {data.itemType === "webinar" ? "Masterclass" : "Course"}
        </span>
      </div>
      <p className="mt-1 text-xs font-medium text-ink2">{data.statusLine}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink2">{data.message}</p>
      {data.resumeLink && (
        <button
          type="button"
          onClick={() => onResume(data.resumeLink)}
          className="btn btn-primary mt-3 h-9 w-full min-h-0 text-xs"
        >
          {data.resumeLabel}
        </button>
      )}
    </div>
  );
}
