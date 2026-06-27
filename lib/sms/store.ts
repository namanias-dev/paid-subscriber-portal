/**
 * Data layer for SMS templates / logs / rules / settings.
 * Supabase-backed in live mode; in-memory (globalThis) fallback in demo mode so
 * the portal stays fully functional with no DB. Never throws into callers.
 */
import { getSupabaseAdmin } from "../supabase";
import { SEED_TEMPLATES, uniqueVariables, TRIGGERS } from "./templates";
import { envDailyCap, envPerMobileDailyCap, smsEnvEnabled } from "./config";
import type { SmsTemplate, SmsLog, SmsAutoRule, SmsSettings, SmsTemplateStatus } from "./types";

// ---------------------------------------------------------------------------
// Default auto-rules (ALL disabled). One rule per auto-sendable trigger.
// ---------------------------------------------------------------------------
interface RuleSeed { trigger: string; template_id: string; delay_minutes?: number; schedule_time?: string; offset_minutes?: number; audience_type?: string }
export const DEFAULT_RULES: RuleSeed[] = [
  { trigger: TRIGGERS.payment_success, template_id: "payment_successful" },
  { trigger: TRIGGERS.payment_pending, template_id: "payment_pending", delay_minutes: 60 },
  { trigger: TRIGGERS.proof_uploaded, template_id: "proof_received" },
  { trigger: TRIGGERS.admin_approval, template_id: "access_approved" },
  { trigger: TRIGGERS.payment_failed, template_id: "payment_failed" },
  { trigger: TRIGGERS.payment_abandoned, template_id: "abandoned_nudge", delay_minutes: 30 },
  { trigger: TRIGGERS.registration_created, template_id: "webinar_registered" },
  { trigger: TRIGGERS.webinar_day_before, template_id: "reminder_day_before", schedule_time: "18:00", audience_type: "webinar_registered" },
  { trigger: TRIGGERS.webinar_sameday_registered, template_id: "sameday_10am_registered", schedule_time: "10:00", audience_type: "webinar_registered" },
  { trigger: TRIGGERS.webinar_starting_soon, template_id: "starting_soon_1hr", offset_minutes: 60, audience_type: "webinar_registered" },
  { trigger: TRIGGERS.zoom_published, template_id: "zoom_ready", audience_type: "webinar_registered" },
  { trigger: TRIGGERS.webinar_sameday_invite, template_id: "sameday_10am_invite", schedule_time: "10:00", audience_type: "webinar_not_registered" },
  { trigger: TRIGGERS.post_webinar_thankyou, template_id: "post_webinar_thankyou", offset_minutes: 240, audience_type: "webinar_attendees" },
  { trigger: TRIGGERS.first_login, template_id: "welcome_first_login" },
  { trigger: TRIGGERS.course_enrolled, template_id: "course_enrolled" },
];

export const DEFAULT_SETTINGS = (): SmsSettings => ({
  enabled: smsEnvEnabled(),
  dailyCap: envDailyCap(),
  perMobileDailyCap: envPerMobileDailyCap(),
  windowStart: "10:00",
  windowEnd: "21:00",
  t19OffsetMinutes: 240,
  t19FallbackAllRegistered: true,
});

// ---------------------------------------------------------------------------
// Demo (in-memory) fallback
// ---------------------------------------------------------------------------
interface DemoStore { templates: SmsTemplate[]; logs: SmsLog[]; rules: SmsAutoRule[]; settings: SmsSettings }
function demo(): DemoStore {
  const g = globalThis as unknown as { __smsStore?: DemoStore };
  if (!g.__smsStore) {
    g.__smsStore = {
      templates: SEED_TEMPLATES.map(seedToTemplate),
      logs: [],
      rules: DEFAULT_RULES.map(ruleSeedToRule),
      settings: DEFAULT_SETTINGS(),
    };
  }
  return g.__smsStore;
}

function nowISO() { return new Date().toISOString(); }

function seedToTemplate(s: (typeof SEED_TEMPLATES)[number]): SmsTemplate {
  return {
    id: s.id, name: s.name, use_case: s.use_case, gateway_template_id: null,
    sender_id: "NAMIAS", route: "12", message_type: s.message_type,
    body_template: s.body, variables: uniqueVariables(s.body),
    status: "draft", is_active: false, auto_send_enabled: false,
    trigger_event: s.trigger_event, audience_type: s.audience_type,
    created_at: nowISO(), updated_at: nowISO(),
  };
}
function ruleSeedToRule(r: RuleSeed): SmsAutoRule {
  return {
    trigger: r.trigger, template_id: r.template_id, enabled: false,
    delay_minutes: r.delay_minutes ?? null, schedule_time: r.schedule_time ?? null,
    offset_minutes: r.offset_minutes ?? null, audience_type: r.audience_type ?? null,
    last_run_at: null, updated_at: nowISO(),
  };
}

// row<->object mapping for DB
type Row = Record<string, unknown>;
function rowToTemplate(r: Row): SmsTemplate {
  return {
    id: String(r.id), name: String(r.name), use_case: r.use_case as SmsTemplate["use_case"],
    gateway_template_id: (r.gateway_template_id as string) ?? null,
    sender_id: String(r.sender_id || "NAMIAS"), route: String(r.route || "12"),
    message_type: (r.message_type as SmsTemplate["message_type"]) || "service",
    body_template: String(r.body_template), variables: (r.variables as string[]) || [],
    status: (r.status as SmsTemplateStatus) || "draft", is_active: !!r.is_active,
    auto_send_enabled: !!r.auto_send_enabled,
    trigger_event: (r.trigger_event as string) ?? null, audience_type: (r.audience_type as string) ?? null,
    created_by: (r.created_by as string) ?? null, updated_by: (r.updated_by as string) ?? null,
    created_at: String(r.created_at || nowISO()), updated_at: String(r.updated_at || nowISO()),
  };
}

// ---------------------------------------------------------------------------
// TEMPLATES
// ---------------------------------------------------------------------------
/** Insert any seed templates missing from the DB (idempotent), as DRAFT. */
export async function ensureSeeded(): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    const { data } = await db.from("sms_templates").select("id");
    const have = new Set((data || []).map((r: Row) => String(r.id)));
    const missing = SEED_TEMPLATES.filter((s) => !have.has(s.id)).map((s) => {
      const t = seedToTemplate(s);
      return {
        id: t.id, name: t.name, use_case: t.use_case, gateway_template_id: null,
        sender_id: t.sender_id, route: t.route, message_type: t.message_type,
        body_template: t.body_template, variables: t.variables, status: "draft",
        is_active: false, auto_send_enabled: false, trigger_event: t.trigger_event,
        audience_type: t.audience_type,
      };
    });
    if (missing.length) await db.from("sms_templates").insert(missing);
    // seed rules too
    const { data: rd } = await db.from("sms_auto_rules").select("trigger");
    const haveR = new Set((rd || []).map((r: Row) => String(r.trigger)));
    const missingR = DEFAULT_RULES.filter((r) => !haveR.has(r.trigger)).map((r) => ({
      trigger: r.trigger, template_id: r.template_id, enabled: false,
      delay_minutes: r.delay_minutes ?? null, schedule_time: r.schedule_time ?? null,
      offset_minutes: r.offset_minutes ?? null, audience_type: r.audience_type ?? null,
    }));
    if (missingR.length) await db.from("sms_auto_rules").insert(missingR);
  } catch { /* ignore */ }
}

export async function listTemplates(): Promise<SmsTemplate[]> {
  const db = getSupabaseAdmin();
  if (!db) return [...demo().templates];
  await ensureSeeded();
  try {
    const { data } = await db.from("sms_templates").select("*").order("use_case").order("name");
    return (data || []).map(rowToTemplate);
  } catch {
    return SEED_TEMPLATES.map(seedToTemplate);
  }
}

export async function getTemplate(id: string): Promise<SmsTemplate | null> {
  const db = getSupabaseAdmin();
  if (!db) return demo().templates.find((t) => t.id === id) || null;
  try {
    const { data } = await db.from("sms_templates").select("*").eq("id", id).maybeSingle();
    return data ? rowToTemplate(data) : (SEED_TEMPLATES.find((s) => s.id === id) ? seedToTemplate(SEED_TEMPLATES.find((s) => s.id === id)!) : null);
  } catch { return null; }
}

export interface TemplatePatch {
  name?: string; use_case?: SmsTemplate["use_case"]; message_type?: SmsTemplate["message_type"];
  body_template?: string; gateway_template_id?: string | null; status?: SmsTemplateStatus;
  is_active?: boolean; auto_send_enabled?: boolean; trigger_event?: string | null;
  audience_type?: string | null; sender_id?: string; route?: string; updated_by?: string | null;
}

export async function upsertTemplate(id: string, patch: TemplatePatch, createIfMissing = false): Promise<SmsTemplate | null> {
  const variables = patch.body_template ? uniqueVariables(patch.body_template) : undefined;
  const db = getSupabaseAdmin();
  const clean = { ...patch, ...(variables ? { variables } : {}), updated_at: nowISO() };
  if (!db) {
    const d = demo();
    let t = d.templates.find((x) => x.id === id);
    if (!t) {
      if (!createIfMissing) return null;
      t = seedToTemplate(SEED_TEMPLATES.find((s) => s.id === id) || { id, name: id, use_case: "ONBOARDING", message_type: "service", body: patch.body_template || "", trigger_event: null, audience_type: null });
      d.templates.push(t);
    }
    Object.assign(t, clean);
    return t;
  }
  try {
    const exists = await getTemplate(id);
    if (!exists && !createIfMissing) return null;
    if (!exists) {
      await db.from("sms_templates").insert({ id, name: patch.name || id, use_case: patch.use_case || "ONBOARDING", message_type: patch.message_type || "service", body_template: patch.body_template || "", variables: variables || [], status: patch.status || "draft", is_active: patch.is_active ?? false, auto_send_enabled: patch.auto_send_enabled ?? false, trigger_event: patch.trigger_event ?? null, audience_type: patch.audience_type ?? null, gateway_template_id: patch.gateway_template_id ?? null });
    } else {
      await db.from("sms_templates").update(clean).eq("id", id);
    }
    return getTemplate(id);
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// LOGS
// ---------------------------------------------------------------------------
export interface NewLog {
  mobile: string; normalized_mobile: string; student_name?: string | null;
  user_id?: string | null; lead_id?: string | null; registration_id?: string | null;
  payment_id?: string | null; course_id?: string | null; webinar_id?: string | null;
  template_id: string; template_name: string; gateway_template_id: string | null;
  sender_id: string; route: string; message_body: string; character_count: number; segments: number;
  sent_by_user_id?: string | null; sent_by_type: SmsLog["sent_by_type"];
  trigger_event?: string | null; audience_type?: string | null; dedupe_key?: string | null;
  status?: SmsLog["status"];
}

/** Insert a QUEUED log. Returns the id, or null if a dedupe_key conflict (=skip). */
export async function insertQueuedLog(input: NewLog): Promise<{ id: string } | null> {
  const db = getSupabaseAdmin();
  const base = { ...input, status: input.status || "QUEUED", created_at: nowISO() };
  if (!db) {
    const d = demo();
    if (input.dedupe_key && d.logs.some((l) => l.dedupe_key === input.dedupe_key)) return null;
    const id = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    d.logs.unshift({ id, gateway_response: null, gateway_message_id: null, error_message: null, sent_at: null, ...base } as SmsLog);
    return { id };
  }
  try {
    const { data, error } = await db.from("sms_logs").insert(base).select("id").single();
    if (error) return null; // unique dedupe conflict or transient
    return { id: String(data.id) };
  } catch { return null; }
}

export async function updateLog(id: string, patch: Partial<SmsLog>): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) { const l = demo().logs.find((x) => x.id === id); if (l) Object.assign(l, patch); return; }
  try { await db.from("sms_logs").update(patch).eq("id", id); } catch { /* ignore */ }
}

export interface LogFilters {
  from?: string; to?: string; status?: string; templateId?: string; mobile?: string;
  trigger?: string; sentByType?: string; audienceType?: string; limit?: number;
}
export async function listLogs(f: LogFilters = {}): Promise<SmsLog[]> {
  const db = getSupabaseAdmin();
  const limit = Math.min(5000, Math.max(1, f.limit || 500));
  if (!db) {
    let rows = [...demo().logs];
    if (f.status) rows = rows.filter((r) => r.status === f.status);
    if (f.templateId) rows = rows.filter((r) => r.template_id === f.templateId);
    if (f.trigger) rows = rows.filter((r) => r.trigger_event === f.trigger);
    if (f.sentByType) rows = rows.filter((r) => r.sent_by_type === f.sentByType);
    if (f.audienceType) rows = rows.filter((r) => r.audience_type === f.audienceType);
    if (f.mobile) rows = rows.filter((r) => r.normalized_mobile.includes(f.mobile!.replace(/\D/g, "").slice(-10)));
    return rows.slice(0, limit);
  }
  try {
    let q = db.from("sms_logs").select("*").order("created_at", { ascending: false }).limit(limit);
    if (f.from) q = q.gte("created_at", f.from);
    if (f.to) q = q.lte("created_at", f.to);
    if (f.status) q = q.eq("status", f.status);
    if (f.templateId) q = q.eq("template_id", f.templateId);
    if (f.trigger) q = q.eq("trigger_event", f.trigger);
    if (f.sentByType) q = q.eq("sent_by_type", f.sentByType);
    if (f.audienceType) q = q.eq("audience_type", f.audienceType);
    if (f.mobile) q = q.ilike("normalized_mobile", `%${f.mobile.replace(/\D/g, "").slice(-10)}%`);
    const { data } = await q;
    return (data || []) as SmsLog[];
  } catch { return []; }
}

export async function getLog(id: string): Promise<SmsLog | null> {
  const db = getSupabaseAdmin();
  if (!db) return demo().logs.find((l) => l.id === id) || null;
  try { const { data } = await db.from("sms_logs").select("*").eq("id", id).maybeSingle(); return (data as SmsLog) || null; } catch { return null; }
}

/** Count of SENT/DELIVERED logs since start of today IST. */
export async function countSentSince(sinceISO: string, normalizedMobile?: string): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) {
    return demo().logs.filter((l) =>
      ["SENT", "DELIVERED"].includes(l.status) && l.created_at >= sinceISO &&
      (!normalizedMobile || l.normalized_mobile === normalizedMobile)).length;
  }
  try {
    let q = db.from("sms_logs").select("id", { count: "exact", head: true }).gte("created_at", sinceISO).in("status", ["SENT", "DELIVERED"]);
    if (normalizedMobile) q = q.eq("normalized_mobile", normalizedMobile);
    const { count } = await q;
    return count || 0;
  } catch { return 0; }
}

/** Recent send to the same mobile+trigger within N minutes (anti-spam window). */
export async function recentSameTrigger(normalizedMobile: string, trigger: string, withinMinutes: number): Promise<boolean> {
  const sinceISO = new Date(Date.now() - withinMinutes * 60000).toISOString();
  const db = getSupabaseAdmin();
  if (!db) {
    return demo().logs.some((l) => l.normalized_mobile === normalizedMobile && l.trigger_event === trigger && ["SENT", "DELIVERED", "QUEUED"].includes(l.status) && l.created_at >= sinceISO);
  }
  try {
    const { count } = await db.from("sms_logs").select("id", { count: "exact", head: true })
      .eq("normalized_mobile", normalizedMobile).eq("trigger_event", trigger)
      .gte("created_at", sinceISO).in("status", ["SENT", "DELIVERED", "QUEUED"]);
    return (count || 0) > 0;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// RULES
// ---------------------------------------------------------------------------
export async function listRules(): Promise<SmsAutoRule[]> {
  const db = getSupabaseAdmin();
  if (!db) return [...demo().rules];
  await ensureSeeded();
  try {
    const { data } = await db.from("sms_auto_rules").select("*");
    const byTrigger = new Map((data || []).map((r: Row) => [String(r.trigger), r]));
    return DEFAULT_RULES.map((seed) => {
      const r = byTrigger.get(seed.trigger);
      if (!r) return ruleSeedToRule(seed);
      return {
        trigger: seed.trigger, template_id: (r.template_id as string) ?? seed.template_id,
        enabled: !!r.enabled, delay_minutes: (r.delay_minutes as number) ?? seed.delay_minutes ?? null,
        schedule_time: (r.schedule_time as string) ?? seed.schedule_time ?? null,
        offset_minutes: (r.offset_minutes as number) ?? seed.offset_minutes ?? null,
        audience_type: (r.audience_type as string) ?? seed.audience_type ?? null,
        last_run_at: (r.last_run_at as string) ?? null, updated_at: String(r.updated_at || nowISO()),
      };
    });
  } catch { return DEFAULT_RULES.map(ruleSeedToRule); }
}

export async function getRule(trigger: string): Promise<SmsAutoRule | null> {
  return (await listRules()).find((r) => r.trigger === trigger) || null;
}

export async function upsertRule(trigger: string, patch: Partial<SmsAutoRule>): Promise<SmsAutoRule | null> {
  const db = getSupabaseAdmin();
  if (!db) {
    const d = demo();
    let r = d.rules.find((x) => x.trigger === trigger);
    if (!r) { const seed = DEFAULT_RULES.find((s) => s.trigger === trigger); r = seed ? ruleSeedToRule(seed) : { trigger, template_id: null, enabled: false, delay_minutes: null, schedule_time: null, offset_minutes: null, audience_type: null, last_run_at: null, updated_at: nowISO() }; d.rules.push(r); }
    Object.assign(r, patch, { updated_at: nowISO() });
    return r;
  }
  try {
    await ensureSeeded();
    await db.from("sms_auto_rules").update({ ...patch, updated_at: nowISO() }).eq("trigger", trigger);
    return getRule(trigger);
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
export async function getSettings(): Promise<SmsSettings> {
  const db = getSupabaseAdmin();
  const defaults = DEFAULT_SETTINGS();
  if (!db) return { ...defaults, ...demo().settings };
  try {
    const { data } = await db.from("sms_settings").select("data").eq("id", "default").maybeSingle();
    const stored = (data?.data as Partial<SmsSettings>) || {};
    return { ...defaults, ...stored };
  } catch { return defaults; }
}

export async function updateSettings(patch: Partial<SmsSettings>, updatedBy?: string | null): Promise<SmsSettings> {
  const db = getSupabaseAdmin();
  const current = await getSettings();
  const next = { ...current, ...patch };
  if (!db) { demo().settings = next; return next; }
  try {
    await db.from("sms_settings").upsert({ id: "default", data: next, updated_by: updatedBy ?? null, updated_at: nowISO() });
  } catch { /* ignore */ }
  return next;
}
