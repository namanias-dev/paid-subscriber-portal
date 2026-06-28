"use client";

import { useEffect, useState } from "react";
import { LoadingBlock } from "@/components/admin/ui";
import { SectionCard, EmptyState, nf, pctStr } from "./Shared";
import { formatINR } from "@/lib/dates";

interface Funnel {
  steps: { label: string; value: number; conversionFromPrev: number | null }[];
  webinars: { slug: string; title: string; registrations: number; paid: number; attended: number; revenue: number }[];
}

const STEP_COLORS = ["#2563eb", "#7c3aed", "#d97706", "#16a34a", "#0891b2"];

export default function WebinarsTab({ qs }: { qs: string }) {
  const [data, setData] = useState<Funnel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analytics/webinar-funnel?${qs}`).then((r) => r.json())
      .then((d) => setData(d.ok ? d.funnel : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [qs]);

  if (loading) return <div className="space-y-4"><LoadingBlock /></div>;
  if (!data) return <SectionCard title="Webinar funnel"><EmptyState>No webinar activity in this range yet.</EmptyState></SectionCard>;
  const max = Math.max(1, ...data.steps.map((s) => s.value));

  return (
    <div className="space-y-4">
      <SectionCard title="Webinar funnel">
        <p className="mb-3 text-xs text-muted">Directional funnel — views &amp; clicks count unique visitors; registered/paid/joined count people &amp; transactions. Conversion is each step ÷ the step above.</p>
        <div className="space-y-3">
          {data.steps.map((s, i) => (
            <div key={s.label}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-ink2">{s.label}</span>
                <span className="font-semibold text-ink">{nf(s.value)}{s.conversionFromPrev !== null && <span className="ml-2 text-xs font-normal text-muted">({pctStr(s.conversionFromPrev)})</span>}</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface2">
                <div className="h-full rounded-full" style={{ width: `${(s.value / max) * 100}%`, background: STEP_COLORS[i % STEP_COLORS.length] }} />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="By webinar">
        {data.webinars.length === 0 ? <EmptyState>No webinar registrations or payments in this range.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-2">Webinar</th>
                  <th className="px-2 py-2 text-right">Registrations</th>
                  <th className="px-2 py-2 text-right">Paid</th>
                  <th className="px-2 py-2 text-right">Joined (Zoom)</th>
                  <th className="py-2 pl-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.webinars.map((w) => (
                  <tr key={w.slug} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-2 font-medium text-ink">{w.title}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(w.registrations)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(w.paid)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{nf(w.attended)}</td>
                    <td className="py-2 pl-2 text-right font-semibold tabular-nums">{formatINR(w.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">“Joined” uses real in-page Zoom-button clicks. The <code>webinar_registrations.attended</code> flag isn’t written yet, so attendance = Zoom clicks.</p>
      </SectionCard>
    </div>
  );
}
