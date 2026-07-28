"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, IndianRupee, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatINR, formatISTDate } from "@/lib/dates";

/**
 * THE shared "Send access reminder" action. Every surface that shows a
 * student's pending installment mounts this same component — the resolution,
 * gating, preview and send logic exists once, so a page can't drift into
 * showing a different amount from the one that gets sent.
 *
 * Flow is deliberately two-step: opening the modal only PREVIEWS (the server
 * resolves and renders but sends nothing); sending needs a second, explicit
 * click on a button that is disabled whenever the server says the reminder is
 * not sendable. The server enforces the same rules independently — this UI is
 * the explanation, not the control.
 *
 * ONE CLICK SENDS A SEQUENCE, so the modal shows BOTH messages stacked, "Now"
 * and "+30 min", each with its own body, segment count and DLT id. Staff should
 * never learn about the second message from a student asking about it.
 */

interface VariableView {
  token: string;
  canonicalKey: string | null;
  value: string;
  resolved: boolean;
}

interface Preview {
  enrollmentId: string;
  studentName: string;
  maskedPhone: string;
  courseTitle: string;
  templateName: string;
  dltTemplateId: string | null;
  body: string;
  variables: VariableView[];
  installmentNo: number | null;
  amountDue: number | null;
  dueDate: string | null;
  accessStatus?: string;
  daysLeft?: number | null;
  unpaidCount: number;
  totalRemaining: number | null;
  characterCount: number;
  segments: number;
  sendable: boolean;
  blockReason: string | null;
  blockDetail: string | null;
  warnings: string[];
  lastSentAt: string | null;
}

/** Step 2 — identical for every student, so it is described once. */
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

export interface AccessReminderButtonProps {
  /** The specific enrollment being chased. Preferred — never ambiguous. */
  enrollmentId: string;
  /** Optional label override; defaults to a compact row action. */
  label?: string;
  className?: string;
  /** Render as a filled button rather than an inline text action. */
  variant?: "inline" | "button";
}

const DEFAULT_INLINE = "inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline";
const DEFAULT_BUTTON = "btn btn-secondary inline-flex items-center gap-1 text-sm";

export default function AccessReminderButton({
  enrollmentId, label = "Remind", className, variant = "inline",
}: AccessReminderButtonProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [followUp, setFollowUp] = useState<FollowUpPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true); setError(null); setPreview(null); setFollowUp(null);
    try {
      const res = await fetch("/api/admin/sms/access-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) setError(data.error || "Could not build the reminder preview.");
      else {
        setPreview(data.preview as Preview);
        setFollowUp((data.followUp as FollowUpPreview) ?? null);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [enrollmentId]);

  function openModal() {
    setOpen(true);
    void loadPreview();
  }

  function close() {
    setOpen(false); setPreview(null); setFollowUp(null); setError(null);
  }

  async function send() {
    if (!preview?.sendable) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/sms/access-reminder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentId, allowRepeat: !!preview.lastSentAt }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast(
          data.followUpScheduled
            ? `Reminder sent to ${data.maskedPhone} — installment ${data.installmentNo}. Instructions scheduled in ${data.followUpDelayMinutes}m.`
            : `Reminder sent to ${data.maskedPhone} — installment ${data.installmentNo}.`,
          "success",
        );
        close();
      } else {
        toast(data.error || "Send failed.", "error");
      }
    } catch {
      toast("Send failed.", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={className ?? (variant === "button" ? DEFAULT_BUTTON : DEFAULT_INLINE)}
        title="Preview and send the access reminder SMS"
      >
        <IndianRupee size={variant === "button" ? 15 : 13} /> {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div
            className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Access reminder preview"
          >
            <h3 className="text-base font-bold">Access reminder</h3>

            {loading && (
              <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted">
                <Loader2 size={14} className="animate-spin" /> Resolving this student&apos;s installment…
              </p>
            )}

            {error && !loading && (
              <p className="mt-3 rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>
            )}

            {preview && !loading && (
              <>
                <p className="mt-0.5 text-sm text-ink2">
                  {preview.studentName} · <span className="font-mono text-xs text-muted">{preview.maskedPhone}</span>
                </p>
                <p className="text-xs text-muted">{preview.courseTitle}</p>

                {/* Resolved facts — what this message is about */}
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Fact label="Access" value={preview.accessStatus || "—"} tone={preview.accessStatus === "blocked" ? "text-danger" : "text-amber-700"} />
                  <Fact label="Installment" value={preview.installmentNo != null ? `No. ${preview.installmentNo}` : "—"} />
                  <Fact label="Amount due" value={preview.amountDue != null ? formatINR(preview.amountDue) : "—"} />
                  <Fact
                    label={preview.accessStatus === "grace" ? "Days left" : "Due date"}
                    value={preview.accessStatus === "grace"
                      ? (preview.daysLeft != null ? String(preview.daysLeft) : "—")
                      : (preview.dueDate ? formatISTDate(preview.dueDate) : "—")}
                    sub={`${preview.segments} seg · ${preview.characterCount} chars`}
                  />
                </div>

                {preview.unpaidCount > 1 && (
                  <p className="mt-2 text-xs text-ink2">
                    This student has <strong>{preview.unpaidCount} unpaid installments</strong>. This reminder refers to the
                    {" "}<strong>oldest unpaid</strong> one (no. {preview.installmentNo}).
                  </p>
                )}

                {/* Both legs of the sequence, in the order the student gets them */}
                <div className="mt-3 space-y-2">
                  <MessageCard
                    when="Now"
                    title={preview.templateName}
                    body={preview.body}
                    segments={preview.segments}
                    characterCount={preview.characterCount}
                    dltTemplateId={preview.dltTemplateId}
                  />
                  {followUp && (
                    <MessageCard
                      when={`+${followUp.delayMinutes} min`}
                      title={followUp.templateName}
                      body={followUp.body}
                      segments={followUp.segments}
                      characterCount={followUp.characterCount}
                      dltTemplateId={followUp.dltTemplateId}
                      note={
                        followUp.sendable
                          ? "Cancelled automatically if this installment is paid, the student opts out, or the plan changes before it fires."
                          : followUp.blockDetail ?? "This follow-up cannot be sent."
                      }
                      tone={followUp.sendable ? "muted" : "danger"}
                    />
                  )}
                </div>

                {/* Per-token resolution, so staff can see nothing is left raw */}
                <div className="mt-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Resolved variables</p>
                  <ul className="space-y-1">
                    {preview.variables.map((v) => (
                      <li key={v.token} className="flex items-baseline justify-between gap-3 text-xs">
                        <code className="shrink-0 rounded bg-surface2 px-1 py-0.5 text-[11px] text-ink2">{`{${v.token}}`}</code>
                        <span className={`truncate text-right font-medium ${v.resolved ? "text-success" : "text-danger"}`}>
                          {v.resolved ? v.value : "unresolved"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {!preview.sendable && (
                  <p className="mt-3 inline-flex items-start gap-2 rounded-xl bg-danger/10 p-3 text-sm text-danger">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <span>{preview.blockDetail || "This reminder cannot be sent."}</span>
                  </p>
                )}

                {preview.warnings.map((w) => (
                  <p key={w} className="mt-2 inline-flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-xs text-amber-700">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </p>
                ))}
              </>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={close} className="btn btn-secondary text-sm">Cancel</button>
              <button
                onClick={send}
                disabled={!preview?.sendable || sending || loading}
                className="btn btn-primary text-sm"
                title={preview && !preview.sendable ? (preview.blockDetail ?? undefined) : "Send this reminder now"}
              >
                {sending
                  ? "Sending…"
                  : preview?.lastSentAt
                    ? "Send anyway"
                    : followUp?.sendable ? "Send reminder + instructions" : "Send reminder"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * One message in the sequence. Carries its own DLT id because the two legs are
 * separate registrations — showing a single id would misrepresent what goes out.
 */
function MessageCard({
  when, title, body, segments, characterCount, dltTemplateId, note, tone,
}: {
  when: string;
  title: string;
  body: string;
  segments: number;
  characterCount: number;
  dltTemplateId: string | null;
  note?: string;
  tone?: "muted" | "danger";
}) {
  return (
    <div className="rounded-xl bg-surface p-3">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          <span className="rounded bg-surface2 px-1.5 py-0.5 text-ink2">{when}</span> {title}
        </p>
        <p className="text-[10px] text-muted">
          {segments} seg · {characterCount} chars{dltTemplateId ? ` · DLT ${dltTemplateId}` : " · no DLT id"}
        </p>
      </div>
      <p className="whitespace-pre-wrap text-sm text-ink">{body || "—"}</p>
      {note && <p className={`mt-1.5 text-[11px] ${tone === "danger" ? "text-danger" : "text-muted"}`}>{note}</p>}
    </div>
  );
}

function Fact({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-surface2 p-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums ${tone || "text-ink"}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted">{sub}</p>}
    </div>
  );
}
