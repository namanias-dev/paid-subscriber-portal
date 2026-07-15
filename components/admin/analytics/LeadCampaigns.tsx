"use client";

/**
 * Lead Campaign Performance — first-party attribution report.
 *
 * Groups CRM leads by utm_campaign and by channel over a selectable IST range
 * (this week / month / quarter / custom) and shows the leads → webinar
 * registrations → sign-ups funnel with counts AND rates so campaigns can be
 * compared on quality, not just volume. Read-only; sources from our own DB.
 */
import { useEffect, useMemo, useState } from "react";
import { LoadingBlock } from "@/components/admin/ui";
import { SectionCard, EmptyState, Stat, nf } from "./Shared";
import { istTodayYMD } from "@/lib/dates";
import type { CampaignReport, CampaignRow } from "@/lib/marketing/campaignReport";

type Preset = "week" | "month" | "quarter" | "custom";
const PRESET_LABELS: Record<Preset, string> = {
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  custom: "Custom",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** {from,to} as IST YYYY-MM-DD for a preset. */
function rangeFor(preset: Preset): { from: string; to: string } {
  const to = istTodayYMD();
  const [y, m, d] = to.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  if (preset === "week") {
    const mondayOffset = (base.getUTCDay() + 6) % 7;
    const start = new Date(base.getTime() - mondayOffset * 86400000);
    return { from: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`, to };
  }
  if (preset === "month") return { from: `${y}-${pad(m)}-01`, to };
  // quarter
  const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
  return { from: `${y}-${pad(qStartMonth)}-01`, to };
}

const pctOf = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

function Table({ rows, dimLabel, showChannel }: { rows: CampaignRow[]; dimLabel: string; showChannel: boolean }) {
  if (rows.length === 0) return <EmptyState>No attributed leads in this range yet.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-2 pr-2">{dimLabel}</th>
            {showChannel && <th className="px-2 py-2">Channel</th>}
            <th className="px-2 py-2 text-right">Leads</th>
            <th className="px-2 py-2 text-right">Webinar regs</th>
            <th className="px-2 py-2 text-right">Sign-ups</th>
            <th className="px-2 py-2 text-right">Lead→Webinar</th>
            <th className="py-2 pl-2 text-right">Lead→Sign-up</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line/60 last:border-0">
              <td className="py-2 pr-2 font-medium text-ink">{r.label}</td>
              {showChannel && (
                <td className="px-2 py-2">
                  <span className={`pill text-[10px] font-semibold ${r.channel === "Google Ads" ? "pill-amber" : "pill-gray"}`}>{r.channel || "—"}</span>
                </td>
              )}
              <td className="px-2 py-2 text-right tabular-nums">{nf(r.leads)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{nf(r.webinarRegs)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{nf(r.signups)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{pctOf(r.webinarRate)}</td>
              <td className="py-2 pl-2 text-right font-semibold tabular-nums">{pctOf(r.signupRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LeadCampaignsTab() {
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    return rangeFor(preset);
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    if (!range.from || !range.to) return;
    setLoading(true);
    fetch(`/api/admin/analytics/lead-campaigns?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((d) => setReport(d.ok ? d.report : null))
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  const t = report?.totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap overflow-hidden rounded-xl border border-line">
          {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
            <button key={p} onClick={() => setPreset(p)} className={`px-3 py-2 text-sm font-semibold transition ${preset === p ? "bg-primary text-white" : "bg-white text-ink hover:bg-surface2"}`}>
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="inline-flex items-center gap-1.5">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
            <span className="text-muted">→</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-4"><LoadingBlock /><LoadingBlock /></div>
      ) : !report ? (
        <EmptyState>Could not load campaign performance.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Leads captured" value={nf(t!.leads)} />
            <Stat label="Webinar registrations" value={nf(t!.webinarRegs)} hint={pctOf(t!.webinarRate) + " of leads"} />
            <Stat label="Sign-ups (admitted)" value={nf(t!.signups)} hint={pctOf(t!.signupRate) + " of leads"} tone="green" />
            <Stat label="Campaigns tracked" value={nf(report.byCampaign.length)} />
          </div>

          <SectionCard title="By campaign (utm_campaign)">
            <Table rows={report.byCampaign} dimLabel="Campaign" showChannel />
          </SectionCard>

          <SectionCard title="By channel">
            <Table rows={report.byChannel} dimLabel="Channel" showChannel={false} />
          </SectionCard>

          <p className="px-1 text-xs text-muted">
            First-party counts from the Lead CRM. &quot;Sign-ups&quot; = leads marked Admitted; &quot;Webinar regs&quot; = leads flagged registered.
            Cost / CPC / ROAS require the Google Ads API (not yet connected).
          </p>
        </>
      )}
    </div>
  );
}
