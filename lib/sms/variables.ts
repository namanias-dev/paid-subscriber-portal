/**
 * SMS variable store — editable template variables that take effect on new sends
 * immediately, no code change/redeploy. Two scopes:
 *   • global      → shared across templates (e.g. login_url, the rotating link)
 *   • <templateId>→ per-template overrides (win over global)
 *
 * Supabase-backed (table `sms_variables`, single jsonb blob per scope, mirroring
 * `sms_settings`); in-memory fallback in demo mode. If the table is missing every
 * read returns {} so resolution falls back to the config/env defaults — no
 * regression to existing sends. Secrets are NEVER stored here.
 */
import { getSupabaseAdmin } from "../supabase";
import { loginUrlForTemplate, portalLoginUrl } from "./config";

export const GLOBAL_SCOPE = "global";

export type SmsVariableKind = "url" | "text";

export interface ManagedVariable {
  key: string;
  label: string;
  kind: SmsVariableKind;
  description: string;
}

/**
 * Catalogue of GLOBAL variables the admin UI manages. Extensible — add a row to
 * expose another shared variable. `login_url` is the flagship: the login link
 * referenced by most templates, rotated ~every 15 days.
 */
export const MANAGED_GLOBAL_VARIABLES: ManagedVariable[] = [
  {
    key: "login_url",
    label: "Login / Portal URL",
    kind: "url",
    description:
      "The link students tap to log in. The provider rotates the short link roughly every 15 days — update it here to change it across every template at once.",
  },
];

export function managedGlobal(key: string): ManagedVariable | undefined {
  return MANAGED_GLOBAL_VARIABLES.find((v) => v.key === key);
}

type VarMap = Record<string, string>;

// --- demo (in-memory) fallback ---------------------------------------------
interface DemoVars { scopes: Record<string, VarMap> }
function demo(): DemoVars {
  const g = globalThis as unknown as { __smsVars?: DemoVars };
  if (!g.__smsVars) g.__smsVars = { scopes: {} };
  return g.__smsVars;
}
const nowISO = () => new Date().toISOString();

async function readScope(scope: string): Promise<VarMap> {
  const db = getSupabaseAdmin();
  if (!db) return { ...(demo().scopes[scope] || {}) };
  try {
    const { data } = await db.from("sms_variables").select("data").eq("scope", scope).maybeSingle();
    return ((data?.data as VarMap) || {});
  } catch {
    return {}; // table absent / transient → fall back to config defaults
  }
}

async function writeScopeVar(scope: string, key: string, value: string | null, updatedBy?: string | null): Promise<VarMap> {
  const current = await readScope(scope);
  const next = { ...current };
  if (value === null || value.trim() === "") delete next[key];
  else next[key] = value.trim();
  const db = getSupabaseAdmin();
  if (!db) { demo().scopes[scope] = next; return next; }
  try {
    await db.from("sms_variables").upsert({ scope, data: next, updated_by: updatedBy ?? null, updated_at: nowISO() });
  } catch { /* ignore — non-fatal */ }
  return next;
}

export async function getGlobalVariables(): Promise<VarMap> { return readScope(GLOBAL_SCOPE); }
export async function getTemplateVariables(templateId: string): Promise<VarMap> { return readScope(templateId); }

export async function setGlobalVariable(key: string, value: string | null, updatedBy?: string | null): Promise<VarMap> {
  return writeScopeVar(GLOBAL_SCOPE, key, value, updatedBy);
}
export async function setTemplateVariable(templateId: string, key: string, value: string | null, updatedBy?: string | null): Promise<VarMap> {
  return writeScopeVar(templateId, key, value, updatedBy);
}

export interface ScopeRecord { data: VarMap; updated_by: string | null; updated_at: string | null }

/** Every scope in ONE query (global + all per-template) for the admin UI. */
export async function getAllScopes(): Promise<Record<string, ScopeRecord>> {
  const db = getSupabaseAdmin();
  if (!db) {
    const out: Record<string, ScopeRecord> = {};
    for (const [scope, data] of Object.entries(demo().scopes)) out[scope] = { data: { ...data }, updated_by: null, updated_at: null };
    return out;
  }
  try {
    const { data } = await db.from("sms_variables").select("scope, data, updated_by, updated_at");
    const out: Record<string, ScopeRecord> = {};
    for (const r of (data || []) as Array<Record<string, unknown>>) {
      out[String(r.scope)] = { data: (r.data as VarMap) || {}, updated_by: (r.updated_by as string) ?? null, updated_at: (r.updated_at as string) ?? null };
    }
    return out;
  } catch {
    return {};
  }
}

/** Metadata row for the "who changed what/when" audit note. */
export async function getScopeMeta(scope: string): Promise<{ updated_by: string | null; updated_at: string | null }> {
  const db = getSupabaseAdmin();
  if (!db) return { updated_by: null, updated_at: null };
  try {
    const { data } = await db.from("sms_variables").select("updated_by, updated_at").eq("scope", scope).maybeSingle();
    return { updated_by: (data?.updated_by as string) ?? null, updated_at: (data?.updated_at as string) ?? null };
  } catch {
    return { updated_by: null, updated_at: null };
  }
}

/**
 * Resolved variable DEFAULTS for a template: globals + per-template overrides.
 * These become defaults that explicit send-time variables (real recipient data)
 * can still override. `login_url` respects each template's destination:
 *   • per-template override wins;
 *   • else if the template links to the portal login → the global login_url
 *     (falling back to config) so a rotated link propagates everywhere;
 *   • else keep the template's own destination (webinars/courses) from config.
 */
export async function getResolvedDefaults(templateId: string): Promise<VarMap> {
  const [globals, perT] = await Promise.all([getGlobalVariables(), getTemplateVariables(templateId)]);
  const out: VarMap = { ...globals, ...perT };

  const configUrl = loginUrlForTemplate(templateId);
  const isPortalLogin = configUrl === portalLoginUrl();
  if (perT.login_url) out.login_url = perT.login_url;
  else if (isPortalLogin) out.login_url = globals.login_url || configUrl;
  else out.login_url = configUrl;

  return out;
}

/** Well-formed http(s) URL check for url-kind variables. */
export function isValidHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
