"use client";

import { PageHeader, useAdminData, LoadingBlock, KpiCard } from "@/components/admin/ui";
import { formatISTDateTime } from "@/lib/dates";
import { leadStatusLabel, leadStatusPill } from "@/lib/leadStatus";

interface CrossTabRow {
  manual_status: string;
  manual_label: string;
  status: string;
  status_label: string;
  count: number;
}

interface NamedLead {
  id: string;
  name: string | null;
  phone: string | null;
  manual_status: string | null;
  status: string | null;
  manual_status_by: string | null;
  manual_status_at: string | null;
  behaviour_at?: string | null;
  gap_days?: number | null;
}

interface StaffRate {
  by: string;
  byRole: string | null;
  totalManual: number;
  flippedToBehaviour: number;
  rate: number;
  denominator: number;
}

interface DisparityReport {
  totalWithManual: number;
  crossTab: CrossTabRow[];
  negativeThenConverted: NamedLead[];
  perStaff: StaffRate[];
  reverse: NamedLead[];
  generatedAt: string;
}

function pct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export default function StatusDisparityPage() {
  const { data: report, loading } = useAdminData<DisparityReport>(
    "/api/admin/leads/disparity",
    "report",
  );

  if (loading) return <LoadingBlock />;
  if (!report) {
    return (
      <div>
        <PageHeader title="Status Disparity" subtitle="Manual verdict vs behaviour-driven status" />
        <p className="text-sm text-muted">No report data yet. Apply the behaviour-status migration first.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Status Disparity"
        subtitle={`Manual verdict vs system behaviour · ${report.totalWithManual.toLocaleString("en-IN")} leads with a preserved verdict`}
      />
      <p className="mb-4 text-xs text-muted">
        Generated {formatISTDateTime(report.generatedAt)}. Unmerged leads only. Behaviour ladder runs
        registration → seat → admission (system-verified stages).
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="With manual verdict" value={report.totalWithManual} />
        <KpiCard label="Negative → converted" value={report.negativeThenConverted.length} tone="green" />
        <KpiCard label="Positive, no behaviour" value={report.reverse.length} />
        <KpiCard label="Staff in report" value={report.perStaff.length} />
      </div>

      <section className="card mb-4 p-4">
        <h3 className="mb-1 text-sm font-semibold">Cross-tab · manual × displayed status</h3>
        <p className="mb-3 text-[11px] text-muted">Counts of unmerged leads where manual_status is set.</p>
        {report.crossTab.length === 0 ? (
          <p className="text-xs text-muted">No rows yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="px-2 py-1.5 font-semibold">Manual verdict</th>
                  <th className="px-2 py-1.5 font-semibold">Displayed status</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Count</th>
                </tr>
              </thead>
              <tbody>
                {report.crossTab.map((r) => (
                  <tr key={`${r.manual_status}|${r.status}`} className="border-b border-line last:border-0">
                    <td className="px-2 py-1.5">
                      <span className={`pill ${leadStatusPill(r.manual_status)}`}>{r.manual_label}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`pill ${leadStatusPill(r.status)}`}>{r.status_label}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card mb-4 p-4">
        <h3 className="mb-1 text-sm font-semibold">Negative → converted</h3>
        <p className="mb-3 text-[11px] text-muted">
          Staff marked Not Interested / Wrong No., but behaviour shows registration or payment.
        </p>
        <LeadMiniTable rows={report.negativeThenConverted} empty="None — good news if true." />
      </section>

      <section className="card mb-4 p-4">
        <h3 className="mb-1 text-sm font-semibold">Per-staff flip rates</h3>
        <p className="mb-3 text-[11px] text-muted">
          Of each person&apos;s manual verdicts, how many now display a behaviour stage (denom = their
          total manuals).
        </p>
        {report.perStaff.length === 0 ? (
          <p className="text-xs text-muted">No staff attribution yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="px-2 py-1.5 font-semibold">Staff</th>
                  <th className="px-2 py-1.5 font-semibold">Role</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Flipped</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Denom</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Rate</th>
                </tr>
              </thead>
              <tbody>
                {report.perStaff.map((s) => {
                  const small = s.denominator < 30;
                  return (
                    <tr key={s.by} className="border-b border-line last:border-0">
                      <td className="px-2 py-1.5 font-medium">
                        {s.by}
                        {small && (
                          <span className="ml-1 text-[10px] font-normal text-muted">(small sample)</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-muted">{s.byRole || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.flippedToBehaviour}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.denominator}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{pct(s.rate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card mb-4 p-4">
        <h3 className="mb-1 text-sm font-semibold">Reverse · positive manual, no behaviour</h3>
        <p className="mb-3 text-[11px] text-muted">
          Staff marked interest / demo / walk-in etc., but displayed status is not yet on the behaviour
          ladder.
        </p>
        <LeadMiniTable rows={report.reverse} empty="None." />
      </section>
    </div>
  );
}

function LeadMiniTable({ rows, empty }: { rows: NamedLead[]; empty: string }) {
  if (rows.length === 0) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead>
          <tr className="border-b border-line text-muted">
            <th className="px-2 py-1.5 font-semibold">Name</th>
            <th className="px-2 py-1.5 font-semibold">Phone</th>
            <th className="px-2 py-1.5 font-semibold">Manual</th>
            <th className="px-2 py-1.5 font-semibold">Status</th>
            <th className="px-2 py-1.5 font-semibold">By</th>
            <th className="px-2 py-1.5 font-semibold">When</th>
            <th className="px-2 py-1.5 text-right font-semibold">Gap (days)</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0">
              <td className="px-2 py-1.5 font-medium">{r.name || "—"}</td>
              <td className="px-2 py-1.5 tabular-nums">{r.phone || "—"}</td>
              <td className="px-2 py-1.5">
                <span className={`pill ${leadStatusPill(r.manual_status)}`}>{leadStatusLabel(r.manual_status)}</span>
              </td>
              <td className="px-2 py-1.5">
                <span className={`pill ${leadStatusPill(r.status)}`}>{leadStatusLabel(r.status)}</span>
              </td>
              <td className="px-2 py-1.5 text-muted">{r.manual_status_by || "—"}</td>
              <td className="px-2 py-1.5 whitespace-nowrap text-muted">
                {r.manual_status_at ? formatISTDateTime(r.manual_status_at) : "—"}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                {typeof r.gap_days === "number" ? r.gap_days : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 200 && (
        <p className="mt-2 text-[11px] text-muted">Showing first 200 of {rows.length}.</p>
      )}
    </div>
  );
}
