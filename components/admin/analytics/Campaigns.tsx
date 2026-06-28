"use client";

import { useEffect, useState } from "react";
import { LoadingBlock } from "@/components/admin/ui";
import { SectionCard, EmptyState, nf } from "./Shared";
import { formatINR } from "@/lib/dates";

type Dim = "campaign" | "medium" | "landing_path" | "device";
interface Row { key: string; label: string; visitors: number; sessions: number; registrations: number; paidStudents: number | null; revenue: number | null }
interface Breakdown { dimension: Dim; moneyAttributable: boolean; rows: Row[] }

const DIMS: { id: Dim; label: string }[] = [
  { id: "campaign", label: "Campaign" }, { id: "medium", label: "Medium" }, { id: "landing_path", label: "Landing page" }, { id: "device", label: "Device" },
];

export default function CampaignsTab({ qs }: { qs: string }) {
  const [dim, setDim] = useState<Dim>("campaign");
  const [data, setData] = useState<Breakdown | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analytics/campaigns?${qs}&dimension=${dim}`).then((r) => r.json())
      .then((d) => setData(d.ok ? d.breakdown : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [qs, dim]);

  return (
    <SectionCard
      title="Source & campaign breakdown"
      action={
        <div className="inline-flex overflow-hidden rounded-xl border border-line">
          {DIMS.map((d) => (
            <button key={d.id} onClick={() => setDim(d.id)} className={`px-2.5 py-1.5 text-xs font-semibold transition ${dim === d.id ? "bg-primary text-white" : "bg-white text-ink hover:bg-surface2"}`}>{d.label}</button>
          ))}
        </div>
      }
    >
      {loading ? <LoadingBlock /> : !data || data.rows.length === 0 ? <EmptyState>No tracked traffic for this dimension yet.</EmptyState> : (
        <>
          {!data.moneyAttributable && (
            <p className="mb-3 text-xs text-muted">Payments only carry source &amp; campaign, so paid/revenue can’t be attributed to {DIMS.find((d) => d.id === dim)?.label.toLowerCase()} — those columns show traffic only.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-2">{DIMS.find((d) => d.id === dim)?.label}</th>
                  <th className="px-2 py-2 text-right">Visitors</th>
                  <th className="px-2 py-2 text-right">Sessions</th>
                  <th className="px-2 py-2 text-right">Registrations</th>
                  {data.moneyAttributable && <th className="px-2 py-2 text-right">Paid students</th>}
                  {data.moneyAttributable && <th className="py-2 pl-2 text-right">Revenue</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-2 font-medium text-ink">{r.label}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(r.visitors)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(r.sessions)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(r.registrations)}</td>
                    {data.moneyAttributable && <td className="px-2 py-2 text-right tabular-nums">{nf(r.paidStudents || 0)}</td>}
                    {data.moneyAttributable && <td className="py-2 pl-2 text-right font-semibold tabular-nums">{formatINR(r.revenue || 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SectionCard>
  );
}
