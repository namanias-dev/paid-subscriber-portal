"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, CalendarClock, CircleAlert, Info, Loader2, TriangleAlert, X } from "lucide-react";
import { formatINR, formatISTDate } from "@/lib/dates";

/**
 * Change Batch / Course.
 *
 * Four steps, but the third is the feature: an admin should not be able to move a
 * student without seeing what it does to their money and their deadlines. Every
 * figure shown here is computed on the server by the same function that performs
 * the transfer, so there is no way for the preview to flatter the outcome.
 */

interface BatchOption {
  id: string; label: string | null; resolvedLabel: string | null;
  startDate: string | null; price: number; payInFullPrice: number | null;
  capacity: number | null; seatsLeft: number | null;
}
interface CourseOption { id: string; title: string; slug: string; batches: BatchOption[] }
interface Line {
  no: number; kind: string; label: string; amount: number;
  oldDue: string | null; newDue: string | null; paid: boolean; effect: string;
}
interface Plan {
  blocks: { code: string; detail: string; overridable: boolean }[];
  warnings: { code: string; detail: string }[];
  source: { courseTitle: string; batchLabel: string | null; start: Start; status: string };
  target: { courseTitle: string; batchLabel: string | null; start: Start; courseChanged: boolean };
  money: {
    oldTotal: number; newTotal: number; delta: number; direction: string;
    amountPaid: number; oldOutstanding: number; newOutstanding: number; creditDue: number; detail: string;
  };
  schedule: { shiftDays: number | null; changes: Line[] };
  seats: { source: { seatsLeft: number | null; after: number | null }; target: { seatsLeft: number | null; after: number | null } };
  financiallyNeutral: boolean;
}
interface Start { iso: string | null; provenance: string; detail: string; conflict: { catalogISO: string; labelISO: string } | null }
interface Current {
  enrollmentId: string; studentName: string; courseTitle: string; batchLabel: string | null;
  status: string; planType: string; totalFee: number; amountPaid: number; outstanding: number;
  schedule: { no: number; kind: string; label: string; amount: number; due: string | null; paid: boolean }[];
  createdAt: string;
}

export default function TransferModal({
  enrollmentId, onClose, onDone,
}: { enrollmentId: string; onClose: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState<Current | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [sourceBatches, setSourceBatches] = useState<BatchOption[]>([]);
  const [changeCourse, setChangeCourse] = useState(false);
  const [targetCourseId, setTargetCourseId] = useState<string | null>(null);
  const [targetBatchId, setTargetBatchId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [override, setOverride] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ to: string; batch: string | null } | null>(null);

  async function load(courseId: string | null, batchId: string | null) {
    const res = await fetch("/api/admin/enrollments/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enrollmentId, targetCourseId: courseId, targetBatchId: batchId }),
    });
    const j = await res.json();
    if (!j.ok) { setError(j.error ?? "Could not load this enrollment."); return; }
    setCurrent(j.current);
    setCourses(j.courses ?? []);
    setSourceBatches(j.sourceBatches ?? []);
    setPlan(j.plan ?? null);
  }

  useEffect(() => {
    load(null, null).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollmentId]);

  useEffect(() => {
    if (!targetBatchId) { setPlan(null); return; }
    setBusy(true);
    load(targetCourseId, targetBatchId).finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCourseId, targetBatchId]);

  const availableBatches = useMemo(() => {
    if (!changeCourse) return sourceBatches;
    return courses.find((c) => c.id === targetCourseId)?.batches ?? [];
  }, [changeCourse, sourceBatches, courses, targetCourseId]);

  const hardBlocks = (plan?.blocks ?? []).filter((b) => !b.overridable);
  const softBlocks = (plan?.blocks ?? []).filter((b) => b.overridable);
  const canCommit =
    !!plan && !hardBlocks.length && (!softBlocks.length || override) &&
    reason.trim().length >= 5 && confirmText.trim().toUpperCase() === "TRANSFER";

  async function commit() {
    if (!canCommit || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/admin/enrollments/transfer", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentId, targetCourseId: changeCourse ? targetCourseId : null, targetBatchId, reason: reason.trim(), overrideCapacity: override }),
      });
      const j = await res.json();
      if (!j.ok) { setError(j.error ?? "The transfer did not go through."); return; }
      setDone({ to: j.to.courseTitle, batch: j.to.batchLabel });
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
      <div className="w-full max-w-3xl rounded-2xl border border-line bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-bold text-ink">Change batch or course</h2>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-8 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : done ? (
          <div className="p-6">
            <p className="text-sm font-semibold text-ink">Transferred.</p>
            <p className="mt-1 text-sm text-ink2">{current?.studentName} is now in {done.to}{done.batch ? ` · ${done.batch}` : ""}.</p>
            <p className="mt-2 text-xs text-muted">The previous enrollment was kept and marked transferred out, so attendance, results and receipts still point at the batch they were earned in.</p>
            <button onClick={onClose} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">Close</button>
          </div>
        ) : (
          <div className="max-h-[75vh] space-y-5 overflow-y-auto p-5">
            {/* ---------- STEP 1 ---------- */}
            <Section n={1} title="Where they are now">
              {current && (
                <div className="rounded-xl border border-line bg-surface2/40 p-3 text-sm">
                  <p className="font-semibold text-ink">{current.courseTitle}</p>
                  <p className="text-xs text-ink2">{current.batchLabel ?? "No batch recorded"} · enrolled {formatISTDate(current.createdAt)} · status {current.status}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <Figure label="Total fee" value={formatINR(current.totalFee)} />
                    <Figure label="Paid" value={formatINR(current.amountPaid)} />
                    <Figure label="Outstanding" value={formatINR(current.outstanding)} />
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-ink2">
                    {current.schedule.map((l) => (
                      <li key={l.no}>
                        {l.paid ? "✓" : "○"} {l.label} · {formatINR(l.amount)}{l.due ? ` · due ${formatISTDate(l.due)}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>

            {/* ---------- STEP 2 ---------- */}
            <Section n={2} title="Where they are going">
              <label className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink2">
                <input type="checkbox" checked={changeCourse} onChange={(e) => { setChangeCourse(e.target.checked); setTargetCourseId(null); setTargetBatchId(null); }} />
                Change the course too
              </label>
              {changeCourse && (
                <select
                  value={targetCourseId ?? ""}
                  onChange={(e) => { setTargetCourseId(e.target.value || null); setTargetBatchId(null); }}
                  className="mb-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                >
                  <option value="">Select a course…</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              )}
              <select
                value={targetBatchId ?? ""}
                onChange={(e) => setTargetBatchId(e.target.value || null)}
                disabled={changeCourse && !targetCourseId}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">Select a batch…</option>
                {availableBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.resolvedLabel ?? b.label ?? b.id}
                    {b.startDate ? ` — starts ${formatISTDate(b.startDate)}` : " — no start date on record"}
                    {b.seatsLeft != null ? ` · ${b.seatsLeft} seat${b.seatsLeft === 1 ? "" : "s"} left` : ""}
                  </option>
                ))}
              </select>
              {!availableBatches.length && (
                <p className="mt-1.5 text-xs text-muted">This course has no batches defined in the catalog, so there is nothing to transfer into.</p>
              )}
            </Section>

            {/* ---------- STEP 3 ---------- */}
            {busy && !plan && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Working out the impact…</p>}
            {plan && (
              <Section n={3} title="What this will do">
                {hardBlocks.map((b) => (
                  <Banner key={b.code} tone="danger" icon={<CircleAlert size={14} />}>{b.detail}</Banner>
                ))}
                {softBlocks.map((b) => (
                  <div key={b.code}>
                    <Banner tone="danger" icon={<CircleAlert size={14} />}>{b.detail}</Banner>
                    <label className="mt-1 flex items-center gap-2 text-xs font-semibold text-danger">
                      <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                      Override capacity and record that I did
                    </label>
                  </div>
                ))}

                {/* the money */}
                <div className={`rounded-xl border p-3 ${plan.financiallyNeutral ? "border-line bg-surface2/40" : "border-warning/40 bg-warning/5"}`}>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Money</p>
                  <div className="mt-1.5 grid grid-cols-4 gap-2 text-xs">
                    <Figure label="Fee before" value={formatINR(plan.money.oldTotal)} />
                    <Figure label="Fee after" value={formatINR(plan.money.newTotal)} />
                    <Figure label="Already paid" value={formatINR(plan.money.amountPaid)} />
                    <Figure label="Outstanding after" value={formatINR(plan.money.newOutstanding)} />
                  </div>
                  <p className="mt-2 text-xs text-ink2">{plan.money.detail}</p>
                  {plan.money.creditDue > 0 && (
                    <p className="mt-1 text-xs font-semibold text-warning">Credit due {formatINR(plan.money.creditDue)} — flagged for manual handling, nothing is refunded here.</p>
                  )}
                </div>

                {/* THE DATE CHANGE — the financially meaningful part of a same-fee move */}
                <div className="rounded-xl border border-line bg-surface2/40 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted"><CalendarClock size={13} /> Batch start and due dates</p>
                  <div className="mt-1.5 flex items-center gap-2 text-sm">
                    <span className="text-ink2">{plan.source.start.iso ? formatISTDate(plan.source.start.iso) : "unknown"}</span>
                    <ArrowRight size={14} className="text-muted" />
                    <span className="font-semibold text-ink">{plan.target.start.iso ? formatISTDate(plan.target.start.iso) : "unknown"}</span>
                    {plan.schedule.shiftDays != null && plan.schedule.shiftDays !== 0 && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${plan.schedule.shiftDays > 0 ? "bg-warning/15 text-warning" : "bg-success/15 text-success"}`}>
                        {plan.schedule.shiftDays > 0 ? "+" : ""}{plan.schedule.shiftDays} days
                      </span>
                    )}
                  </div>
                  {/* provenance — so a bad parse is caught by a human before it commits */}
                  <Provenance start={plan.target.start} which="new" />
                  <Provenance start={plan.source.start} which="current" />
                </div>

                {/* schedule side by side */}
                <div className="overflow-hidden rounded-xl border border-line">
                  <table className="w-full text-xs">
                    <thead className="bg-surface2/60 text-muted">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-semibold">Line</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Amount</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Due now</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Due after</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Effect</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.schedule.changes.map((l) => (
                        <tr key={`${l.no}-${l.label}`} className="border-t border-line">
                          <td className="px-2 py-1.5 text-ink2">{l.paid ? "✓ " : ""}{l.label}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-ink">{formatINR(l.amount)}</td>
                          <td className="px-2 py-1.5 text-muted">{l.oldDue ? formatISTDate(l.oldDue) : "—"}</td>
                          <td className={`px-2 py-1.5 ${l.effect === "shifted" ? "font-semibold text-warning" : "text-muted"}`}>{l.newDue ? formatISTDate(l.newDue) : "—"}</td>
                          <td className="px-2 py-1.5 text-muted">{EFFECT[l.effect] ?? l.effect}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {plan.warnings.map((w) => (
                  <Banner key={w.code} tone={w.code === "deadline_moves_later" || w.code === "credit_due" ? "warn" : "info"} icon={w.code === "start_date_parsed" || w.code === "label_disagrees_with_catalog" ? <TriangleAlert size={14} /> : <Info size={14} />}>
                    {w.detail}
                  </Banner>
                ))}

                {/* seats + access */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-line bg-surface2/40 p-3">
                    <p className="flex items-center gap-1.5 font-bold uppercase tracking-wide text-muted"><Building2 size={13} /> Seats</p>
                    <p className="mt-1 text-ink2">Target {seatText(plan.seats.target.seatsLeft, plan.seats.target.after)}</p>
                    <p className="text-ink2">Source {seatText(plan.seats.source.seatsLeft, plan.seats.source.after)}</p>
                  </div>
                  <div className="rounded-xl border border-line bg-surface2/40 p-3">
                    <p className="font-bold uppercase tracking-wide text-muted">Access</p>
                    <p className="mt-1 text-ink2">
                      {plan.target.courseChanged
                        ? "Course changes, so Class Hub content follows the new course. Past attendance and results stay attached to the old batch."
                        : "Same course, so Class Hub content is unchanged. Past attendance and results stay attached to the old batch."}
                    </p>
                  </div>
                </div>
              </Section>
            )}

            {/* ---------- STEP 4 ---------- */}
            {plan && !hardBlocks.length && (
              <Section n={4} title="Reason and confirmation">
                <textarea
                  value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                  placeholder="Why is this student being moved? (required, recorded in the transfer history)"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                />
                <input
                  value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                  placeholder='Type TRANSFER to confirm'
                  className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                />
                {error && <p className="mt-2 text-xs font-semibold text-danger">{error}</p>}
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={commit} disabled={!canCommit || busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                    {busy && <Loader2 size={14} className="animate-spin" />}
                    Transfer {current?.studentName}
                  </button>
                  <button onClick={onClose} className="text-sm font-semibold text-muted hover:text-ink">Cancel</button>
                </div>
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const EFFECT: Record<string, string> = {
  untouched_paid: "paid — untouched",
  shifted: "moved",
  unchanged: "unchanged",
  amount_adjusted: "amount adjusted",
  added: "added",
};

function seatText(before: number | null, after: number | null) {
  if (before == null) return "— this batch does not track seats";
  return `${before} → ${after}`;
}

function Provenance({ start, which }: { start: Start; which: "new" | "current" }) {
  const tone = start.provenance === "catalog" ? "text-muted" : "text-warning";
  return (
    <p className={`mt-1 text-xs ${tone}`}>
      <span className="font-semibold">{which === "new" ? "New" : "Current"} start date — {LABEL[start.provenance]}:</span> {start.detail}
      {start.iso && <> Derived timestamp <code className="rounded bg-surface2 px-1">{start.iso}</code>.</>}
    </p>
  );
}
const LABEL: Record<string, string> = {
  catalog: "from the catalog",
  parsed_label: "PARSED FROM THE LABEL, please check",
  unknown: "not available",
};

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface2 text-[10px] text-ink">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted">{label}</p>
      <p className="font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}
function Banner({ tone, icon, children }: { tone: "danger" | "warn" | "info"; icon: React.ReactNode; children: React.ReactNode }) {
  const cls = tone === "danger" ? "border-danger/40 bg-danger/5 text-danger"
    : tone === "warn" ? "border-warning/40 bg-warning/5 text-warning"
    : "border-line bg-surface2/40 text-ink2";
  return <p className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${cls}`}>{icon}<span>{children}</span></p>;
}
