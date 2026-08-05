"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { formatINR, formatISTDate } from "@/lib/dates";

type Row = {
  payment: {
    id: string;
    student_name: string;
    phone: string;
    amount: number;
    installment_no?: number | null;
    transaction_date?: string | null;
    created_at: string;
    gateway_ref?: string | null;
    recorded_by?: string | null;
    reference_no?: string | null;
    enrollment_id?: string | null;
  };
  proof: {
    id: string;
    files: Array<{ path: string; original_name: string }>;
    claimed_paid_date?: string | null;
    reference_utr?: string | null;
  } | null;
  ageMinutes: number;
};

function ageLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function ProofFinanceQueuePage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reverseFor, setReverseFor] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/installment-proofs?finance_queue=1");
      const json = await res.json();
      if (res.ok && json.ok) setRows((json.rows || []) as Row[]);
      else setRows([]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function verify(paymentId: string) {
    setBusyId(paymentId);
    const res = await fetch("/api/admin/installment-proofs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finance_verify", payment_id: paymentId }),
    });
    const json = await res.json().catch(() => ({}));
    setBusyId(null);
    if (res.ok && json.ok) {
      toast("Marked verified", "success");
      void load();
    } else toast(json.error || "Could not verify", "error");
  }

  async function reverse(paymentId: string) {
    const reason = reverseReason.trim();
    if (!reason) {
      toast("Typed reason required", "error");
      return;
    }
    setBusyId(paymentId);
    const res = await fetch("/api/admin/installment-proofs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reverse_proof_payment", payment_id: paymentId, reason }),
    });
    const json = await res.json().catch(() => ({}));
    setBusyId(null);
    if (res.ok && json.ok) {
      toast("Payment reversed (compensating entry)", "success");
      setReverseFor(null);
      setReverseReason("");
      void load();
    } else toast(json.error || "Could not reverse", "error");
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-extrabold text-ink">Proof payments — finance queue</h1>
          <p className="mt-1 text-sm text-muted">
            Student-proof recordings awaiting bank verification. Oldest first.
          </p>
        </div>
        <div className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
          {rows.length} awaiting
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">Queue empty — nothing to verify.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-surface2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Instalment</th>
                <th className="px-3 py-2">₹ recorded</th>
                <th className="px-3 py-2">Date / UTR</th>
                <th className="px-3 py-2">Proof</th>
                <th className="px-3 py-2">By</th>
                <th className="px-3 py-2">Age</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const utr =
                  r.proof?.reference_utr ||
                  (r.payment.gateway_ref?.match(/UTR\s+([^\s·]+)/i)?.[1] ?? "—");
                return (
                  <tr key={r.payment.id} className="border-t border-line align-top">
                    <td className="px-3 py-3">
                      <div className="font-semibold text-ink">{r.payment.student_name}</div>
                      <div className="text-xs text-muted">{r.payment.phone}</div>
                    </td>
                    <td className="px-3 py-3 tabular-nums">#{r.payment.installment_no ?? "—"}</td>
                    <td className="px-3 py-3 font-semibold tabular-nums">{formatINR(r.payment.amount)}</td>
                    <td className="px-3 py-3 text-xs">
                      <div>
                        {r.proof?.claimed_paid_date
                          ? formatISTDate(r.proof.claimed_paid_date)
                          : r.payment.transaction_date
                            ? formatISTDate(r.payment.transaction_date)
                            : "—"}
                      </div>
                      <div className="text-muted">UTR {utr}</div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {r.proof ? (
                        <Link
                          href={`/admin/access-risk?proof=${r.proof.id}`}
                          className="text-primary hover:underline"
                        >
                          {r.proof.files.length} file{r.proof.files.length === 1 ? "" : "s"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted">{r.payment.recorded_by || "—"}</td>
                    <td className="px-3 py-3 tabular-nums text-muted">{ageLabel(r.ageMinutes)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1.5 sm:flex-row">
                        <button
                          type="button"
                          disabled={busyId === r.payment.id}
                          onClick={() => void verify(r.payment.id)}
                          className="btn btn-primary text-xs"
                        >
                          Mark verified
                        </button>
                        <button
                          type="button"
                          disabled={busyId === r.payment.id}
                          onClick={() => {
                            setReverseFor(r.payment.id);
                            setReverseReason("");
                          }}
                          className="btn btn-secondary text-xs"
                        >
                          Reverse
                        </button>
                      </div>
                      {reverseFor === r.payment.id && (
                        <div className="mt-2 space-y-2 rounded-lg border border-danger/30 bg-danger/5 p-2">
                          <textarea
                            className="input w-full text-xs"
                            rows={2}
                            placeholder="Typed reason required"
                            value={reverseReason}
                            onChange={(e) => setReverseReason(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="btn btn-danger text-xs"
                              disabled={busyId === r.payment.id}
                              onClick={() => void reverse(r.payment.id)}
                            >
                              Confirm reverse
                            </button>
                            <button type="button" className="btn btn-secondary text-xs" onClick={() => setReverseFor(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
