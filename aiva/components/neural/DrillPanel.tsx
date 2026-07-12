"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import OpenInPortal from "@/components/portal/OpenInPortal";
import type { PortalLink } from "@/lib/portal/links";

type TimelineStep = { label: string; date: string | null; done: boolean };
type SmsSummary = { count: number; lastType: string | null; lastSent: string | null; lastStatus: string | null; hasReminder: boolean };
type DrillRow = {
  id: string;
  name: string;
  phoneMasked: string;
  webinar: { title: string; date: string | null; attended: boolean | null } | null;
  batch: { id: string | null; label: string | null } | null;
  enrollment: { status: string; amountPaid: number; outstanding: number } | null;
  amount: number | null;
  amountLabel: string | null;
  reminderSent: boolean | null;
  matchConfidence: "confirmed" | "probable" | null;
  sms: SmsSummary;
  timeline: TimelineStep[];
  links: PortalLink[];
};
type DrillResult = { ok: true; title: string; note?: string; total: number; page: number; pageSize: number; rows: DrillRow[] };

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}
function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
}

/** Read-only drill-down list: the actual stitched records behind a clicked metric. */
export default function DrillPanel({ domain, metric, label, onClose }: { domain: string; metric: string; label: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DrillResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => {
      setPage(1);
      setDebouncedQ(q);
    }, 250);
    return () => {
      if (qTimer.current) clearTimeout(qTimer.current);
    };
  }, [q]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const url = `/api/agents/${domain}/drill?metric=${encodeURIComponent(metric)}&q=${encodeURIComponent(debouncedQ)}&page=${page}`;
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!alive) return;
        if (!r.ok || !j.ok) setError(j.error || `HTTP ${r.status}`);
        else {
          setError(null);
          setData(j as DrillResult);
        }
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [domain, metric, debouncedQ, page]);

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 10;
  const shownFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const shownTo = Math.min(total, page * pageSize);
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="aiva-drill-backdrop" onClick={onClose}>
    <div className="aiva-drill" role="dialog" aria-label={`${label} records`} onClick={(e) => e.stopPropagation()}>
      <div className="aiva-drill-head">
        <div className="min-w-0">
          <div className="aiva-label">Drill-down · read-only</div>
          <h3 className="truncate font-heading text-base font-bold text-white">{data?.title || label}</h3>
        </div>
        <button className="aiva-btn-ghost px-3 py-1.5 text-xs" onClick={onClose} aria-label="Close drill-down">Close</button>
      </div>

      <input
        className="aiva-drill-search"
        placeholder="Search name or last-4 phone…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        inputMode="search"
      />

      <div className="aiva-drill-count">
        {loading ? "Loading…" : total === 0 ? "No records" : `Showing ${shownFrom}–${shownTo} of ${total}`}
        {data?.note ? <span className="aiva-drill-note"> · {data.note}</span> : null}
      </div>

      {error ? (
        <p className="text-sm text-danger">Could not load: {error}</p>
      ) : (
        <div className="aiva-drill-list">
          {(data?.rows || []).map((r) => (
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
      )}

      {total > pageSize ? (
        <div className="aiva-drill-pager">
          <button className="aiva-btn-ghost px-3 py-1.5 text-xs" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
          <span className="text-xs text-muted">Page {page} / {maxPage}</span>
          <button className="aiva-btn-ghost px-3 py-1.5 text-xs" disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      ) : null}
    </div>
    </div>,
    document.body,
  );
}
