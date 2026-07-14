"use client";

import { useEffect, useState } from "react";
import { PageHeader, LoadingBlock } from "@/components/admin/ui";
import PeopleTabs from "@/components/admin/people/PeopleTabs";
import { formatINR } from "@/lib/dates";
import type { DuplicateEnrollmentGroup } from "@/lib/types";

interface MergeResult {
  ok: boolean;
  error?: string;
  keptId?: string;
  cancelledIds?: string[];
  oldOutstanding?: number;
  newOutstanding?: number;
  oldCount?: number;
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

export default function DuplicateEnrollmentsPage() {
  const [groups, setGroups] = useState<DuplicateEnrollmentGroup[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, MergeResult>>({});

  function load() {
    fetch("/api/admin/enrollments/duplicates")
      .then((r) => { if (r.status === 403) { setForbidden(true); return null; } return r.json(); })
      .then((d) => { if (d?.ok) setGroups(d.groups as DuplicateEnrollmentGroup[]); })
      .catch(() => setGroups([]));
  }
  useEffect(load, []);

  async function merge(g: DuplicateEnrollmentGroup) {
    const key = `${g.phone}|${g.course_id}`;
    setBusy(key);
    try {
      const res = await fetch("/api/admin/enrollments/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: g.phone, courseId: g.course_id, keepId: keep[key] || undefined, reason: reason[key] || "Merged duplicate enrollment" }),
      });
      const json = (await res.json()) as MergeResult;
      if (json.ok) {
        setDone((d) => ({ ...d, [key]: json }));
        load();
      } else {
        setDone((d) => ({ ...d, [key]: { ok: false, error: json.error || "Merge failed." } }));
      }
    } catch {
      setDone((d) => ({ ...d, [key]: { ok: false, error: "Network error." } }));
    } finally {
      setBusy(null);
    }
  }

  if (forbidden) {
    return (
      <div>
        <PageHeader title="Enrollments — duplicates" subtitle="Merge / cancel repeated bookings" />
        <PeopleTabs active="enrollments" />
        <div className="card p-8 text-center"><p className="text-lg font-semibold">Super Admin only</p><p className="mt-1 text-sm text-ink2">This tool is restricted to super administrators.</p></div>
      </div>
    );
  }
  if (!groups) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Enrollments — duplicates" subtitle="Operational lens — keep one canonical enrollment, cancel the rest (payment history is always preserved)." />
      <PeopleTabs active="enrollments" />

      {groups.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg font-semibold text-success">No duplicate enrollments 🎉</p>
          <p className="mt-1 text-sm text-ink2">Every student has at most one active enrollment per course.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const key = `${g.phone}|${g.course_id}`;
            const selectedKeep = keep[key] || g.enrollments.reduce((best, e) => (e.amount_paid > best.amount_paid ? e : best), g.enrollments[0]).id;
            const result = done[key];
            return (
              <div key={key} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold">{g.student_name || "—"} <span className="text-muted">· {g.phone}</span></h3>
                    <p className="text-sm text-ink2">{g.course_title} · <b className="text-danger">{g.count} active enrollments</b></p>
                  </div>
                  {g.hasMultiplePaid && (
                    <span className="pill pill-amber text-[11px]">⚠️ Multiple paid — verify before merging</span>
                  )}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.enrollments.map((e) => {
                    const outstanding = Math.max(0, e.total_fee - e.amount_paid);
                    const isKeep = selectedKeep === e.id;
                    return (
                      <label key={e.id} className={`cursor-pointer rounded-xl border-2 p-3 text-sm transition ${isKeep ? "border-primary bg-primary/5" : "border-line"}`}>
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-2">
                            <input type="radio" name={`keep-${key}`} checked={isKeep} onChange={() => setKeep((k) => ({ ...k, [key]: e.id }))} />
                            <b>{isKeep ? "Keep this" : "Cancel"}</b>
                          </span>
                          <span className={`pill text-[10px] ${e.amount_paid > 0 ? "pill-green" : "pill-gray"}`}>{e.status}</span>
                        </div>
                        <div className="mt-2 space-y-0.5 text-xs text-ink2">
                          <div>Fee: <b>{formatINR(e.total_fee)}</b></div>
                          <div>Paid: <b>{formatINR(e.amount_paid)}</b></div>
                          <div>Outstanding: <b>{formatINR(outstanding)}</b></div>
                          <div className="text-muted">{fmtDate(e.created_at)}</div>
                          <div className="truncate font-mono text-[10px] text-muted">{e.id}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <input
                    className="input flex-1 min-w-[200px]"
                    placeholder="Reason (logged in audit trail)"
                    value={reason[key] || ""}
                    onChange={(e) => setReason((r) => ({ ...r, [key]: e.target.value }))}
                  />
                  <button className="btn btn-primary text-sm disabled:opacity-60" disabled={busy === key} onClick={() => merge(g)}>
                    {busy === key ? "Merging…" : `Merge → keep 1, cancel ${g.count - 1}`}
                  </button>
                </div>

                {result && (
                  <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                    {result.ok
                      ? `Merged ✓ Kept 1 enrollment, cancelled ${result.cancelledIds?.length ?? 0}. Outstanding ${formatINR(result.oldOutstanding ?? 0)} → ${formatINR(result.newOutstanding ?? 0)}.`
                      : result.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
