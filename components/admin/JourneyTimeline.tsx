"use client";

import { useEffect, useState } from "react";
import { MapPin, Megaphone, Compass, CheckCircle2, LogIn, Video } from "lucide-react";
import GroupedTimeline, { type TimelineGroup, type TimelineNode } from "./GroupedTimeline";
import { formatINR } from "@/lib/dates";

interface EventLite {
  event_id: string;
  event_name: string;
  occurred_at: string;
  page_path: string | null;
  props: Record<string, unknown> | null;
}

interface Journey {
  phone: string | null;
  buyer: { id: string; name: string | null; login_code?: string | null } | null;
  attribution: { source: string | null; campaign: string | null; landing_path: string | null; first_seen_at: string | null } | null;
  flags: { paid: boolean; loggedInSincePaid: boolean; clickedZoom: boolean; registered: boolean };
  events: EventLite[];
}

const LABEL: Record<string, string> = {
  page_view: "Viewed a page",
  session_start: "Started a session",
  webinar_view: "Viewed a webinar",
  course_view: "Viewed a course",
  click_register_pay: "Clicked register / pay",
  click_enroll: "Clicked enroll",
  registration_created: "Registered for a webinar",
  enrollment_created: "Enrolled in a course",
  payment_initiated: "Started a payment",
  payment_status_changed: "Payment status changed",
  payment_paid: "Payment received",
  payment_abandoned: "Payment abandoned",
  payment_proof_uploaded: "Uploaded payment proof",
  staff_review: "Staff review",
  login: "Logged in",
  logout: "Logged out",
  identity_stitched: "Identity linked",
  enrolled_card_viewed: "Viewed enrolled card",
  zoom_link_clicked: "Clicked Zoom link",
  course_opened: "Opened a course",
  consent_updated: "Updated consent",
};

function dotFor(name: string): string {
  if (name === "payment_paid" || name === "login") return "bg-success";
  if (name === "payment_abandoned" || name === "payment_initiated") return "bg-warning";
  if (name === "registration_created" || name === "enrollment_created" || name === "zoom_link_clicked") return "bg-primary";
  if (name.startsWith("page_view") || name === "session_start") return "bg-ink2/40";
  return "bg-ink2";
}

function subtitleFor(e: EventLite): string | undefined {
  const p = e.props || {};
  const bits: string[] = [];
  for (const k of ["webinar_slug", "course_slug", "item_slug", "path", "to_status", "decision", "matched_via"]) {
    const v = p[k];
    if (typeof v === "string" && v) bits.push(v);
  }
  return bits.length ? bits.join(" · ") : undefined;
}

function rightFor(e: EventLite): string | undefined {
  const amt = e.props?.amount;
  if (typeof amt === "number" && amt > 0) return formatINR(amt);
  return undefined;
}

export default function JourneyTimeline({ phone }: { phone: string }) {
  const [data, setData] = useState<Journey | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analytics/journey?phone=${encodeURIComponent(phone)}`)
      .then((r) => r.json())
      .then((d) => setData(d.ok ? d.journey : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [phone]);

  if (loading) return <div className="card p-8 text-center text-sm text-muted">Loading journey…</div>;
  if (!data) return <div className="card p-8 text-center text-sm text-muted">No journey data yet.</div>;

  const a = data.attribution;
  const nodes: TimelineNode[] = data.events.map((e) => ({
    id: e.event_id,
    dot: dotFor(e.event_name),
    title: LABEL[e.event_name] || e.event_name,
    subtitle: subtitleFor(e),
    right: rightFor(e),
    datetime: e.occurred_at,
  }));

  const group: TimelineGroup = {
    id: data.phone || "journey",
    name: data.buyer?.name || data.phone || "Visitor",
    phone: data.phone || undefined,
    nodes,
  };

  const Flag = ({ on, label }: { on: boolean; label: string }) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? "bg-success/10 text-success" : "bg-surface2 text-muted"}`}>
      <CheckCircle2 size={12} className={on ? "" : "opacity-40"} /> {label}
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex items-start gap-2">
            <Megaphone size={16} className="mt-0.5 text-primary" />
            <div><p className="text-xs text-muted">Source</p><p className="text-sm font-semibold capitalize text-ink">{a?.source || "—"}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Compass size={16} className="mt-0.5 text-primary" />
            <div><p className="text-xs text-muted">Campaign</p><p className="text-sm font-semibold text-ink">{a?.campaign || "—"}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin size={16} className="mt-0.5 text-primary" />
            <div><p className="text-xs text-muted">First page</p><p className="truncate text-sm font-semibold text-ink">{a?.landing_path || "—"}</p></div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          <Flag on={data.flags.paid} label="Paid" />
          <Flag on={data.flags.registered} label="Registered" />
          <Flag on={data.flags.loggedInSincePaid} label="Logged in since paying" />
          <Flag on={data.flags.clickedZoom} label="Clicked Zoom" />
        </div>
      </div>

      {nodes.length ? (
        <GroupedTimeline groups={[group]} forceOpenIds={new Set([group.id])} />
      ) : (
        <div className="card p-8 text-center text-sm text-muted">
          <LogIn size={18} className="mx-auto mb-2 opacity-50" />
          No events recorded yet for this person.
        </div>
      )}
    </div>
  );
}
