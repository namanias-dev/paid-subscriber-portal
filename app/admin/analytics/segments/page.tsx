"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Phone, MessageCircle, ArrowLeft, Route, X } from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import SendSmsButton from "@/components/admin/sms/SendSmsButton";
import { whatsappLink, telLink } from "@/lib/phone";
import { formatISTDateTime } from "@/lib/dates";

type SegmentKey =
  | "paid_not_logged_in" | "payment_pending_or_abandoned" | "clicked_pay_not_paid"
  | "paid_not_clicked_zoom" | "payment_verifying" | "registered_no_quiz";

interface Row { phone: string; name: string | null; detail: string; source: string | null; lastAt: string | null; buyerId: string | null }

const SEGMENTS: { key: SegmentKey; label: string; blurb: string }[] = [
  { key: "paid_not_logged_in", label: "Paid · not logged in", blurb: "Bought but never opened the portal — send their login code." },
  { key: "payment_pending_or_abandoned", label: "Payment pending / abandoned", blurb: "Latest payment stuck — nudge to complete." },
  { key: "payment_verifying", label: "Verifying", blurb: "Paid but awaiting verification — chase proof / approve." },
  { key: "clicked_pay_not_paid", label: "Clicked pay · not paid", blurb: "Started but didn't finish a purchase." },
  { key: "paid_not_clicked_zoom", label: "Paid webinar · no Zoom click", blurb: "At risk of no-show — share the join link." },
  { key: "registered_no_quiz", label: "Registered · no quiz", blurb: "Never attempted a quiz — nudge with a free one." },
];

function toCsv(rows: Row[]): string {
  const head = ["name", "phone", "detail", "source", "last_activity"];
  const body = rows.map((r) => [r.name || "", r.phone, r.detail, r.source || "", r.lastAt || ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  return [head.join(","), ...body].join("\n");
}

export default function SegmentsPage() {
  const [active, setActive] = useState<SegmentKey>("paid_not_logged_in");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [journeyPhone, setJourneyPhone] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analytics/segments?key=${active}`)
      .then((r) => r.json())
      .then((d) => setRows(d.ok ? d.rows : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [active]);

  function exportCsv() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `segment-${active}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5 pb-16">
      <Link href="/admin/analytics" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
        <ArrowLeft size={15} /> Business Analytics
      </Link>
      <div>
        <h1 className="font-heading text-2xl font-extrabold">Re-engagement segments</h1>
        <p className="text-sm text-muted">Actionable, contactable lists — export, message, or open a full journey.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SEGMENTS.map((s) => (
          <button key={s.key} onClick={() => setActive(s.key)} className={`card p-4 text-left transition ${active === s.key ? "ring-2 ring-primary" : "hover:bg-surface2"}`}>
            <p className="font-semibold text-ink">{s.label}</p>
            <p className="mt-1 text-xs text-muted">{s.blurb}</p>
          </button>
        ))}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between gap-2 border-b border-line p-4">
          <p className="text-sm font-semibold text-ink">{loading ? "Loading…" : `${rows.length} people`}</p>
          <button onClick={exportCsv} disabled={!rows.length} className="btn btn-secondary text-sm disabled:opacity-50">
            <Download size={15} /> Export CSV
          </button>
        </div>
        {loading ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted">No one in this segment right now. 🎉</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Phone</th>
                  <th className="px-4 py-2.5">Detail</th>
                  <th className="px-4 py-2.5">Source</th>
                  <th className="px-4 py-2.5">Last activity</th>
                  <th className="px-4 py-2.5 text-right">Reach out</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const wa = whatsappLink(r.phone, `Hi ${r.name || ""}, this is Naman IAS Academy. `);
                  const tel = telLink(r.phone);
                  return (
                    <tr key={r.phone} className="border-b border-line/60 last:border-0 hover:bg-surface2/50">
                      <td className="px-4 py-2.5 font-medium text-ink">{r.name || "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{r.phone}</td>
                      <td className="px-4 py-2.5 text-ink2">{r.detail}</td>
                      <td className="px-4 py-2.5 capitalize">{r.source || "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted">{r.lastAt ? formatISTDateTime(r.lastAt) : "—"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-3">
                          <button onClick={() => setJourneyPhone(r.phone)} className="inline-flex items-center gap-1 text-xs text-primary hover:opacity-80" title="View journey"><Route size={14} /> Journey</button>
                          <SendSmsButton phone={r.phone} name={r.name} />
                          {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="text-success hover:opacity-80" title="WhatsApp"><MessageCircle size={16} /></a>}
                          {tel && <a href={tel} className="text-primary hover:opacity-80" title="Call"><Phone size={16} /></a>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {journeyPhone && <JourneyModal phone={journeyPhone} onClose={() => setJourneyPhone(null)} />}
    </div>
  );
}

interface Journey {
  phone: string | null;
  buyer: { id: string; name: string | null; login_code?: string | null } | null;
  attribution: { source: string | null; campaign: string | null; landing_path: string | null; first_seen_at: string | null } | null;
  flags: { paid: boolean; loggedInSincePaid: boolean; clickedZoom: boolean; registered: boolean };
  events: { event_id: string; event_name: string; occurred_at: string; page_path: string | null }[];
}

function JourneyModal({ phone, onClose }: { phone: string; onClose: () => void }) {
  const [data, setData] = useState<Journey | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analytics/journey?phone=${encodeURIComponent(phone)}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setData(d.journey); else setErr(d.error || "Failed to load."); })
      .catch(() => setErr("Failed to load journey."))
      .finally(() => setLoading(false));
  }, [phone]);

  const flagPills = data ? [
    { on: data.flags.registered, label: "Registered" },
    { on: data.flags.paid, label: "Paid" },
    { on: data.flags.loggedInSincePaid, label: "Logged in (since paid)" },
    { on: data.flags.clickedZoom, label: "Clicked Zoom" },
  ] : [];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card flex max-h-[85vh] w-full max-w-lg flex-col p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line p-4">
          <div>
            <h3 className="text-base font-bold">{data?.buyer?.name || "User journey"}</h3>
            <p className="font-mono text-xs text-muted">{phone}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-4">
          {loading ? <LoadingBlock /> : err ? <p className="py-6 text-center text-sm text-danger">{err}</p> : data ? (
            <>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {flagPills.map((f) => (
                  <span key={f.label} className={`rounded-full px-2 py-0.5 text-xs font-medium ${f.on ? "pill-green" : "pill-gray"}`}>{f.label}</span>
                ))}
              </div>
              <dl className="mb-4 grid grid-cols-2 gap-2 text-xs">
                <div><dt className="text-muted">First-touch source</dt><dd className="font-medium capitalize text-ink">{data.attribution?.source || "—"}</dd></div>
                <div><dt className="text-muted">Campaign</dt><dd className="font-medium text-ink">{data.attribution?.campaign || "—"}</dd></div>
                <div className="col-span-2"><dt className="text-muted">Landing page</dt><dd className="font-medium text-ink">{data.attribution?.landing_path || "—"}</dd></div>
                <div className="col-span-2"><dt className="text-muted">First seen</dt><dd className="font-medium text-ink">{data.attribution?.first_seen_at ? formatISTDateTime(data.attribution.first_seen_at) : "—"}</dd></div>
              </dl>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Event timeline ({data.events.length})</h4>
              {data.events.length === 0 ? <p className="text-sm text-muted">No tracked events.</p> : (
                <ol className="space-y-2">
                  {data.events.map((e) => (
                    <li key={e.event_id} className="flex items-start gap-2 text-sm">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <div>
                        <span className="font-medium text-ink">{e.event_name.replace(/_/g, " ")}</span>
                        {e.page_path && <span className="ml-1 text-xs text-muted">· {e.page_path}</span>}
                        <span className="block text-xs text-muted">{formatISTDateTime(e.occurred_at)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
