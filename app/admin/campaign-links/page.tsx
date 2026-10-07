"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Download, ExternalLink, BarChart3, Copy, Pause, Play, Archive, Check } from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import { formatINR } from "@/lib/dates";
import { CAMPAIGN_SITE_URL } from "@/lib/marketing/campaignLink";
import type { CampaignLink, CampaignLinkStatus } from "@/lib/marketing/campaignLinks";
import type { LinkMetrics } from "@/lib/marketing/campaignLinkAnalytics";
import CreateLinkModal from "@/components/admin/campaign-links/CreateLinkModal";

interface Row { link: CampaignLink; metrics: LinkMetrics }

type Preset = "today" | "yesterday" | "7d" | "30d" | "this_month";
const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "7D" }, { id: "30d", label: "30D" }, { id: "this_month", label: "MTD" },
];
const STATUSES: { id: CampaignLinkStatus | "all"; label: string }[] = [
  { id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "paused", label: "Paused" }, { id: "archived", label: "Archived" },
];

const shortUrl = (code: string) => `${CAMPAIGN_SITE_URL}/go/${code}`;
const nf = (n: number) => n.toLocaleString("en-IN");

export default function CampaignLinksPage() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [status, setStatus] = useState<CampaignLinkStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ preset, status });
    if (search.trim()) qs.set("search", search.trim());
    fetch(`/api/admin/campaign-links?${qs.toString()}`)
      .then((r) => r.json())
      .then((d) => setRows(d.ok ? d.rows : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [preset, status, search]);

  useEffect(() => { load(); }, [load]);

  async function setLinkStatus(id: string, next: CampaignLinkStatus) {
    await fetch(`/api/admin/campaign-links/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }),
    }).catch(() => {});
    load();
  }
  async function duplicate(id: string) {
    await fetch(`/api/admin/campaign-links/${id}/duplicate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    load();
  }
  function copy(code: string) {
    void navigator.clipboard.writeText(shortUrl(code)).then(() => {
      setCopied(code); window.setTimeout(() => setCopied((c) => (c === code ? null : c)), 1400);
    });
  }

  return (
    <div className="space-y-5 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-extrabold">Campaign Links</h1>
          <p className="text-sm text-muted">Branded short links with full-funnel attribution — clicks → registrations → admissions → revenue.</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/admin/campaign-links/export?preset=${preset}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink hover:bg-surface2">
            <Download size={15} /> <span className="hidden sm:inline">Export</span>
          </a>
          <button onClick={() => setShowCreate(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-white">
            <Plus size={16} /> Create link
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-xl border border-line">
          {PRESETS.map((p) => (
            <button key={p.id} onClick={() => setPreset(p.id)} className={`px-2.5 py-1.5 text-xs font-semibold transition ${preset === p.id ? "bg-primary text-white" : "bg-white text-ink hover:bg-surface2"}`}>{p.label}</button>
          ))}
        </div>
        <div className="inline-flex overflow-hidden rounded-xl border border-line">
          {STATUSES.map((s) => (
            <button key={s.id} onClick={() => setStatus(s.id)} className={`px-2.5 py-1.5 text-xs font-semibold transition ${status === s.id ? "bg-primary text-white" : "bg-white text-ink hover:bg-surface2"}`}>{s.label}</button>
          ))}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code, campaign…" className="min-h-10 flex-1 rounded-xl border border-line bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none sm:max-w-xs" />
      </div>

      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm font-semibold text-ink">No campaign links yet.</p>
          <p className="mt-1 text-sm text-muted">Create one, paste it into an ad or reel, and watch the funnel fill in here.</p>
          <button onClick={() => setShowCreate(true)} className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-white"><Plus size={16} /> Create your first link</button>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden overflow-x-auto p-0 lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5">Link</th>
                  <th className="px-3 py-2.5">Source</th>
                  <th className="px-3 py-2.5 text-right">Clicks</th>
                  <th className="px-3 py-2.5 text-right">Visitors</th>
                  <th className="px-3 py-2.5 text-right">Regs</th>
                  <th className="px-3 py-2.5 text-right">Orders</th>
                  <th className="px-3 py-2.5 text-right">Admissions</th>
                  <th className="px-3 py-2.5 text-right">Revenue</th>
                  <th className="px-3 py-2.5 text-right">Click→Reg</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ link, metrics: m }) => (
                  <tr key={link.id} className={`border-b border-line/60 last:border-0 ${link.status === "archived" ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3">
                      <Link href={`/admin/campaign-links/${link.id}`} className="font-semibold text-ink hover:text-primary">{link.name}</Link>
                      <div className="font-mono text-xs text-muted">/go/{link.short_code}{link.status !== "active" && <span className="ml-2 rounded-full bg-surface2 px-1.5 py-0.5 capitalize">{link.status}</span>}</div>
                    </td>
                    <td className="px-3 py-3 capitalize text-ink2">{link.source || "—"}<div className="text-xs text-muted">{link.campaign || ""}</div></td>
                    <td className="px-3 py-3 text-right tabular-nums">{nf(m.clicks)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{nf(m.uniqueVisitors)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{nf(m.registrations)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{nf(m.orders)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{nf(m.paidAdmissions)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatINR(m.revenue)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{m.clickToRegistration === null ? "—" : `${m.clickToRegistration}%`}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2.5 text-muted">
                        <button title="Copy" onClick={() => copy(link.short_code)} className="hover:text-primary">{copied === link.short_code ? <Check size={15} className="text-success" /> : <Copy size={15} />}</button>
                        <a title="Open" href={shortUrl(link.short_code)} target="_blank" rel="noopener noreferrer" className="hover:text-primary"><ExternalLink size={15} /></a>
                        <Link title="Analytics" href={`/admin/campaign-links/${link.id}`} className="hover:text-primary"><BarChart3 size={15} /></Link>
                        <button title="Duplicate" onClick={() => duplicate(link.id)} className="hover:text-primary"><Copy size={15} className="rotate-90" /></button>
                        {link.status === "paused" ? (
                          <button title="Activate" onClick={() => setLinkStatus(link.id, "active")} className="hover:text-success"><Play size={15} /></button>
                        ) : link.status === "active" ? (
                          <button title="Pause" onClick={() => setLinkStatus(link.id, "paused")} className="hover:text-warning"><Pause size={15} /></button>
                        ) : null}
                        {link.status !== "archived" && <button title="Archive" onClick={() => setLinkStatus(link.id, "archived")} className="hover:text-danger"><Archive size={15} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {rows.map(({ link, metrics: m }) => (
              <div key={link.id} className={`card p-4 ${link.status === "archived" ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/admin/campaign-links/${link.id}`} className="font-semibold text-ink">{link.name}</Link>
                  <span className="shrink-0 rounded-full bg-surface2 px-2 py-0.5 text-xs capitalize text-muted">{link.status}</span>
                </div>
                <p className="mt-0.5 font-mono text-xs text-muted">/go/{link.short_code}</p>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  <div><p className="text-xs text-muted">Clicks</p><p className="font-semibold tabular-nums">{nf(m.clicks)}</p></div>
                  <div><p className="text-xs text-muted">Regs</p><p className="font-semibold tabular-nums">{nf(m.registrations)}</p></div>
                  <div><p className="text-xs text-muted">Adm.</p><p className="font-semibold tabular-nums">{nf(m.paidAdmissions)}</p></div>
                  <div><p className="text-xs text-muted">Rev.</p><p className="font-semibold tabular-nums">{formatINR(m.revenue)}</p></div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button onClick={() => copy(link.short_code)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-white">{copied === link.short_code ? <Check size={14} /> : <Copy size={14} />} Copy</button>
                  <Link href={`/admin/campaign-links/${link.id}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-ink"><BarChart3 size={14} /> Analytics</Link>
                  {link.status === "paused" ? (
                    <button onClick={() => setLinkStatus(link.id, "active")} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-ink"><Play size={14} /> Activate</button>
                  ) : link.status === "active" ? (
                    <button onClick={() => setLinkStatus(link.id, "paused")} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-ink"><Pause size={14} /> Pause</button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showCreate && <CreateLinkModal onClose={() => setShowCreate(false)} onCreated={() => load()} />}
    </div>
  );
}
