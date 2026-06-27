"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Phone, MessageCircle, ArrowLeft } from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import { whatsappLink, telLink } from "@/lib/phone";
import { formatISTDateTime } from "@/lib/dates";

type SegmentKey = "paid_not_logged_in" | "payment_pending_or_abandoned" | "clicked_pay_not_paid" | "paid_not_clicked_zoom";

interface Row { phone: string; name: string | null; detail: string; source: string | null; lastAt: string | null; buyerId: string | null }

const SEGMENTS: { key: SegmentKey; label: string; blurb: string }[] = [
  { key: "paid_not_logged_in", label: "Paid · not logged in", blurb: "Bought but never opened the portal — send their login code." },
  { key: "payment_pending_or_abandoned", label: "Payment pending / abandoned", blurb: "Latest payment stuck — nudge to complete." },
  { key: "clicked_pay_not_paid", label: "Clicked pay · not paid", blurb: "Started but didn't finish a purchase." },
  { key: "paid_not_clicked_zoom", label: "Paid webinar · no Zoom click", blurb: "At risk of no-show — share the join link." },
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
        <p className="text-sm text-muted">Actionable, contactable lists — export or reach out directly.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                        <div className="flex items-center justify-end gap-2">
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
    </div>
  );
}
