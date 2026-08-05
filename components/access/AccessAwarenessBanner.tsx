import Link from "next/link";
import { Clock } from "lucide-react";
import { formatINR } from "@/lib/dates";
import { formatAwarenessDate, type AccessAwarenessBanner } from "@/lib/accessAwarenessTypes";
import { formatInstalmentLabel } from "@/lib/installmentNoticeCopy";

export type { AccessAwarenessBanner };

interface Props {
  banner: AccessAwarenessBanner;
  /** Compact strip for layout shells; default card for page bodies. */
  compact?: boolean;
  className?: string;
}

/**
 * Legacy Stage-4 awareness (non-flag phones only). Flag-scoped students use the
 * pinned InstallmentAccess bar instead — never both.
 * Data must come from accessAwarenessForEnrollment / lectureAccessForCourse.
 */
export default function AccessAwarenessBanner({ banner, compact, className = "" }: Props) {
  const isGrace = banner.variant === "grace";
  const shell = isGrace
    ? "border-amber-200 bg-amber-50/90 text-amber-950"
    : "border-[color-mix(in_srgb,var(--gold)_55%,transparent)] bg-[var(--gold-soft)] text-[var(--navy,#0a1f44)]";
  const iconTone = isGrace ? "text-amber-700" : "text-[var(--gold)]";
  const btnCls = "btn btn-primary text-sm";

  const headline = isGrace
    ? banner.liveAccessAllowed
      ? "Installment due — complete payment to keep uninterrupted access"
      : "Grace period — complete your pending installment"
    : banner.liveAccessAllowed
      ? "Payment overdue — lectures stay open via extension"
      : "Access paused — complete your pending installment";

  const installmentText =
    banner.installmentNo != null
      ? formatInstalmentLabel(banner.installmentNo, banner.installmentLabel)
      : null;

  const graceLine =
    banner.graceEndsAt && banner.graceDaysLeft != null
      ? banner.graceDaysLeft > 0
        ? `Grace ends ${formatAwarenessDate(banner.graceEndsAt)} (${banner.graceDaysLeft} day${banner.graceDaysLeft === 1 ? "" : "s"} left)`
        : `Grace ended ${formatAwarenessDate(banner.graceEndsAt)}`
      : null;

  const extensionLine = banner.extensionExpiresAt
    ? `Extension active until ${formatAwarenessDate(banner.extensionExpiresAt)}${
        banner.extensionDaysLeft != null && banner.extensionDaysLeft > 0
          ? ` (${banner.extensionDaysLeft} day${banner.extensionDaysLeft === 1 ? "" : "s"} left)`
          : ""
      }`
    : null;

  if (compact) {
    return (
      <div className={`rounded-xl border px-4 py-3 text-sm ${shell} ${className}`} role="status">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <Clock size={18} className={`mt-0.5 shrink-0 ${iconTone}`} aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold leading-snug">{headline}</p>
              <p className="mt-0.5 text-xs opacity-90">
                <span className="tabular-nums font-bold">{formatINR(banner.amountDue)}</span> due
                {installmentText ? ` · ${installmentText}` : ""}
                {graceLine ? ` · ${graceLine}` : ""}
                {extensionLine ? ` · ${extensionLine}` : ""}
              </p>
              <p className="mt-0.5 text-[11px] opacity-75">{banner.courseTitle}</p>
            </div>
          </div>
          <Link href={banner.payHref} className={`${btnCls} shrink-0 whitespace-nowrap`}>
            Pay now
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border p-5 ${shell} ${className}`} role="status">
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/60 ${iconTone}`}>
          <Clock size={20} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-base font-bold leading-snug">{headline}</p>
          <p className="mt-1 text-sm opacity-90">
            <span className="tabular-nums font-semibold">{formatINR(banner.amountDue)}</span> due for{" "}
            <span className="font-medium">{banner.courseTitle}</span>
            {installmentText ? <> · {installmentText}</> : null}
          </p>
          {graceLine && <p className="mt-1 text-xs opacity-85">{graceLine}</p>}
          {extensionLine && <p className="mt-1 text-xs font-medium opacity-90">{extensionLine}</p>}
          {!banner.liveAccessAllowed && (
            <p className="mt-1 text-xs opacity-80">Your progress is saved — pay to resume lectures.</p>
          )}
          <Link href={banner.payHref} className={`${btnCls} mt-4 inline-flex`}>
            Pay pending installment
          </Link>
        </div>
      </div>
    </div>
  );
}
