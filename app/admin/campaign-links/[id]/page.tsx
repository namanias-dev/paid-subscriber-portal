"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import { Stat } from "@/components/admin/analytics/Shared";
import { formatINR, formatISTDateTime } from "@/lib/dates";
import { CAMPAIGN_SITE_URL } from "@/lib/marketing/campaignLink";
import type { CampaignLink, CampaignLinkStatus } from "@/lib/marketing/campaignLinks";
import type { LinkMetrics } from "@/lib/marketing/campaignLinkAnalytics";
import CopyButton from "@/components/admin/campaign-links/CopyButton";
import QrCode from "@/components/admin/campaign-links/QrCode";

type Preset = "today" | "yesterday" | "7d" | "30d" | "this_month";
const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "7D" }, { id: "30d", label: "30D" }, { id: "this_month", label: "MTD" },
];
interface ClickRow { occurred_at: string; visitor_id: string | null; referrer: string | null; device: { type?: string; os?: string; browser?: string } | null }

export default function CampaignLinkDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const [preset, setPreset] = useState<Preset>("30d");
  const [link, setLink] = useState<CampaignLink | null>(null);
  const [metrics, setMetrics] = useState<LinkMetrics | null>(null);
  const [clicks, setClicks] = useState<ClickRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/admin/campaign-links/${id}?preset=${preset}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setLink(d.link); setMetrics(d.metrics); setClicks(d.clicks || []); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, preset]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(next: CampaignLinkStatus) {
    await fetch(`/api/admin/campaign-links/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) }).catch(() => {});
    load();
  }

  const url = link ? `${CAMPAIGN_SITE_URL}/go/${link.short_code}` : "";
  const funnel = metrics
    ? [
        { label: "Clicks", value: metrics.clicks },
        { label: "Unique visitors", value: metrics.uniqueVisitors },
        { label: "Registrations", value: metrics.registrations },
        { label: "Checkout started", value: metrics.checkoutStarted },
        { label: "Orders", value: metrics.orders },
        { label: "Paid admissions", value: metrics.paidAdmissions },
      ]
    : [];
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.value));

  return (
    <div className="space-y-5 pb-16">
      <Link href="/admin/campaign-links" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
        <ArrowLeft size={15} /> Campaign Links
      </Link>

      {loading && !link ? (
        <LoadingBlock />
      ) : !link ? (
        <div className="card p-10 text-center text-sm text-muted">Link not found.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-heading text-2xl font-extrabold">{link.name}</h1>
              <p className="mt-0.5 font-mono text-sm text-muted">{url}</p>
              <p className="mt-1 text-xs capitalize text-muted">
                {link.source || "—"} · {link.platform || "—"} · {link.campaign || "no campaign"}
                {link.creative_name ? ` · ${link.creative_name}` : ""}
                <span className="ml-2 rounded-full bg-surface2 px-2 py-0.5">{link.status}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <CopyButton value={url} />
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink hover:bg-surface2"><ExternalLink size={15} /> Open</a>
              {link.status === "active" ? (
                <button onClick={() => setStatus("paused")} className="min-h-11 rounded-full border border-line px-4 text-sm font-semibold text-ink hover:bg-surface2">Pause</button>
              ) : link.status === "paused" ? (
                <button onClick={() => setStatus("active")} className="min-h-11 rounded-full border border-line px-4 text-sm font-semibold text-ink hover:bg-surface2">Activate</button>
              ) : null}
              {link.status !== "archived" && <button onClick={() => setStatus("archived")} className="min-h-11 rounded-full border border-line px-4 text-sm font-semibold text-danger hover:bg-surface2">Archive</button>}
            </div>
          </div>

          {/* Period */}
          <div className="inline-flex overflow-hidden rounded-xl border border-line">
            {PRESETS.map((p) => (
              <button key={p.id} onClick={() => setPreset(p.id)} className={`px-2.5 py-1.5 text-xs font-semibold transition ${preset === p.id ? "bg-primary text-white" : "bg-white text-ink hover:bg-surface2"}`}>{p.label}</button>
            ))}
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Clicks" value={metrics ? metrics.clicks.toLocaleString("en-IN") : "—"} />
            <Stat label="Registrations" value={metrics ? metrics.registrations.toLocaleString("en-IN") : "—"} />
            <Stat label="Leads" value={metrics ? metrics.leads.toLocaleString("en-IN") : "—"} />
            <Stat label="Orders" value={metrics ? metrics.orders.toLocaleString("en-IN") : "—"} />
            <Stat label="Admissions" value={metrics ? metrics.paidAdmissions.toLocaleString("en-IN") : "—"} />
            <Stat label="Revenue" value={metrics ? formatINR(metrics.revenue) : "—"} tone="green" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Funnel */}
            <div className="card p-4 lg:col-span-2">
              <h2 className="font-heading text-base font-bold">Funnel ({preset.toUpperCase()})</h2>
              <div className="mt-3 space-y-2">
                {funnel.map((f) => (
                  <div key={f.label} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 text-xs text-muted">{f.label}</span>
                    <div className="h-6 flex-1 overflow-hidden rounded-lg bg-surface2">
                      <div className="h-full rounded-lg bg-primary/80" style={{ width: `${Math.round((f.value / maxFunnel) * 100)}%` }} />
                    </div>
                    <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums">{f.value.toLocaleString("en-IN")}</span>
                  </div>
                ))}
              </div>
              {metrics && (
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-xl bg-surface2 p-2"><p className="text-xs text-muted">Click→Reg</p><p className="font-semibold">{metrics.clickToRegistration === null ? "—" : `${metrics.clickToRegistration}%`}</p></div>
                  <div className="rounded-xl bg-surface2 p-2"><p className="text-xs text-muted">Reg→Paid</p><p className="font-semibold">{metrics.registrationToPaid === null ? "—" : `${metrics.registrationToPaid}%`}</p></div>
                  <div className="rounded-xl bg-surface2 p-2"><p className="text-xs text-muted">Click→Paid</p><p className="font-semibold">{metrics.clickToPaid === null ? "—" : `${metrics.clickToPaid}%`}</p></div>
                </div>
              )}
              <p className="mt-3 text-xs text-muted">Revenue = Notes orders + paid admissions/webinars tied to this link (deduped, reconciles to Payments). Admissions are matched via the buyer&apos;s stored first-touch link, so cross-device and later purchases still credit this link where known.</p>
            </div>

            {/* QR + meta */}
            <div className="card p-4">
              <h2 className="font-heading text-base font-bold">QR code</h2>
              <p className="mt-1 text-xs text-muted">For posters, flyers &amp; classroom screens — same link, same attribution.</p>
              <div className="mt-3 flex justify-center"><QrCode value={url} size={180} /></div>
              <dl className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted">Destination</dt><dd className="truncate font-medium text-ink">{link.destination_url}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted">Created</dt><dd className="font-medium text-ink">{formatISTDateTime(link.created_at)}</dd></div>
                {link.created_by && <div className="flex justify-between gap-2"><dt className="text-muted">By</dt><dd className="font-medium text-ink">{link.created_by}</dd></div>}
              </dl>
            </div>
          </div>

          {/* Recent clicks */}
          <div className="card overflow-hidden p-0">
            <div className="border-b border-line p-4"><h2 className="font-heading text-base font-bold">Recent clicks</h2></div>
            {clicks.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">No clicks recorded yet for this link.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="px-4 py-2.5">When</th><th className="px-4 py-2.5">Device</th><th className="px-4 py-2.5">Referrer</th><th className="px-4 py-2.5">Visitor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clicks.map((c, i) => (
                      <tr key={i} className="border-b border-line/60 last:border-0">
                        <td className="px-4 py-2.5 text-xs">{formatISTDateTime(c.occurred_at)}</td>
                        <td className="px-4 py-2.5 text-xs capitalize">{[c.device?.type, c.device?.os, c.device?.browser].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted">{c.referrer || "direct"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted">{c.visitor_id ? c.visitor_id.slice(0, 8) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
