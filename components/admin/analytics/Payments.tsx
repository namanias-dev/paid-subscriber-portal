"use client";

import { useEffect, useState } from "react";
import { LoadingBlock } from "@/components/admin/ui";
import { METRICS } from "@/lib/analytics/metrics";
import { Stat, SectionCard, EmptyState, nf, pctStr } from "./Shared";
import { formatINR } from "@/lib/dates";

interface Intel {
  statusCounts: { initiated: number; paid: number; failed: number; abandoned: number; verifying: number; pending: number };
  revenue: number; paidStudents: number; paidTransactions: number;
  proofUploaded: number; adminApproved: number; adminApprovedAmount: number;
  revenueRecoveredViaProof: number; recoveryRate: number | null; amountStuckVerifying: number; duplicateAttempts: number;
}

const STATUS_TONE: Record<string, string> = { paid: "text-success", verifying: "text-warning", failed: "text-danger", abandoned: "text-danger", pending: "text-ink2", initiated: "text-ink" };

export default function PaymentsTab({ qs }: { qs: string }) {
  const [data, setData] = useState<Intel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analytics/payments?${qs}`).then((r) => r.json())
      .then((d) => setData(d.ok ? d.intelligence : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [qs]);

  if (loading) return <div className="space-y-4"><LoadingBlock /></div>;
  if (!data) return <SectionCard title="Payment intelligence"><EmptyState>No payments in this range yet.</EmptyState></SectionCard>;
  const s = data.statusCounts;

  return (
    <div className="space-y-4">
      <SectionCard title="Status breakdown">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {([["initiated", "Initiated"], ["paid", "Paid"], ["verifying", "Verifying"], ["pending", "Pending"], ["failed", "Failed"], ["abandoned", "Abandoned"]] as const).map(([k, label]) => (
            <div key={k} className="rounded-xl border border-line bg-surface2/40 p-3 text-center">
              <p className={`font-heading text-xl font-extrabold ${STATUS_TONE[k] || "text-ink"}`}>{nf((s as Record<string, number>)[k])}</p>
              <p className="mt-0.5 text-xs text-muted">{label}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat def={METRICS.revenue} value={formatINR(data.revenue)} hint={`${nf(data.paidStudents)} students · ${nf(data.paidTransactions)} txns`} tone="green" />
        <Stat def={METRICS.adminApproved} value={nf(data.adminApproved)} hint={formatINR(data.adminApprovedAmount)} />
        <Stat def={METRICS.revenueRecoveredViaProof} value={formatINR(data.revenueRecoveredViaProof)} hint={`${nf(data.proofUploaded)} proofs uploaded`} tone="green" />
        <Stat def={METRICS.recoveryRate} value={pctStr(data.recoveryRate)} />
        <Stat def={METRICS.verifyingAmount} value={formatINR(data.amountStuckVerifying)} tone="amber" />
        <Stat def={METRICS.proofUploaded} value={nf(data.proofUploaded)} />
        <Stat def={METRICS.duplicateAttempts} value={nf(data.duplicateAttempts)} tone={data.duplicateAttempts > 0 ? "amber" : undefined} />
        <Stat def={METRICS.paidStudents} value={nf(data.paidStudents)} tone="green" />
      </div>
    </div>
  );
}
