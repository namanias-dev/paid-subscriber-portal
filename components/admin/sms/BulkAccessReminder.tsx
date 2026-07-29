"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2, Send, X } from "lucide-react";
import { formatINR, formatISTDate } from "@/lib/dates";
import type { AccessReminderPreview } from "@/lib/sms/accessReminderService";
import {
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
} from "@/lib/sms/accessReminderConstants";

/**
 * Bulk access reminders: sticky action bar → review screen → explicit send.
 *
 * The first click NEVER sends. It opens a review screen that lists every
 * selected student with the exact body that would go to them, and sending is a
 * separate action behind a typed confirmation once the count passes 10.
 *
 * Every figure here comes from the server's own resolver — the same one the
 * single-student button and the send route use — so what staff approve is what
 * goes out. The UI does not decide who is sendable; it displays the server's
 * decision and its reason.
 */

const CONFIRM_TYPING_THRESHOLD = 10;

/** Human wording for each server-side exclusion reason. */
const REASON_LABELS: Record<string, string> = {
  enrollment_not_found: "Enrollment no longer exists",
  missing_phone: "No phone number on record",
  invalid_mobile: "Phone is not a valid Indian mobile",
  template_missing: "Reminder template is not configured",
  template_inactive: "Reminder template is not active",
  no_dlt_id: "Template has no DLT id",
  opted_out: "Opted out of SMS",
  no_active_enrollment: "No confirmed, non-cancelled enrollment",
  no_unpaid_installment: "No unpaid installment",
  seat_booking_only: "Only an unpaid seat booking — needs admission follow-up",
  not_yet_due: "Installment is not overdue yet",
  zero_balance: "Nothing left to pay",
  render_blocked: "Could not resolve the message safely",
  invalid_body: "Rendered message failed validation",
  kill_switch: "Kill switch is ON",
  quiet_hours: "Quiet hours (outside 09:00–20:00 IST)",
  already_sent_today: "Already messaged today (IST)",
  daily_ceiling: "Daily volume ceiling reached",
  needs_call: "Flagged for call — not bulk-selectable",
  days_not_positive: "Days ≤ 0 — no Expiring send",
  not_access_risk: "Not an access-risk case",
  unknown: "Excluded",
};

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return REASON_LABELS.unknown!;
  return REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}

interface BulkPreview {
  previews: AccessReminderPreview[];
  blockReason: string | null;
  blockDetail: string | null;
  sendableCount: number;
  excludedCount: number;
  excludedByReason: Record<string, number>;
  totalSegments: number;
  overCapDropped: number;
}

/**
 * Step 2 of the sequence. IDENTICAL for every recipient — the approved body has
 * no variables — so the review screen shows it once rather than repeating the
 * same 160 characters under every student.
 */
interface FollowUpPreview {
  templateName: string;
  dltTemplateId: string | null;
  body: string;
  characterCount: number;
  segments: number;
  delayMinutes: number;
  sendable: boolean;
  blockDetail: string | null;
}

interface SendOutcome {
  ok: boolean;
  replay: boolean;
  jobId: string;
  requested: number;
  sent: number;
  failed: number;
  skipped: Record<string, number>;
  excludedByReason?: Record<string, number>;
  followUpsScheduled?: number;
  followUpDelayMinutes?: number;
  note?: string;
  error?: string;
  /** Present when this outcome came from a retry, describing what it targeted. */
  retryOf?: { of: string; targets: number; reached: number; skipped: Record<string, number> } | null;
}

export default function BulkAccessReminder({
  selectedIds,
  onClear,
  onSent,
  killSwitch = false,
  quietHours = false,
}: {
  selectedIds: string[];
  onClear: () => void;
  /** Called after a send so the table can refresh. */
  onSent: () => void;
  /** From Access At Risk list payload — disables the sticky send button. */
  killSwitch?: boolean;
  quietHours?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [followUp, setFollowUp] = useState<FollowUpPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [confirmText, setConfirmText] = useState("");
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  /**
   * Minted once per review session and reused for every attempt, so a
   * double-click, a refresh or a retry cannot turn into a second send: the
   * server treats a job id it has already logged as a no-op replay.
   */
  const [jobId, setJobId] = useState<string | null>(null);
  const [templateCounts, setTemplateCounts] = useState<{ expiring: number; blocked: number }>({ expiring: 0, blocked: 0 });
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [guardsQuiet, setGuardsQuiet] = useState(quietHours);
  useEffect(() => { setGuardsQuiet(quietHours); }, [quietHours]);

  const openReview = useCallback(async () => {
    if (killSwitch) return;
    setOpen(true);
    setLoading(true);
    setError(null);
    setPreview(null);
    setFollowUp(null);
    setOutcome(null);
    setExcluded(new Set());
    setConfirmText("");
    setJobId(globalThis.crypto?.randomUUID?.() ?? `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    try {
      const res = await fetch("/api/admin/sms/access-reminder/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentIds: selectedIds }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not build the review.");
      setPreview(json.preview as BulkPreview);
      setFollowUp((json.followUp as FollowUpPreview) ?? null);
      setGuardsQuiet(!!json.guards?.quietHours);
      setTemplateCounts(json.templateBreakdown || { expiring: 0, blocked: 0 });
      setLiveNote(typeof json.liveNote === "string" ? json.liveNote : null);
      if (json.guards?.killSwitch) {
        setError("Kill switch is ON — bulk send is disabled.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the review.");
    } finally {
      setLoading(false);
    }
  }, [selectedIds, killSwitch]);

  const close = () => { if (!sending) setOpen(false); };

  const sendableRows = useMemo(
    () => (preview?.previews ?? []).filter((p) => p.sendable && !excluded.has(p.enrollmentId)),
    [preview, excluded],
  );
  const blockedRows = useMemo(
    () => (preview?.previews ?? []).filter((p) => !p.sendable),
    [preview],
  );
  const liveTemplateCounts = useMemo(() => {
    let expiring = 0;
    let blocked = 0;
    for (const p of sendableRows) {
      if (p.templateId === ACCESS_EXPIRING_TEMPLATE_ID) expiring++;
      else if (p.templateId === ACCESS_BLOCKED_TEMPLATE_ID) blocked++;
    }
    return { expiring, blocked };
  }, [sendableRows]);
  const reminderSegments = sendableRows.reduce((a, p) => a + p.segments, 0);
  // TRUE cost of the sequence: every recipient gets the instructions too, so a
  // total that counted step 1 alone would understate the bill by half.
  const followUpSegments = followUp?.sendable ? followUp.segments * sendableRows.length : 0;
  const totalSegments = reminderSegments + followUpSegments;
  const needsTyping = sendableRows.length > CONFIRM_TYPING_THRESHOLD;
  const confirmOk = !needsTyping || confirmText.trim() === String(sendableRows.length);

  async function send(retryFailedOnly = false) {
    if (!preview || !jobId || sending || killSwitch) return;
    if (retryFailedOnly && !outcome?.jobId) return;
    setSending(true);
    setError(null);
    try {
      // Retry names the CAMPAIGN only — never re-posts the review list (that
      // previously re-texted students who already got the message).
      const res = await fetch("/api/admin/sms/access-reminder/bulk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          retryFailedOnly
            ? {
                retryOf: outcome!.jobId,
                jobId: globalThis.crypto?.randomUUID?.() ?? `job-${Date.now()}-retry`,
              }
            : {
                enrollmentIds: sendableRows.map((p) => p.enrollmentId),
                jobId,
              },
        ),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "The send failed.");
      setOutcome(json as SendOutcome);
      if (json.templateBreakdown) setTemplateCounts(json.templateBreakdown);
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The send failed.");
    } finally {
      setSending(false);
    }
  }

  /** Result summary for follow-up: who went, who did not, and why. */
  function downloadCsv() {
    if (!preview) return;
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const sentIds = new Set(outcome ? sendableRows.map((p) => p.enrollmentId) : []);
    const rows = [
      ["outcome", "enrollment_id", "installment_no", "installment_key", "student", "masked_phone", "course", "batch", "amount_due", "days_overdue", "prior_reminder_count", "segments", "instructions_followup", "excluded_reason"],
      ...preview.previews.map((p) => [
        p.sendable
          ? (excluded.has(p.enrollmentId) ? "excluded_by_staff" : (outcome ? (sentIds.has(p.enrollmentId) ? "sent" : "not_sent") : "ready"))
          : "auto_excluded",
        p.enrollmentId,
        p.installmentNo ?? "",
        p.installmentKey ? `${p.installmentKey.courseEnrollmentId}#${p.installmentKey.installmentNo}` : "",
        p.studentName,
        // Masked, never the real number: this file gets emailed around.
        p.maskedPhone,
        p.courseTitle,
        p.batchLabel ?? "",
        p.amountDue ?? "",
        p.daysLeft ?? "",
        p.priorReminderCount,
        p.segments,
        // Only a reminder that went out can have a follow-up, so this mirrors the
        // outcome rather than claiming a queue entry that does not exist.
        p.sendable && !excluded.has(p.enrollmentId) && outcome && !outcome.replay && followUp?.sendable
          ? `scheduled +${followUp.delayMinutes}m`
          : "",
        p.sendable ? (excluded.has(p.enrollmentId) ? "excluded in review" : "") : reasonLabel(p.blockReason),
      ]),
    ];
    const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `access-reminders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!selectedIds.length) return null;

  const sendDisabled = killSwitch || selectedIds.length === 0;
  const sendTitle = killSwitch
    ? "Kill switch is ON — bulk access SMS is disabled"
    : `Review and send reminders to ${selectedIds.length} selected`;

  return (
    <>
      {/* Sticky action bar — only exists once something is selected */}
      <div className="sticky bottom-0 z-40 -mx-1 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
        <div>
          <p className="text-sm text-ink2">
            <strong className="text-ink">{selectedIds.length}</strong> selected
          </p>
          {killSwitch && (
            <p className="mt-0.5 text-[11px] font-semibold text-danger">Kill switch ON — bulk send disabled</p>
          )}
          {!killSwitch && guardsQuiet && (
            <p className="mt-0.5 text-[11px] text-amber-700">Quiet hours — review will show skips, not silent drops</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onClear} className="btn btn-secondary text-sm">Clear</button>
          <button
            onClick={openReview}
            disabled={sendDisabled}
            title={sendTitle}
            className="btn btn-primary inline-flex items-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={14} /> Send reminders ({selectedIds.length})
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={close}>
          <div
            className="card flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden p-0"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Review access reminders"
          >
            {/* ---- header: totals, exclusions, DLT id ---- */}
            <div className="flex items-start justify-between gap-3 border-b border-line p-4">
              <div>
                <h3 className="text-base font-bold">Review access reminders</h3>
                {preview && (
                  <p className="mt-1 text-xs text-ink2">
                    <strong className="text-ink">{sendableRows.length}</strong> to send ·{" "}
                    <strong>{preview.excludedCount + excluded.size}</strong> excluded ·{" "}
                    <strong>{totalSegments}</strong> segment{totalSegments === 1 ? "" : "s"} for both steps
                    {followUpSegments > 0 && ` (${reminderSegments} + ${followUpSegments})`}
                    {followUp?.dltTemplateId ? ` · instructions DLT ${followUp.dltTemplateId}` : ""}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-muted">
                  Each reminder refers to that student&apos;s <strong>oldest unpaid installment</strong>. Nothing sends until you press Send below.
                </p>
                {preview && (
                  <p className="mt-1 text-[11px] text-ink2">
                    Templates: <strong className="text-ink">{liveTemplateCounts.expiring}</strong> × Expiring ·{" "}
                    <strong className="text-ink">{liveTemplateCounts.blocked}</strong> × Blocked
                    {(preview.excludedCount > 0 || excluded.size > 0) && (
                      <> · <strong>{preview.excludedCount + excluded.size}</strong> skipped</>
                    )}
                  </p>
                )}
                {liveNote && (
                  <p className="mt-1 text-[11px] font-semibold text-danger">{liveNote}</p>
                )}
              </div>
              <button onClick={close} aria-label="Close" className="rounded-lg p-1 text-muted hover:text-ink"><X size={18} /></button>
            </div>

            {/* ---- scrollable body: one screen, every recipient ---- */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loading && (
                <p className="inline-flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={14} className="animate-spin" /> Resolving {selectedIds.length} students…
                </p>
              )}

              {error && (
                <p className="mb-3 rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>
              )}

              {preview?.blockDetail && (
                <p className="mb-3 inline-flex items-start gap-2 rounded-xl bg-danger/10 p-3 text-sm text-danger">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> <span>{preview.blockDetail}</span>
                </p>
              )}

              {preview && preview.overCapDropped > 0 && (
                <p className="mb-3 rounded-xl bg-warning/10 p-3 text-xs text-amber-700">
                  A single job is capped at 500 recipients. {preview.overCapDropped} of your selection were not included — send them in a second job.
                </p>
              )}

              {/* Step 2, shown once because it is the same message for everyone */}
              {followUp && !loading && (
                <div className={`mb-4 rounded-xl border p-3 ${followUp.sendable ? "border-line bg-surface2/60" : "border-danger/40 bg-danger/5"}`}>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <span className="rounded bg-surface px-1.5 py-0.5 text-ink2">+{followUp.delayMinutes} min</span> {followUp.templateName}
                      {" "}— identical for every recipient
                    </p>
                    <p className="text-[10px] text-muted">
                      {followUp.segments} seg each · {followUp.characterCount} chars
                      {followUp.dltTemplateId ? ` · DLT ${followUp.dltTemplateId}` : " · no DLT id"}
                    </p>
                  </div>
                  <p className="whitespace-pre-wrap text-xs text-ink">{followUp.body || "—"}</p>
                  <p className={`mt-1.5 text-[11px] ${followUp.sendable ? "text-muted" : "text-danger"}`}>
                    {followUp.sendable
                      ? `Queued per student and re-checked when it fires: anyone who has paid, opted out, or had their plan changed in the meantime is cancelled with a reason instead of being sent this.`
                      : followUp.blockDetail ?? "This follow-up cannot be sent, so only the reminder will go out."}
                  </p>
                </div>
              )}

              {outcome && (
                <div className="mb-4 rounded-xl border border-line bg-surface p-3">
                  <p className="text-sm font-semibold text-ink">
                    {outcome.replay
                      ? "This job already ran — nothing was sent again."
                      : outcome.note
                        ? outcome.note
                        : `Sent ${outcome.sent} of ${outcome.requested}${outcome.failed ? ` · ${outcome.failed} failed` : ""}`}
                  </p>
                  {outcome.retryOf && (
                    <p className="mt-0.5 text-xs text-ink2">
                      Retry targeted the {outcome.retryOf.targets} recipient
                      {outcome.retryOf.targets === 1 ? "" : "s"} nothing reached.
                      {" "}The {outcome.retryOf.reached} already reached were not contacted again.
                    </p>
                  )}
                  {!outcome.replay && !!outcome.followUpsScheduled && (
                    <p className="mt-0.5 text-xs text-ink2">
                      {outcome.followUpsScheduled} instructions follow-up{outcome.followUpsScheduled === 1 ? "" : "s"} scheduled
                      {" "}in {outcome.followUpDelayMinutes ?? 30}m. They can be cancelled from the pending list until they fire.
                    </p>
                  )}
                  {!!Object.keys(outcome.skipped || {}).length && (
                    <p className="mt-1 text-xs text-ink2">
                      Skipped: {Object.entries(outcome.skipped).map(([k, n]) => `${reasonLabel(k)} (${n})`).join(" · ")}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button onClick={downloadCsv} className="btn btn-secondary inline-flex items-center gap-1.5 text-xs">
                      <Download size={13} /> Download result summary (CSV)
                    </button>
                    {outcome.failed > 0 && (
                      <button onClick={() => send(true)} disabled={sending} className="btn btn-secondary text-xs">
                        Retry failed only
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Auto-excluded, always shown with the reason — never silent */}
              {blockedRows.length > 0 && (
                <details className="mb-4 rounded-xl border border-line bg-surface2/60 p-3" open={sendableRows.length === 0}>
                  <summary className="cursor-pointer text-xs font-semibold text-ink2">
                    {blockedRows.length} automatically excluded — reasons
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {blockedRows.map((p) => (
                      <li key={p.enrollmentId} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                        <span className="text-ink2">
                          {p.studentName || p.enrollmentId} <span className="font-mono text-[11px] text-muted">{p.maskedPhone}</span>
                        </span>
                        <span className="text-danger">{reasonLabel(p.blockReason)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* Every student who WILL be sent, with their exact body */}
              {preview?.previews.filter((p) => p.sendable).map((p) => {
                const isExcluded = excluded.has(p.enrollmentId);
                return (
                  <div key={p.enrollmentId} className={`mb-3 rounded-xl border border-line p-3 ${isExcluded ? "opacity-50" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">
                          {p.studentName} <span className="ml-1 font-mono text-[11px] font-normal text-muted">{p.maskedPhone}</span>
                        </p>
                        <p className="truncate text-xs text-muted">
                          {p.courseTitle}{p.batchLabel ? ` · ${p.batchLabel}` : ""}
                        </p>
                      </div>
                      <label className="inline-flex shrink-0 items-center gap-1.5 text-xs text-ink2">
                        <input
                          type="checkbox"
                          checked={isExcluded}
                          onChange={() => setExcluded((prev) => {
                            const next = new Set(prev);
                            if (next.has(p.enrollmentId)) next.delete(p.enrollmentId); else next.add(p.enrollmentId);
                            return next;
                          })}
                          className="h-3.5 w-3.5 accent-[color:var(--primary)]"
                        />
                        Exclude
                      </label>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
                      <span>Installment <strong className="text-ink">no. {p.installmentNo}</strong></span>
                      <span>{p.amountDue != null ? formatINR(p.amountDue) : "—"}</span>
                      <span>{p.dueDate ? `due ${formatISTDate(p.dueDate)}` : "no due date"}</span>
                      <span className={p.accessStatus === "blocked" ? "text-danger" : "text-amber-700"}>
                        {p.templateId === ACCESS_EXPIRING_TEMPLATE_ID
                          ? `Expiring · ${p.daysLeft ?? "?"}d`
                          : p.templateId === ACCESS_BLOCKED_TEMPLATE_ID
                            ? "Blocked"
                            : (p.accessStatus || "—")}
                      </span>
                      <span>{p.segments} seg</span>
                      {p.priorReminderCount > 0 && <span className="text-amber-700">{p.priorReminderCount} prior reminder{p.priorReminderCount === 1 ? "" : "s"}</span>}
                    </div>

                    <p className="mt-2 whitespace-pre-wrap rounded-lg bg-surface p-2 text-xs text-ink">{p.body}</p>

                    {p.warnings.map((w) => (
                      <p key={w} className="mt-1.5 text-[11px] text-amber-700">{w}</p>
                    ))}
                  </div>
                );
              })}

              {preview && preview.previews.filter((p) => p.sendable).length === 0 && !loading && (
                <p className="rounded-xl bg-surface2 p-4 text-sm text-ink2">
                  None of the selected students can be sent an installment reminder right now. The reasons are listed above.
                </p>
              )}
            </div>

            {/* ---- footer: the explicit second action ---- */}
            <div className="border-t border-line p-4">
              {needsTyping && !outcome && (
                <div className="mb-3">
                  <label className="text-xs text-ink2">
                    This will message <strong className="text-ink">{sendableRows.length}</strong> students. Type <strong>{sendableRows.length}</strong> to confirm.
                  </label>
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    inputMode="numeric"
                    className="input mt-1 w-32 text-sm"
                    placeholder={String(sendableRows.length)}
                    aria-label="Type the recipient count to confirm"
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button onClick={downloadCsv} disabled={!preview} className="btn btn-secondary inline-flex items-center gap-1.5 text-xs">
                  <Download size={13} /> Export list (CSV)
                </button>
                <div className="flex items-center gap-2">
                  <button onClick={close} disabled={sending} className="btn btn-secondary text-sm">
                    {outcome ? "Close" : "Cancel"}
                  </button>
                  {!outcome && (
                    <button
                      onClick={() => send(false)}
                      disabled={sending || loading || !sendableRows.length || !confirmOk}
                      className="btn btn-primary inline-flex items-center gap-2 text-sm"
                      title={!confirmOk ? "Type the count to confirm" : `Send ${sendableRows.length} reminders now`}
                    >
                      {sending
                        ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
                        : <><Send size={14} /> Send {sendableRows.length} {followUp?.sendable ? "reminder + instructions" : `reminder${sendableRows.length === 1 ? "" : "s"}`}</>}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
