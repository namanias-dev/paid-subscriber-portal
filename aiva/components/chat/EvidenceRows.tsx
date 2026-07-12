"use client";

import OpenInPortal from "@/components/portal/OpenInPortal";
import type { DrillRow } from "@/lib/insights/drill";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}
function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
}

/**
 * Renders the stitched evidence records behind an assistant answer — the same read-only,
 * masked cross-table story the drill panel shows (name + last-4 phone, webinar, batch,
 * enrollment, amount, SMS status, timeline, portal deep-links).
 */
export default function EvidenceRows({ rows }: { rows: DrillRow[] }) {
  if (!rows || rows.length === 0) return <p className="text-xs text-muted">No individual records to show.</p>;
  return (
    <div className="aiva-drill-list">
      {rows.map((r) => (
        <div key={r.id} className="aiva-drill-row">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-white">{r.name}</span>
            <span className="text-xs text-muted">{r.phoneMasked}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {r.matchConfidence === "probable" ? <span className="aiva-tag aiva-tag-warn">Probable — unconfirmed</span> : null}
            {r.matchConfidence === "confirmed" ? <span className="aiva-tag aiva-tag-ok">Phone-confirmed</span> : null}
            {r.webinar ? <span className="aiva-tag">Webinar: {r.webinar.title} · {fmtDate(r.webinar.date)}{r.webinar.attended === true ? " · attended" : r.webinar.attended === false ? " · no-show" : ""}</span> : null}
            {r.batch ? <span className="aiva-tag">Batch: {r.batch.label || r.batch.id || "unmapped"}</span> : null}
            {r.enrollment ? <span className="aiva-tag">{r.enrollment.status} · paid {inr(r.enrollment.amountPaid)}{r.enrollment.outstanding > 0 ? ` · due ${inr(r.enrollment.outstanding)}` : ""}</span> : null}
            {r.amount != null ? <span className="aiva-tag aiva-tag-warn">{r.amountLabel}: {inr(r.amount)}</span> : null}
            {r.reminderSent != null ? <span className={`aiva-tag ${r.reminderSent ? "aiva-tag-ok" : "aiva-tag-warn"}`}>{r.reminderSent ? "Reminder sent" : "No reminder sent"}</span> : null}
          </div>
          <div className="mt-1 text-xs text-muted">
            {r.sms.count > 0
              ? `SMS: ${r.sms.count} · last "${r.sms.lastType}" ${fmtDate(r.sms.lastSent)}${r.sms.lastStatus ? ` (${r.sms.lastStatus})` : ""}`
              : "No SMS sent yet"}
          </div>
          {r.timeline.length > 0 ? (
            <div className="aiva-drill-timeline">
              {r.timeline.map((t, i) => (
                <span key={i} className={`aiva-step ${t.done ? "aiva-step-done" : ""}`}>
                  {t.label}
                  {t.date ? <span className="aiva-step-date"> {fmtDate(t.date)}</span> : null}
                </span>
              ))}
            </div>
          ) : null}
          {r.links && r.links.length > 0 ? (
            <div className="mt-2">
              <OpenInPortal links={r.links} size="xs" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
