/**
 * Submit a validated Notes SMS plan through the Academy sender (sendSms).
 *
 * The plan is rebuilt from the database immediately before submission and must
 * be identical (text, destination, idempotency key) to the one the caller saw,
 * so a payment captured between "plan" and "send" suppresses a pending SMS.
 * sendSms then re-checks the stored template against the approved text and the
 * rendered body against plan.text, and its UNIQUE dedupe_key makes repeated
 * callbacks and cron passes collapse to one message.
 */
import { notesApprovedByKey, notesRendererVars, type NotesDltToken } from "@/lib/sms/notesApproved";
import { sendSms } from "@/lib/sms/service";
import { getSettings, listNotesSmsLogs } from "@/lib/sms/store";
import { isWithinPromoWindow } from "@/lib/sms/promoQuietHours";
import { storeDb } from "../db";
import { storeFeatureEnabled } from "../flags";
import type { NotesSmsPlan } from "./plan";

export type NotesSendStatus = "submitted" | "failed" | "skipped";

export interface NotesSendOutcome {
  status: NotesSendStatus;
  /** Why it was skipped / failed (machine code). */
  reason: string | null;
  logId: string | null;
  plan: NotesSmsPlan;
}

export interface NotesSendOptions {
  mode: "auto" | "manual";
  sentBy: { userId?: string | null; type: "ADMIN" | "SYSTEM" };
  /** Cron catch-up honours the IST send window; event and manual sends do not. */
  enforceWindow?: boolean;
  /** Rebuilds the plan from current data. */
  reload: () => Promise<NotesSmsPlan>;
  now?: Date;
  /** Defaults to the `notes_store_sms` store flag. */
  smsFlagEnabled?: () => Promise<boolean>;
}

const LIVE_LOG = ["QUEUED", "SENT", "DELIVERED"];
const MAX_MANUAL_RETRIES = 2;

function samePlan(a: NotesSmsPlan, b: NotesSmsPlan): boolean {
  return a.text === b.text && a.destination.digits10 === b.destination.digits10 && a.dedupeKey === b.dedupeKey && a.templateKey === b.templateKey;
}

/** Manual sends reuse the automation key once; after a failure they get a bounded retry key. */
async function manualDedupeKey(plan: NotesSmsPlan): Promise<{ key: string } | { skip: string }> {
  const base = plan.dedupeKey!;
  const keys = [base, ...Array.from({ length: MAX_MANUAL_RETRIES }, (_, i) => `${base}:retry${i + 1}`)];
  const logs = await listNotesSmsLogs({ templateIds: [plan.templateId], dedupeKeys: keys });
  if (logs.some((l) => LIVE_LOG.includes(l.status))) return { skip: "already_sent" };
  const used = new Set(logs.map((l) => l.dedupe_key));
  const next = keys.find((k) => !used.has(k));
  return next ? { key: next } : { skip: "retry_limit_reached" };
}

async function recordOrderEvent(plan: NotesSmsPlan, outcome: { status: NotesSendStatus; reason: string | null; logId: string | null }, opts: NotesSendOptions): Promise<void> {
  if (plan.source?.kind !== "order" || !outcome.logId) return;
  const client = storeDb();
  if (!client) return;
  try {
    await client.from("store_order_events").insert({
      order_id: plan.source.orderId,
      event: outcome.status === "submitted" ? "sms_submitted" : "sms_failed",
      actor_type: opts.sentBy.type === "ADMIN" ? "admin" : "system",
      actor_id: opts.sentBy.userId ?? null,
      reason: outcome.reason,
      payload_json: {
        template_key: plan.templateKey,
        dlt_template_id: plan.dltTemplateId,
        sms_log_id: outcome.logId,
        to: plan.destination.masked,
        mode: opts.mode,
      },
    });
  } catch {
    // The sms_logs row is the audit of record; the timeline entry is a convenience.
  }
}

export async function sendNotesPlan(initial: NotesSmsPlan, opts: NotesSendOptions): Promise<NotesSendOutcome> {
  const skip = (reason: string, plan = initial): NotesSendOutcome => ({ status: "skipped", reason, logId: null, plan });
  const t = notesApprovedByKey(initial.templateKey);
  if (!t) return skip("unknown_template");
  const flagOn = opts.smsFlagEnabled ? await opts.smsFlagEnabled() : await storeFeatureEnabled("notes_store_sms");
  if (!flagOn) return skip("notes_store_sms_off");

  let plan: NotesSmsPlan;
  try {
    plan = await opts.reload();
  } catch {
    return skip("data_unavailable");
  }
  if (!samePlan(initial, plan)) return skip("changed_before_send", plan);
  if (plan.hold) return skip(plan.hold, plan);
  if (!plan.ok || !plan.text || !plan.destination.digits10 || !plan.dedupeKey) {
    return skip(plan.blockers[0] || "not_eligible", plan);
  }

  if (t.messageType === "promotional") {
    const settings = await getSettings();
    if (!isWithinPromoWindow(settings, opts.now || new Date())) return skip("outside_promo_hours", plan);
  }

  let dedupeKey = plan.dedupeKey;
  if (opts.mode === "manual") {
    let picked: { key: string } | { skip: string };
    try {
      picked = await manualDedupeKey(plan);
    } catch {
      return skip("data_unavailable", plan);
    }
    if ("skip" in picked) return skip(picked.skip, plan);
    dedupeKey = picked.key;
  }

  const values: Partial<Record<NotesDltToken, string>> = {};
  for (const v of plan.variables) if (v.value) values[v.token] = v.value;

  const res = await sendSms({
    mobile: plan.destination.digits10,
    templateId: t.id,
    variables: notesRendererVars(t, values),
    relatedEntity: {
      student_name: plan.customerName,
      lead_id: plan.source?.kind === "academy_lead" ? plan.source.leadId : null,
    },
    sentBy: opts.sentBy,
    triggerEvent: opts.mode === "manual" ? "notes_manual_send" : t.trigger,
    audienceType: "notes_store",
    dedupeKey,
    enforceWindow: !!opts.enforceWindow,
    notesExpectedBody: plan.text,
  });

  const outcome: NotesSendOutcome = res.logId
    ? { status: res.ok ? "submitted" : "failed", reason: res.ok ? null : res.error || res.skipped || "send_failed", logId: res.logId, plan }
    : { status: "skipped", reason: res.skipped || res.error || "not_sent", logId: null, plan };
  await recordOrderEvent(plan, outcome, opts);
  if (outcome.status !== "skipped" || !["duplicate", "outside_window"].includes(outcome.reason || "")) {
    console.info(`[notes-sms] ${t.key} ${outcome.status}${outcome.reason ? ` reason=${outcome.reason}` : ""} mode=${opts.mode}`);
  }
  return outcome;
}
