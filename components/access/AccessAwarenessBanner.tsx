import Link from "next/link";
import { AlertCircle, Clock } from "lucide-react";
import { formatINR } from "@/lib/dates";
import { formatAwarenessDate, type AccessAwarenessBanner } from "@/lib/accessAwarenessTypes";

export type { AccessAwarenessBanner };

interface Props {
  banner: AccessAwarenessBanner;
  /** Compact strip for layout shells; default card for page bodies. */
  compact?: boolean;
  className?: string;
}

/**
 * Non-hostile access awareness — amount due, instalment, pay link, extension expiry.
 * Data must come from accessAwarenessForEnrollment / lectureAccessForCourse.
 */
export default function AccessAwarenessBanner({ banner, compact, className = "" }: Props) {
  const isGrace = banner.variant === "grace";
  const shell = isGrace
    ? "border-amber-200 bg-amber-50/90 text-amber-950"
    : "border-rose-200 bg-rose-50/90 text-rose-950";
  const iconTone = isGrace ? "text-amber-700" : "text-rose-700";
  const btnCls = isGrace ? "btn btn-primary text-sm" : "btn btn-primary text-sm";

  const headline = isGrace
    ? banner.liveAccessAllowed
      ? "Installment due — complete payment to keep uninterrupted access"
      : "Grace period — complete your pending installment"
    : banner.liveAccessAllowed
      ? "Payment overdue — lectures stay open via extension"
      : "Access paused — complete your pending installment";

  const installmentText = banner.installmentNo != null
    ? `Installment ${banner.installmentNo}${banner.installmentLabel ? ` · ${banner.installmentLabel.replace(/ of \d+/, "")}` : ""}`
    : null;

  const graceLine = banner.graceEndsAt && banner.graceDaysLeft != null
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
            <AlertCircle size={18} className={`mt-0.5 shrink-0 ${iconTone}`} aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold leading-snug">{headline}</p>
              <p className="mt-0.5 text-xs opacity-90">
                {formatINR(banner.amountDue)} due
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
          {isGrace ? <Clock size={20} aria-hidden /> : <AlertCircle size={20} aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-base font-bold leading-snug">{headline}</p>
          <p className="mt-1 text-sm opacity-90">
            <span className="font-semibold">{formatINR(banner.amountDue)}</span> due for{" "}
            <span className="font-medium">{banner.courseTitle}</span>
            {installmentText ? <> · {installmentText}</> : null}
          </p>
          {graceLine && <p className="mt-1 text-xs opacity-85">{graceLine}</p>}
          {extensionLine && (
            <p className="mt-1 text-xs font-medium opacity-90">
              {extensionLine}
            </p>
          )}
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
