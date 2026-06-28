"use client";

import { useEffect, useState } from "react";
import { formatISTDateTime } from "@/lib/dates";
import type { PaymentActionLog, StaffAccountabilityRow } from "@/lib/types";

interface Report {
  rows: StaffAccountabilityRow[];
  recent: PaymentActionLog[];
  totals: { uploads: number; approvals: number; reversals: number; rejections: number };
}

const ACTION_META: Record<string, { label: string; cls: string }> = {
  proof_upload: { label: "Uploaded proof", cls: "pill-blue" },
  approve: { label: "Approved", cls: "pill-green" },
  reverse: { label: "Reversed", cls: "pill-red" },
  reject: { label: "Rejected", cls: "pill-amber" },
  reupload_request: { label: "Reupload asked", cls: "pill-amber" },
  note: { label: "Note", cls: "pill-gray" },
};

/**
 * Super-admin-only accountability report: per-staff counts of proof uploads,
 * approvals, reversals + a recent-activity drill-down. Collapsible so it stays
 * out of the way until needed. Rendered only when the viewer is a Super Admin.
 */
export default function PaymentAccountability() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<string | null>(null);

  useEffect(() => {
    if (!open || report) return;
    setLoading(true);
    fetch("/api/admin/payments/accountability")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setReport({ rows: j.rows, recent: j.recent, totals: j.totals });
        else setError(j.error || "Could not load the report.");
      })
      .catch(() => setError("Could not load the report."))
      .finally(() => setLoading(false));
  }, [open, report]);

  const recentFor = (actorId: string) => (report?.recent || []).filter((l) => (l.actor_id || "unknown") === actorId);

  return (
    <div className="card mb-4 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-base">🛡️</span>
          <span>
            <span className="block text-sm font-semibold text-ink">Staff accountability (Super Admin)</span>
            <span className="block text-xs text-muted">Who uploaded proof / approved / reversed payments</span>
          </span>
        </span>
        <span className="text-xs font-semibold text-primary">{open ? "Hide" : "View"}</span>
      </button>

      {open && (
        <div className="border-t border-line p-4">
          {loading && <p className="text-sm text-muted">Loading…</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
          {report && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Proof uploads" value={report.totals.uploads} />
                <Stat label="Approvals" value={report.totals.approvals} />
                <Stat label="Reversals" value={report.totals.reversals} tone="red" />
                <Stat label="Rejections" value={report.totals.rejections} />
              </div>

              {report.rows.length === 0 ? (
                <p className="text-sm text-muted">No staff actions recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                        <th className="py-2 pr-3">Staff</th>
                        <th className="px-3 py-2 text-right">Uploads</th>
                        <th className="px-3 py-2 text-right">Approvals</th>
                        <th className="px-3 py-2 text-right">Reversals</th>
                        <th className="px-3 py-2 text-right">Rejections</th>
                        <th className="px-3 py-2">Last action</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((r) => (
                        <RowGroup
                          key={r.actor_id}
                          row={r}
                          open={drill === r.actor_id}
                          onToggle={() => setDrill((d) => (d === r.actor_id ? null : r.actor_id))}
                          recent={recentFor(r.actor_id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "red" }) {
  return (
    <div className="rounded-lg bg-surface2 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-0.5 text-2xl font-extrabold tabular-nums ${tone === "red" ? "text-danger" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function RowGroup({
  row,
  open,
  onToggle,
  recent,
}: {
  row: StaffAccountabilityRow;
  open: boolean;
  onToggle: () => void;
  recent: PaymentActionLog[];
}) {
  return (
    <>
      <tr className="border-b border-line/60">
        <td className="py-2 pr-3">
          <span className="font-medium text-ink">{row.actor_name || row.actor_id}</span>
          {row.actor_role && <span className="ml-1 text-xs text-muted">· {row.actor_role}</span>}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{row.uploads}</td>
        <td className="px-3 py-2 text-right tabular-nums">{row.approvals}</td>
        <td className={`px-3 py-2 text-right tabular-nums ${row.reversals ? "font-semibold text-danger" : ""}`}>{row.reversals}</td>
        <td className="px-3 py-2 text-right tabular-nums">{row.rejections}</td>
        <td className="px-3 py-2 text-xs text-muted">{row.last_action_at ? formatISTDateTime(row.last_action_at) : "—"}</td>
        <td className="px-3 py-2 text-right">
          <button onClick={onToggle} className="text-xs font-semibold text-primary hover:underline">
            {open ? "Hide" : "Drill-down"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="bg-surface2/50 px-3 py-3">
            {recent.length === 0 ? (
              <p className="text-xs text-muted">No detailed entries.</p>
            ) : (
              <ul className="space-y-1.5">
                {recent.slice(0, 50).map((l) => {
                  const m = ACTION_META[l.action] || { label: l.action, cls: "pill-gray" };
                  return (
                    <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`pill ${m.cls}`}>{m.label}</span>
                      <span className="text-ink2">{l.phone || "—"}</span>
                      {l.reference_no && <span className="font-mono text-muted">{l.reference_no}</span>}
                      {(l.old_status || l.new_status) && (
                        <span className="text-muted">{l.old_status || "—"} → {l.new_status || "—"}</span>
                      )}
                      <span className="text-muted">· {formatISTDateTime(l.created_at)}</span>
                      {l.reason && <span className="w-full text-ink2">“{l.reason}”</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
