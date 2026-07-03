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
  { trigger: TRIGGERS.payment_plan_changed, template_id: "payment_plan_changed" },
];

export const DEFAULT_SETTINGS = (): SmsSettings => ({
  enabled: smsEnvEnabled(),
  dailyCap: envDailyCap(),
  perMobileDailyCap: envPerMobileDailyCap(),
  windowStart: "10:00",
  windowEnd: "21:00",
  t19OffsetMinutes: 240,
  // Attendees-only by default: if attendance is unknown for a webinar, T19 sends
  // to NOBODY rather than blasting all registered. Flip on per preference.
  t19FallbackAllRegistered: false,
  // Rupee cost per SMS segment (current JustGoSMS rate). Editable in Settings.
  costPerSms: 0.13,
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
  const approved = !!s.gateway_template_id;
  return {
    id: s.id, name: s.name, use_case: s.use_case, gateway_template_id: s.gateway_template_id ?? null,
    sender_id: "NAMIAS", route: "12", message_type: s.message_type,
    body_template: s.body, variables: uniqueVariables(s.body),
    // A seed that carries an approved DLT id is send-ready; the rest stay draft.
    status: approved ? "approved" : "draft", is_active: approved, auto_send_enabled: false,
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
/**
 * Insert missing seed templates AND reconcile the DLT-approved ones so code stays
 * the single source of truth for the approved id + body (a drifted id/body means
 * provider rejection). Idempotent:
 *   • Missing rows are inserted (approved seeds land send-ready, the rest draft).
 *   • Existing rows whose gateway_template_id / body_template drift from an
 *     approved seed are healed back to the seed values (variables recomputed).
 *     On FIRST wiring (row had no id) we also flip status→approved + is_active,
 *     but we never force those flags again afterwards so admins can still toggle.
 */
export async function ensureSeeded(): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    const { data } = await db.from("sms_templates").select("id, gateway_template_id, body_template");
    const byId = new Map((data || []).map((r: Row) => [String(r.id), r]));
    const have = new Set(byId.keys());
    const missing = SEED_TEMPLATES.filter((s) => !have.has(s.id)).map((s) => {
      const t = seedToTemplate(s);
      return {
        id: t.id, name: t.name, use_case: t.use_case, gateway_template_id: t.gateway_template_id,
        sender_id: t.sender_id, route: t.route, message_type: t.message_type,
        body_template: t.body_template, variables: t.variables, status: t.status,
        is_active: t.is_active, auto_send_enabled: false, trigger_event: t.trigger_event,
        audience_type: t.audience_type,
      };
    });
    if (missing.length) await db.from("sms_templates").insert(missing);
    // Heal existing rows for DLT-approved seeds whose id/body have drifted.
    for (const s of SEED_TEMPLATES) {
      if (!s.gateway_template_id) continue;
      const row = byId.get(s.id);
      if (!row) continue;
      const idDrift = String(row.gateway_template_id ?? "") !== s.gateway_template_id;
      const bodyDrift = String(row.body_template ?? "") !== s.body;
      if (!idDrift && !bodyDrift) continue;
      const patch: Record<string, unknown> = {
        gateway_template_id: s.gateway_template_id,
        body_template: s.body,
        variables: uniqueVariables(s.body),
        updated_at: nowISO(),
      };
      // First-time wiring (no id yet) → make it send-ready.
      if (!row.gateway_template_id) { patch.status = "approved"; patch.is_active = true; }
      await db.from("sms_templates").update(patch).eq("id", s.id);
    }
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
      t = seedToTemplate(SEED_TEMPLATES.find((s) => s.id === id) || { id, name: id, use_case: "ONBOARDING", message_type: "service", body: patch.body_template || "", gateway_template_id: patch.gateway_template_id ?? null, trigger_event: null, audience_type: null });
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
// IDENTITY-SAFE BUYER RESOLUTION (Issue 2)
// Never bind a login_code we cannot attribute to exactly ONE person on a number.
// ---------------------------------------------------------------------------
export interface BuyerResolution {
  status: "ok" | "none" | "ambiguous";
  id: string | null;
  name: string | null;
  login_code: string | null;
}

/** Resolve a buyer by phone, returning `ambiguous` when >1 buyer shares it. */
export async function resolveBuyerByPhone(digits10: string): Promise<BuyerResolution> {
  const db = getSupabaseAdmin();
  if (!db) return { status: "none", id: null, name: null, login_code: null };
  try {
    const { data } = await db.from("buyers").select("id,name,login_code").eq("phone", digits10).limit(2);
    const rows = (data || []) as { id: string; name: string | null; login_code: string | null }[];
    if (rows.length === 0) return { status: "none", id: null, name: null, login_code: null };
    if (rows.length > 1) return { status: "ambiguous", id: null, name: null, login_code: null };
    return { status: "ok", id: rows[0].id, name: rows[0].name, login_code: rows[0].login_code };
  } catch {
    return { status: "none", id: null, name: null, login_code: null };
  }
}

/** Resolve a buyer by its stable id (exact person — safe for shared numbers). */
export async function getBuyerById(id: string): Promise<{ id: string; name: string | null; login_code: string | null } | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  try {
    const { data } = await db.from("buyers").select("id,name,login_code").eq("id", id).maybeSingle();
    return data ? (data as { id: string; name: string | null; login_code: string | null }) : null;
  } catch {
    return null;
  }
}

/** First-name key for a safe recipient↔code match (case/space/punct-insensitive). */
export function firstNameKey(name: string | null | undefined): string {
  return String(name || "").trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9]/g, "") || "";
}

/** True unless we can PROVE two names disagree (missing name ⇒ don't block). */
export function firstNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = firstNameKey(a);
  const kb = firstNameKey(b);
  if (!ka || !kb) return true;
  return ka === kb;
}

// ---------------------------------------------------------------------------
// DELIVERY RECEIPTS (Issue 3) — promote SENT -> DELIVERED/FAILED by gateway id
// ---------------------------------------------------------------------------
/**
 * Logs whose gateway_message_id matches any of the provided id variants. Returns
 * the FULL set (paginated past PostgREST's ~1000-row response ceiling) so DLR
 * polling covers every recipient of a bulk send — a shared bulk id can map to
 * hundreds of rows, so the old .limit(50) silently dropped most of them.
 */
export async function findLogsByMessageIds(variants: string[]): Promise<SmsLog[]> {
  const clean = [...new Set(variants.filter(Boolean))];
  if (!clean.length) return [];
  const db = getSupabaseAdmin();
  if (!db) return demo().logs.filter((l) => l.gateway_message_id && clean.includes(l.gateway_message_id));
  const out: SmsLog[] = [];
  const PAGE = 1000;
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from("sms_logs").select("*").in("gateway_message_id", clean).range(from, from + PAGE - 1);
      if (error) break;
      const rows = (data || []) as SmsLog[];
      out.push(...rows);
      if (rows.length < PAGE) break; // last page
    }
    return out;
  } catch {
    return out;
  }
}

export interface CampaignSummary {
  campaign_id: string;
  template_name: string | null;
  audience_type: string | null;
  created_at: string;
  total: number;
  queued: number; sent: number; delivered: number; failed: number; unknown: number;
  deliveryRate: number; // delivered / total, %
}

/**
 * Recent campaigns (manual/bulk sends), aggregated from campaign-tagged logs.
 * Groups the last `scan` campaign rows by campaign_id in memory (Supabase JS has
 * no group-by), newest first. Delivery rate = delivered / total. Cheap enough for
 * a marketing team's history; add server-side rollup later if volume explodes.
 */
export async function listCampaigns(limit = 50, scan = 8000): Promise<CampaignSummary[]> {
  const db = getSupabaseAdmin();
  const rows: Pick<SmsLog, "campaign_id" | "template_name" | "audience_type" | "status" | "created_at">[] = [];
  if (!db) {
    for (const l of demo().logs) if (l.campaign_id) rows.push(l);
  } else {
    try {
      const { data } = await db.from("sms_logs").select("campaign_id, template_name, audience_type, status, created_at")
        .not("campaign_id", "is", null).order("created_at", { ascending: false }).limit(scan);
      for (const r of (data || []) as Row[]) rows.push({ campaign_id: String(r.campaign_id), template_name: (r.template_name as string) ?? null, audience_type: (r.audience_type as string) ?? null, status: r.status as SmsLog["status"], created_at: String(r.created_at) });
    } catch { return []; }
  }
  const map = new Map<string, CampaignSummary>();
  for (const r of rows) {
    if (!r.campaign_id) continue;
    let c = map.get(r.campaign_id);
    if (!c) { c = { campaign_id: r.campaign_id, template_name: r.template_name, audience_type: r.audience_type, created_at: r.created_at, total: 0, queued: 0, sent: 0, delivered: 0, failed: 0, unknown: 0, deliveryRate: 0 }; map.set(r.campaign_id, c); }
    c.total++;
    if (r.status === "QUEUED") c.queued++;
    else if (r.status === "SENT") c.sent++;
    else if (r.status === "DELIVERED") c.delivered++;
    else if (r.status === "FAILED") c.failed++;
    else c.unknown++;
    if (r.created_at > c.created_at) c.created_at = r.created_at;
    if (!c.template_name && r.template_name) c.template_name = r.template_name;
    if (!c.audience_type && r.audience_type) c.audience_type = r.audience_type;
  }
  const out = [...map.values()].map((c) => ({ ...c, deliveryRate: c.total ? Math.round((c.delivered / c.total) * 1000) / 10 : 0 }));
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return out.slice(0, limit);
}

/** All logs for one campaign (live send-status view + resend-to-failed). Newest first. */
export async function listLogsByCampaign(campaignId: string): Promise<SmsLog[]> {
  const id = (campaignId || "").trim();
  if (!id) return [];
  const db = getSupabaseAdmin();
  if (!db) return demo().logs.filter((l) => l.campaign_id === id);
  const out: SmsLog[] = [];
  const PAGE = 1000;
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from("sms_logs").select("*").eq("campaign_id", id)
        .order("created_at", { ascending: true }).range(from, from + PAGE - 1);
      if (error) break;
      const rows = (data || []) as SmsLog[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  } catch { return out; }
}

// ---------------------------------------------------------------------------
// SAVED AUDIENCES (composable filter combinations a marketer can reload)
// Stores only the FilterSpec — never a frozen recipient list — so a reloaded
// audience always re-resolves against live data. Service-role only.
// ---------------------------------------------------------------------------
export interface SavedAudience {
  id: string;
  name: string;
  spec: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

interface DemoSaved { rows: SavedAudience[] }
function demoSaved(): DemoSaved {
  const g = globalThis as unknown as { __smsSaved?: DemoSaved };
  if (!g.__smsSaved) g.__smsSaved = { rows: [] };
  return g.__smsSaved;
}

export async function listSavedAudiences(): Promise<SavedAudience[]> {
  const db = getSupabaseAdmin();
  if (!db) return [...demoSaved().rows];
  try {
    const { data } = await db.from("sms_saved_audiences").select("*").order("created_at", { ascending: false });
    return (data || []).map((r: Row) => ({
      id: String(r.id), name: String(r.name), spec: (r.spec as Record<string, unknown>) || {},
      created_by: (r.created_by as string) ?? null, created_at: String(r.created_at || nowISO()),
    }));
  } catch { return []; }
}

export async function createSavedAudience(name: string, spec: Record<string, unknown>, createdBy?: string | null): Promise<SavedAudience | null> {
  const clean = (name || "").trim().slice(0, 80);
  if (!clean) return null;
  const db = getSupabaseAdmin();
  if (!db) {
    const row: SavedAudience = { id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: clean, spec, created_by: createdBy ?? null, created_at: nowISO() };
    demoSaved().rows.unshift(row);
    return row;
  }
  try {
    const { data, error } = await db.from("sms_saved_audiences").insert({ name: clean, spec, created_by: createdBy ?? null }).select("*").single();
    if (error || !data) return null;
    return { id: String(data.id), name: String(data.name), spec: (data.spec as Record<string, unknown>) || {}, created_by: (data.created_by as string) ?? null, created_at: String(data.created_at) };
  } catch { return null; }
}

export async function deleteSavedAudience(id: string): Promise<boolean> {
  const clean = (id || "").trim();
  if (!clean) return false;
  const db = getSupabaseAdmin();
  if (!db) { const d = demoSaved(); const n = d.rows.length; d.rows = d.rows.filter((r) => r.id !== clean); return d.rows.length < n; }
  try { await db.from("sms_saved_audiences").delete().eq("id", clean); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// OPT-OUT / DND SUPPRESSION (compliance) — enforced on EVERY send path.
// Fail-open on infra error (never block a legitimate send because the table is
// unreachable); the suppression is a filter, not a gate.
// ---------------------------------------------------------------------------
export interface OptOut { normalized_mobile: string; reason: string | null; source: string; created_by: string | null; created_at: string }

interface DemoOpt { rows: OptOut[] }
function demoOpt(): DemoOpt {
  const g = globalThis as unknown as { __smsOptOuts?: DemoOpt };
  if (!g.__smsOptOuts) g.__smsOptOuts = { rows: [] };
  return g.__smsOptOuts;
}
const norm10 = (m: string) => (m || "").replace(/\D/g, "").slice(-10);

export async function listOptOuts(): Promise<OptOut[]> {
  const db = getSupabaseAdmin();
  if (!db) return [...demoOpt().rows];
  try {
    const { data } = await db.from("sms_opt_outs").select("*").order("created_at", { ascending: false });
    return (data || []).map((r: Row) => ({ normalized_mobile: String(r.normalized_mobile), reason: (r.reason as string) ?? null, source: String(r.source || "manual"), created_by: (r.created_by as string) ?? null, created_at: String(r.created_at || nowISO()) }));
  } catch { return []; }
}

/** Upsert an opt-out. An inbound STOP webhook calls this with source='sms_stop'. */
export async function addOptOut(mobile: string, reason?: string | null, source = "manual", createdBy?: string | null): Promise<boolean> {
  const n = norm10(mobile);
  if (n.length !== 10) return false;
  const db = getSupabaseAdmin();
  if (!db) { const d = demoOpt(); if (!d.rows.some((r) => r.normalized_mobile === n)) d.rows.unshift({ normalized_mobile: n, reason: reason ?? null, source, created_by: createdBy ?? null, created_at: nowISO() }); return true; }
  try { await db.from("sms_opt_outs").upsert({ normalized_mobile: n, reason: reason ?? null, source, created_by: createdBy ?? null }); return true; } catch { return false; }
}

export async function removeOptOut(mobile: string): Promise<boolean> {
  const n = norm10(mobile);
  if (n.length !== 10) return false;
  const db = getSupabaseAdmin();
  if (!db) { const d = demoOpt(); d.rows = d.rows.filter((r) => r.normalized_mobile !== n); return true; }
  try { await db.from("sms_opt_outs").delete().eq("normalized_mobile", n); return true; } catch { return false; }
}

/** Is ONE number opted out? Fail-open (false) on error. */
export async function isOptedOut(mobile: string): Promise<boolean> {
  const n = norm10(mobile);
  if (n.length !== 10) return false;
  const db = getSupabaseAdmin();
  if (!db) return demoOpt().rows.some((r) => r.normalized_mobile === n);
  try { const { count } = await db.from("sms_opt_outs").select("normalized_mobile", { count: "exact", head: true }).eq("normalized_mobile", n); return (count || 0) > 0; } catch { return false; }
}

/** Subset of `numbers` that are opted out, in ONE query (batch screening). Fail-open (empty). */
export async function optedOutSet(numbers: string[]): Promise<Set<string>> {
  const nums = [...new Set(numbers.map(norm10).filter((x) => x.length === 10))];
  const out = new Set<string>();
  if (!nums.length) return out;
  const db = getSupabaseAdmin();
  if (!db) { for (const r of demoOpt().rows) if (nums.includes(r.normalized_mobile)) out.add(r.normalized_mobile); return out; }
  try {
    const { data } = await db.from("sms_opt_outs").select("normalized_mobile").in("normalized_mobile", nums);
    for (const r of (data || []) as Row[]) out.add(String(r.normalized_mobile));
    return out;
  } catch { return out; }
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
  campaign_id?: string | null;
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

/**
 * HARD anti-spam window: has the SAME template gone to this mobile within N
 * minutes (any non-failed attempt)? Applies to auto AND manual sends so a
 * recipient is never hit twice with the same message in quick succession.
 */
export async function recentSameTemplate(normalizedMobile: string, templateId: string, withinMinutes: number): Promise<boolean> {
  const sinceISO = new Date(Date.now() - withinMinutes * 60000).toISOString();
  const db = getSupabaseAdmin();
  if (!db) {
    return demo().logs.some((l) => l.normalized_mobile === normalizedMobile && l.template_id === templateId && ["SENT", "DELIVERED", "QUEUED"].includes(l.status) && l.created_at >= sinceISO);
  }
  try {
    const { count } = await db.from("sms_logs").select("id", { count: "exact", head: true })
      .eq("normalized_mobile", normalizedMobile).eq("template_id", templateId)
      .gte("created_at", sinceISO).in("status", ["SENT", "DELIVERED", "QUEUED"]);
    return (count || 0) > 0;
  } catch { return false; }
}

/**
 * BATCH form of {@link recentSameTemplate}: in ONE query, return the subset of
 * `normalizedMobiles` that already received `templateId` within N minutes. Used by
 * the bulk orchestrator so a 170-recipient screen costs one round-trip, not 170.
 */
export async function recentTemplateHits(normalizedMobiles: string[], templateId: string, withinMinutes: number): Promise<Set<string>> {
  const nums = [...new Set(normalizedMobiles.filter(Boolean))];
  const hits = new Set<string>();
  if (!nums.length) return hits;
  const sinceISO = new Date(Date.now() - withinMinutes * 60000).toISOString();
  const db = getSupabaseAdmin();
  if (!db) {
    for (const l of demo().logs) {
      if (l.template_id === templateId && nums.includes(l.normalized_mobile) && ["SENT", "DELIVERED", "QUEUED"].includes(l.status) && l.created_at >= sinceISO) hits.add(l.normalized_mobile);
    }
    return hits;
  }
  try {
    const { data } = await db.from("sms_logs").select("normalized_mobile")
      .eq("template_id", templateId).gte("created_at", sinceISO)
      .in("status", ["SENT", "DELIVERED", "QUEUED"]).in("normalized_mobile", nums);
    for (const r of (data || []) as Row[]) hits.add(String(r.normalized_mobile));
    return hits;
  } catch { return hits; }
}

/**
 * BATCH per-mobile daily count: in ONE query, tally today's SENT/DELIVERED logs
 * per number for the given list. Only used when a per-mobile cap is configured.
 */
export async function countsByMobileSince(sinceISO: string, normalizedMobiles: string[]): Promise<Map<string, number>> {
  const nums = [...new Set(normalizedMobiles.filter(Boolean))];
  const map = new Map<string, number>();
  if (!nums.length) return map;
  const db = getSupabaseAdmin();
  if (!db) {
    for (const l of demo().logs) {
      if (["SENT", "DELIVERED"].includes(l.status) && l.created_at >= sinceISO && nums.includes(l.normalized_mobile)) map.set(l.normalized_mobile, (map.get(l.normalized_mobile) || 0) + 1);
    }
    return map;
  }
  try {
    const { data } = await db.from("sms_logs").select("normalized_mobile").gte("created_at", sinceISO).in("status", ["SENT", "DELIVERED"]).in("normalized_mobile", nums);
    for (const r of (data || []) as Row[]) { const k = String(r.normalized_mobile); map.set(k, (map.get(k) || 0) + 1); }
    return map;
  } catch { return map; }
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
