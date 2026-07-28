"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Filter } from "lucide-react";
import { formatISTDateTime } from "@/lib/dates";
import {
  TYPE_LABELS,
  relativeTime,
  type TimelineEvent,
  type TimelineEventType,
} from "@/lib/studentTimeline";

const FILTERS: { key: TimelineEventType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "transfer", label: "Transfers" },
  { key: "payment", label: "Payments" },
  { key: "sms", label: "SMS" },
  { key: "enrollment_created", label: "Enrolments" },
  { key: "plan_changed", label: "Schedule" },
  { key: "discount_applied", label: "Discounts" },
];

function typePill(t: TimelineEventType): string {
  switch (t) {
    case "transfer": return "pill-blue";
    case "payment": return "pill-green";
    case "sms": return "pill-amber";
    case "discount_applied": return "pill-green";
    case "plan_changed": return "pill-amber";
    default: return "pill";
  }
}

function EventCard({ event }: { event: TimelineEvent }) {
  const [open, setOpen] = useState(false);
  const when = formatISTDateTime(event.at);
  const rel = relativeTime(event.at);
  const actor = event.actor.name || event.actor.id || "—";

  return (
    <li className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`pill ${typePill(event.type)}`}>{TYPE_LABELS[event.type]}</span>
            <span className="text-xs text-muted" title={when}>{when} · {rel}</span>
          </div>
          <p className="mt-1.5 text-sm font-medium leading-snug text-ink">{event.title}</p>
          {event.detail && <p className="mt-1 text-xs text-ink2">{event.detail}</p>}
        </div>
        <div className="shrink-0 text-right text-xs text-muted">
          <div>by {actor}</div>
        </div>
      </div>

      {event.reason && (
        <p className="mt-2 rounded-lg bg-surface2 px-2.5 py-1.5 text-xs text-ink2">
          <span className="font-semibold text-ink">Reason: </span>{event.reason}
        </p>
      )}

      {event.changes.length > 0 && (
        <dl className="mt-2.5 space-y-1.5">
          {event.changes.map((c, i) => (
            <div
              key={`${c.label}-${i}`}
              className={`grid grid-cols-[9rem_1fr] gap-x-2 text-xs sm:grid-cols-[11rem_1fr] ${c.emphasis ? "font-semibold text-ink" : "text-ink2"}`}
            >
              <dt className="text-muted">{c.label}</dt>
              <dd>
                {c.before != null && c.after != null
                  ? <>{c.before} <span className="text-muted">→</span> {c.after}</>
                  : (c.after ?? c.before ?? "—")}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {event.snapshot != null && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {open ? "Hide full snapshot" : "Show full before / after"}
          </button>
          {open && (
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface2 p-2.5 text-[11px] leading-relaxed text-ink2">
              {JSON.stringify(event.snapshot, null, 2)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

export default function StudentHistory({ studentId }: { studentId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<TimelineEventType | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const pageSize = 25;

  const load = useCallback(async (nextOffset: number, type: TimelineEventType | "all") => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        limit: String(pageSize),
        offset: String(nextOffset),
      });
      if (type !== "all") qs.set("types", type);
      const res = await fetch(`/api/admin/students/${encodeURIComponent(studentId)}/history?${qs}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not load history.");
        setEvents([]);
        setTotal(0);
        return;
      }
      setEvents(data.events as TimelineEvent[]);
      setTotal(Number(data.total) || 0);
      setCounts((data.counts as Record<string, number>) || {});
      setOffset(nextOffset);
    } catch {
      setError("Could not load history.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void load(0, filter);
  }, [load, filter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Filter size={14} className="text-muted" />
        {FILTERS.map((f) => {
          const n = f.key === "all" ? total : counts[f.key] ?? 0;
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                active ? "border-primary bg-primary/10 text-primary" : "border-line bg-surface text-ink2 hover:bg-surface2"
              }`}
            >
              {f.label}{f.key !== "all" && n > 0 ? ` (${n})` : ""}
            </button>
          );
        })}
      </div>

      {loading && <p className="text-sm text-muted">Loading history…</p>}
      {!loading && error && <p className="text-sm text-danger">{error}</p>}
      {!loading && !error && events.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-surface2 px-4 py-8 text-center">
          <p className="text-sm font-medium text-ink">No history yet</p>
          <p className="mt-1 text-xs text-muted">
            Enrolments, payments, transfers, discounts and reminder SMS for this student will appear here.
          </p>
        </div>
      )}

      {!loading && !error && events.length > 0 && (
        <>
          <ul className="space-y-2.5">
            {events.map((e) => <EventCard key={e.id} event={e} />)}
          </ul>
          <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted">
            <span>
              Showing {offset + 1}–{Math.min(offset + events.length, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => void load(Math.max(0, offset - pageSize), filter)}
                className="rounded-lg border border-line px-2.5 py-1 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={offset + events.length >= total}
                onClick={() => void load(offset + pageSize, filter)}
                className="rounded-lg border border-line px-2.5 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
