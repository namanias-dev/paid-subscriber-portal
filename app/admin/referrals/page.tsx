"use client";

import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { formatINR, formatDate } from "@/lib/dates";
import type { Referral } from "@/lib/types";

export default function ReferralsAdmin() {
  const { data: referrals, loading, reload } = useAdminData<Referral[]>("/api/admin/referrals", "referrals");
  const { toast } = useToast();

  async function pay(r: Referral) {
    await fetch("/api/admin/referrals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, patch: { payout_status: "paid" } }) });
    toast("Marked as paid", "success");
    reload();
  }

  if (loading) return <LoadingBlock />;

  const totalPayout = (referrals || []).filter((r) => r.payout_status === "paid").reduce((a, r) => a + r.tier, 0);

  return (
    <div>
      <PageHeader title="Referrals" subtitle={`Referral program · ₹${totalPayout.toLocaleString("en-IN")} paid out`} />
      <TableShell headers={["Referrer", "Phone", "Referee", "Tier", "Admitted", "Payout", ""]}>
        {(referrals || []).map((r) => (
          <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{r.referrer_name}</td>
            <td className="px-4 py-3">{r.referrer_phone}</td>
            <td className="px-4 py-3">{r.referee_name}</td>
            <td className="px-4 py-3">{formatINR(r.tier)}</td>
            <td className="px-4 py-3">{r.admitted ? <span className="pill pill-green">Yes</span> : <span className="pill pill-gray">No</span>}</td>
            <td className="px-4 py-3"><span className={`pill ${r.payout_status === "paid" ? "pill-green" : "pill-amber"}`}>{r.payout_status}</span></td>
            <td className="px-4 py-3">{r.admitted && r.payout_status === "pending" && <button onClick={() => pay(r)} className="text-primary text-xs">Mark paid</button>}</td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}
