/**
 * Notes SMS automations. Each runs only when all of these hold:
 *   • store flag `notes_store_sms` is on (store kill switch);
 *   • its Mission Control rule is enabled;
 *   • a cutover instant was recorded when it was switched on — only orders and
 *     leads after the cutover are considered, so enabling never backfills;
 *   • the template has no hold (drift, non-GSM text, dead promo code).
 *
 * Order confirmed is sent from the payment capture (fireNotesOrderConfirmedSms)
 * with the cron as a catch-up. Payment pending and checkout incomplete are
 * cron-only. Every send goes through sendNotesPlan, whose UNIQUE dedupe key
 * makes overlapping event and cron runs collapse to one message.
 */
import { notesApprovedByKey, type NotesTemplateKey } from "@/lib/sms/notesApproved";
import { getSettings, listNotesSmsLogs, listRules } from "@/lib/sms/store";
import type { SmsAutoRule } from "@/lib/sms/types";
import { storeDb } from "../db";
import { storeFeatureEnabled } from "../flags";
import { loadCheckoutLeadPlan, loadOrderPlan, loadTemplateContext } from "./load";
import { NOTES_CONFIRMABLE_STATUSES, NOTES_UNPAID_STATUSES, notesTemplateHold } from "./plan";
import { sendNotesPlan, type NotesSendOutcome } from "./send";

export const NOTES_AUTOMATION_KEYS: NotesTemplateKey[] = [
  "NOTES_ORDER_CONFIRMED_01",
  "NOTES_PAYMENT_PENDING_01",
  "NOTES_CHECKOUT_INCOMPLETE_01",
  "NOTES_NEW_LEAD_PROMO_01",
];

const CONFIRM_LOOKBACK_HOURS = 48;
const PENDING_MAX_AGE_HOURS = 24;
const DEFAULT_PENDING_DELAY_MIN = 60;
const CHECKOUT_LOOKBACK_HOURS = 24;
/** Hard ceiling per job per cron pass. */
export const NOTES_MAX_SENDS_PER_RUN = 20;

export interface NotesAutomationRuleState {
  trigger: string;
  enabled: boolean;
  cutover: string | null;
  delayMinutes: number | null;
  armed: boolean;
}

export async function notesAutomationRules(): Promise<Record<string, NotesAutomationRuleState>> {
  const [rules, settings] = await Promise.all([listRules(), getSettings()]);
  const cut = settings.notesCutover || {};
  const out: Record<string, NotesAutomationRuleState> = {};
  for (const key of NOTES_AUTOMATION_KEYS) {
    const t = notesApprovedByKey(key)!;
    const r: SmsAutoRule | undefined = rules.find((x) => x.trigger === t.trigger);
    const cutover = cut[t.trigger] || null;
    const enabled = !!r?.enabled;
    out[t.trigger] = {
      trigger: t.trigger,
      enabled,
      cutover,
      delayMinutes: r?.delay_minutes ?? null,
      armed: enabled && !!cutover && r?.template_id === t.id,
    };
  }
  return out;
}

function later(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/** Event path: called after a payment capture moves the order to ORDER_CONFIRMED. */
export async function fireNotesOrderConfirmedSms(orderId: string): Promise<NotesSendOutcome | { status: "skipped"; reason: string }> {
  try {
    if (!(await storeFeatureEnabled("notes_store_sms"))) return { status: "skipped", reason: "notes_store_sms_off" };
    const state = (await notesAutomationRules()).notes_order_confirmed;
    if (!state?.armed || !state.cutover) return { status: "skipped", reason: "automation_off" };
    const now = new Date();
    const { plan, order } = await loadOrderPlan("NOTES_ORDER_CONFIRMED_01", orderId, now);
    if (!order?.paid_at || new Date(order.paid_at).getTime() < new Date(state.cutover).getTime()) {
      return { status: "skipped", reason: "before_cutover" };
    }
    return await sendNotesPlan(plan, {
      mode: "auto",
      sentBy: { type: "SYSTEM" },
      reload: async () => (await loadOrderPlan("NOTES_ORDER_CONFIRMED_01", orderId, now)).plan,
      now,
    });
  } catch (e) {
    console.error(`[notes-sms] order_confirmed_event_failed ${(e as Error).message}`);
    return { status: "skipped", reason: "error" };
  }
}

export interface NotesJobReport {
  trigger: string;
  ran: boolean;
  reason: string | null;
  considered: number;
  submitted: number;
  failed: number;
  skipped: Record<string, number>;
}

function report(trigger: string): NotesJobReport {
  return { trigger, ran: false, reason: null, considered: 0, submitted: 0, failed: 0, skipped: {} };
}

function tally(r: NotesJobReport, o: NotesSendOutcome): void {
  if (o.status === "submitted") r.submitted++;
  else if (o.status === "failed") r.failed++;
  else r.skipped[o.reason || "skipped"] = (r.skipped[o.reason || "skipped"] || 0) + 1;
}

/** Orders that already have a log for this template (any status), by order id. */
async function ordersWithLog(templateId: string, keyPrefix: string, sinceIso: string): Promise<Set<string>> {
  const logs = await listNotesSmsLogs({ templateIds: [templateId], sinceIso, limit: 2000 });
  const out = new Set<string>();
  for (const l of logs) {
    const k = l.dedupe_key || "";
    if (k.startsWith(keyPrefix)) out.add(k.slice(keyPrefix.length).split(":")[0]);
  }
  return out;
}

async function runOrderConfirmedCatchUp(state: NotesAutomationRuleState, now: Date): Promise<NotesJobReport> {
  const r = report(state.trigger);
  const client = storeDb();
  if (!client || !state.cutover) return { ...r, reason: "unavailable" };
  const since = later(state.cutover, new Date(now.getTime() - CONFIRM_LOOKBACK_HOURS * 3_600_000).toISOString());
  const { data, error } = await client
    .from("store_orders")
    .select("id,status,paid_at")
    .gte("paid_at", since)
    .in("status", [...NOTES_CONFIRMABLE_STATUSES])
    .order("paid_at", { ascending: true })
    .limit(200);
  if (error) return { ...r, reason: "orders_read_failed" };
  const done = await ordersWithLog("notes_order_confirmed_01", "NOTES_ORDER_CONFIRMED_01:", since);
  r.ran = true;
  for (const o of (data || []) as { id: string }[]) {
    if (done.has(o.id)) continue;
    if (r.submitted + r.failed >= NOTES_MAX_SENDS_PER_RUN) break;
    r.considered++;
    try {
      const { plan } = await loadOrderPlan("NOTES_ORDER_CONFIRMED_01", o.id, now);
      tally(r, await sendNotesPlan(plan, {
        mode: "auto",
        sentBy: { type: "SYSTEM" },
        enforceWindow: true,
        reload: async () => (await loadOrderPlan("NOTES_ORDER_CONFIRMED_01", o.id, now)).plan,
        now,
      }));
    } catch {
      r.skipped.data_unavailable = (r.skipped.data_unavailable || 0) + 1;
    }
  }
  return r;
}

async function runPaymentPending(state: NotesAutomationRuleState, now: Date): Promise<NotesJobReport> {
  const r = report(state.trigger);
  const client = storeDb();
  if (!client || !state.cutover) return { ...r, reason: "unavailable" };
  const delay = Math.max(DEFAULT_PENDING_DELAY_MIN, state.delayMinutes ?? DEFAULT_PENDING_DELAY_MIN);
  const since = later(state.cutover, new Date(now.getTime() - PENDING_MAX_AGE_HOURS * 3_600_000).toISOString());
  const until = new Date(now.getTime() - delay * 60_000).toISOString();
  const { data, error } = await client
    .from("store_orders")
    .select("id,created_at")
    .gte("created_at", since)
    .lte("created_at", until)
    .in("status", [...NOTES_UNPAID_STATUSES])
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { ...r, reason: "orders_read_failed" };
  const done = await ordersWithLog("notes_payment_pending_01", "NOTES_PAYMENT_PENDING_01:", since);
  r.ran = true;
  for (const o of (data || []) as { id: string }[]) {
    if (done.has(o.id)) continue;
    if (r.submitted + r.failed >= NOTES_MAX_SENDS_PER_RUN) break;
    r.considered++;
    try {
      const { plan } = await loadOrderPlan("NOTES_PAYMENT_PENDING_01", o.id, now);
      tally(r, await sendNotesPlan(plan, {
        mode: "auto",
        sentBy: { type: "SYSTEM" },
        enforceWindow: true,
        reload: async () => (await loadOrderPlan("NOTES_PAYMENT_PENDING_01", o.id, now)).plan,
        now,
      }));
    } catch {
      r.skipped.data_unavailable = (r.skipped.data_unavailable || 0) + 1;
    }
  }
  return r;
}

async function runCheckoutIncomplete(state: NotesAutomationRuleState, now: Date): Promise<NotesJobReport> {
  const r = report(state.trigger);
  const client = storeDb();
  if (!client || !state.cutover) return { ...r, reason: "unavailable" };
  const since = later(state.cutover, new Date(now.getTime() - CHECKOUT_LOOKBACK_HOURS * 3_600_000).toISOString());
  const { data, error } = await client
    .from("store_checkout_leads")
    .select("id")
    .eq("checkout_stage", "CHECKOUT_ABANDONED")
    .is("order_id", null)
    .eq("is_test", false)
    .eq("marketing_consent", true)
    .gte("last_activity_at", since)
    .order("last_activity_at", { ascending: false })
    .limit(200);
  if (error) return { ...r, reason: "leads_read_failed" };
  r.ran = true;
  for (const l of (data || []) as { id: string }[]) {
    if (r.submitted + r.failed >= NOTES_MAX_SENDS_PER_RUN) break;
    r.considered++;
    try {
      const { plan } = await loadCheckoutLeadPlan("NOTES_CHECKOUT_INCOMPLETE_01", l.id, now);
      tally(r, await sendNotesPlan(plan, {
        mode: "auto",
        sentBy: { type: "SYSTEM" },
        enforceWindow: true,
        reload: async () => (await loadCheckoutLeadPlan("NOTES_CHECKOUT_INCOMPLETE_01", l.id, now)).plan,
        now,
      }));
    } catch {
      r.skipped.data_unavailable = (r.skipped.data_unavailable || 0) + 1;
    }
  }
  return r;
}

/** Cron entry (sms-dispatch). Never throws. */
export async function runNotesSmsAutomations(now = new Date()): Promise<NotesJobReport[]> {
  const out: NotesJobReport[] = [];
  try {
    if (!(await storeFeatureEnabled("notes_store_sms"))) return [{ ...report("notes"), reason: "notes_store_sms_off" }];
    const states = await notesAutomationRules();
    const jobs: [string, (s: NotesAutomationRuleState, n: Date) => Promise<NotesJobReport>][] = [
      ["notes_order_confirmed", runOrderConfirmedCatchUp],
      ["notes_payment_pending", runPaymentPending],
      ["notes_checkout_incomplete", runCheckoutIncomplete],
    ];
    for (const [trigger, job] of jobs) {
      const s = states[trigger];
      if (!s?.armed) {
        out.push({ ...report(trigger), reason: s?.enabled ? "no_cutover" : "disabled" });
        continue;
      }
      const t = NOTES_AUTOMATION_KEYS.map((k) => notesApprovedByKey(k)!).find((x) => x.trigger === trigger)!;
      const hold = notesTemplateHold(t, await loadTemplateContext(t, now));
      if (hold) {
        out.push({ ...report(trigger), reason: hold });
        continue;
      }
      try {
        out.push(await job(s, now));
      } catch (e) {
        out.push({ ...report(trigger), reason: `error:${(e as Error).message.slice(0, 80)}` });
      }
    }
  } catch (e) {
    out.push({ ...report("notes"), reason: `error:${(e as Error).message.slice(0, 80)}` });
  }
  return out;
}
