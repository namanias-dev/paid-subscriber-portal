import { formatINR } from "@/lib/dates";
import type { AccessRiskSummaryData } from "@/lib/accessRiskSummary";

export type { AccessRiskSummaryData };

interface Props {
  summary: AccessRiskSummaryData;
}

const TIER_LABEL: Record<string, string> = {
  seat: "Seat",
  emi: "EMI",
  full: "Full pay",
  unknown: "Other",
};

/**
 * Staff snapshot for Access at Risk — blocked · grace · extensions · ₹ by tier · reminders today.
 */
export default function AccessRiskSummary({ summary }: Props) {
  const tiers = Object.entries(summary.outstandingByTier)
    .filter(([, amt]) => amt > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="mb-4 rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Access snapshot</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat label="Blocked" value={summary.blockedCount} tone="text-danger" />
        <MiniStat label="In grace" value={summary.graceCount} tone="text-amber-600" />
        <MiniStat label="Active extensions" value={summary.activeExtensions} tone="text-primary" />
        <MiniStat label="Reminders today" value={summary.remindersSentToday} tone="text-ink" />
        <MiniStat label="Total outstanding" value={formatINR(summary.totalOutstanding)} tone="text-primary" wide />
      </div>
      {tiers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line/60 pt-3 text-xs text-ink2">
          <span className="font-semibold text-muted">Outstanding by tier:</span>
          {tiers.map(([tier, amt]) => (
            <span key={tier} className="pill pill-gray tabular-nums">
              {TIER_LABEL[tier] || tier} {formatINR(amt)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
  wide,
}: {
  label: string;
  value: string | number;
  tone: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-1" : undefined}>
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`mt-0.5 font-heading text-xl font-extrabold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
