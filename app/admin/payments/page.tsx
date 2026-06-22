"use client";

import { PageHeader, useAdminData, LoadingBlock, TableShell, KpiCard } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { formatINR, formatDate } from "@/lib/dates";
import type { Payment, Enrollment } from "@/lib/types";

export default function PaymentsAdmin() {
  const full = useAdminData<Payment[]>("/api/admin/payments", "payments");
  const enr = useAdminData<Enrollment[]>("/api/admin/payments", "enrollments");
  const codes = useAdminData<Record<string, string>>("/api/admin/payments", "buyerCodes");
  const { toast } = useToast();

  if (full.loading || enr.loading) return <LoadingBlock />;

  const payments = full.data || [];
  const enrollments = enr.data || [];
  const buyerCodes = codes.data || {};
  const isPaid = (s: Payment["status"]) => s === "captured" || s === "PAID";
  const captured = payments.filter((p) => isPaid(p.status)).reduce((a, p) => a + p.amount, 0);
  const refunded = payments.filter((p) => p.status === "refunded").reduce((a, p) => a + p.amount, 0);
  const pending = enrollments.reduce((a, e) => a + (e.pending || 0), 0);

  const statusPill = (s: Payment["status"]) =>
    isPaid(s) ? "pill-green" : s === "pending" || s === "PENDING" ? "pill-amber" : s === "FAILED" ? "pill-red" : "pill-red";

  function exportCsv() {
    const rows = [["Student", "Phone", "Item", "Amount", "Login Code", "Status", "Date"], ...payments.map((p) => [p.student_name, p.phone, p.item, String(p.amount), buyerCodes[(p.phone || "").trim()] || "", p.status, p.created_at.slice(0, 10)])];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "payments.csv"; a.click();
    URL.revokeObjectURL(url);
    toast("Exported payments.csv", "success");
  }

  return (
    <div>
      <PageHeader title="Payments & Finance" subtitle="Razorpay transactions, revenue & collections" action={<button onClick={exportCsv} className="btn btn-secondary text-sm">⬇ Export</button>} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Captured" value={formatINR(captured)} tone="green" />
        <KpiCard label="Pending Collections" value={formatINR(pending)} tone="red" />
        <KpiCard label="Refunded" value={formatINR(refunded)} tone="amber" />
        <KpiCard label="Transactions" value={payments.length} />
      </div>

      <TableShell headers={["Student", "Phone", "Item", "Amount", "Reference / Gateway", "Login Code", "Status", "Date"]}>
        {payments.map((p) => (
          <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{p.student_name}</td>
            <td className="px-4 py-3">{p.phone}</td>
            <td className="px-4 py-3 text-xs">{p.item}</td>
            <td className="px-4 py-3">{formatINR(p.amount)}</td>
            <td className="px-4 py-3 text-xs">
              {p.reference_no ? <span className="font-mono">{p.reference_no}</span> : <span className="text-muted">{p.razorpay_payment_id || "—"}</span>}
              <div className="text-muted">{p.gateway || (p.mode ? `Razorpay · ${p.mode}` : "")}</div>
            </td>
            <td className="px-4 py-3">
              {buyerCodes[(p.phone || "").trim()] ? (
                <span className="font-mono text-xs font-semibold text-primary">{buyerCodes[(p.phone || "").trim()]}</span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </td>
            <td className="px-4 py-3"><span className={`pill ${statusPill(p.status)}`}>{p.status}</span></td>
            <td className="px-4 py-3">{formatDate(p.created_at)}</td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}
