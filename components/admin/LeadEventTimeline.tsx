"use client";

import { useEffect, useState } from "react";
import { formatISTDateTime } from "@/lib/dates";

export interface LeadTimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string | null;
  origin: string;
}

const ORIGIN_PILL: Record<string, string> = {
  system: "pill-origin-system",
  staff: "pill-origin-staff",
  payment: "pill-blue",
  registration: "pill-slate",
  enrollment: "pill-amber",
  historical: "pill-gray",
  meta: "pill-blue",
  unknown: "pill-gray",
};

/**
 * Chronological lead event feed (oldest → newest). Fetches once on mount.
 */
export default function LeadEventTimeline({ leadId }: { leadId: string }) {
  const [events, setEvents] = useState<LeadTimelineEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(null);
    fetch(`/api/admin/leads/${leadId}/timeline`)
      .then(async (r) => {
        const json = await r.json().catch(() => ({}));
        if (!r.ok || !json.ok) throw new Error(json.error || "Failed to load timeline.");
        return json.events as LeadTimelineEvent[];
      })
      .then((ev) => {
        if (!cancelled) setEvents(ev || []);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || "Failed to load timeline.");
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (error) {
    return <p className="text-xs text-danger">{error}</p>;
  }
  if (events === null) {
    return <p className="text-xs text-muted">Loading events…</p>;
  }
  if (events.length === 0) {
    return (
      <p className="text-xs text-muted">
        No events yet — status changes and registrations will appear here.
      </p>
    );
  }

  return (
    <ol className="max-h-64 space-y-2 overflow-y-auto border-t border-line pt-2">
      {events.map((e, i) => (
        <li key={`${e.at}-${e.kind}-${i}`} className="flex items-start gap-2 text-xs">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink2/50" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-ink">{e.title}</span>
              {e.origin && (
                <span className={`pill text-[10px] ${ORIGIN_PILL[e.origin] || "pill-gray"}`}>
                  {e.origin}
                </span>
              )}
            </div>
            {e.detail && <p className="mt-0.5 truncate text-muted">{e.detail}</p>}
          </div>
          <span className="shrink-0 text-[10px] text-muted">{formatISTDateTime(e.at)}</span>
        </li>
      ))}
    </ol>
  );
}
