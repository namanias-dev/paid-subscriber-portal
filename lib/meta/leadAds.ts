/**
 * Meta Lead Ads — Graph client + signature verification.
 *
 * Enabled only when META_LEADS_ENABLED=true and all required secrets are set.
 * Page token must be a LONG-LIVED Page access token (server-side only).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { isMetaLeadsEnabled } from "../legacy-migration/flags";
import { META_GRAPH_VERSION } from "../analytics/metaEvents";

export class MetaLeadsNotConfiguredError extends Error {
  constructor(readonly missing: string[]) {
    super(`Meta Lead Ads is not configured. Missing: ${missing.join(", ")}`);
    this.name = "MetaLeadsNotConfiguredError";
  }
}

export interface MetaLeadgenPayload {
  leadgen_id: string;
  page_id: string;
  ad_id?: string;
  adgroup_id?: string;
  campaign_id?: string;
  form_id: string;
  /** Unix seconds from Meta webhook. */
  created_time: number;
}

export interface MetaLeadFieldSet {
  phone_number: string | null;
  full_name: string | null;
  email: string | null;
  city: string | null;
  raw_field_data: Array<{ name: string; values: string[] }>;
}

export interface CapturedMetaLead extends MetaLeadgenPayload {
  fields: MetaLeadFieldSet;
  ad_name?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  campaign_name?: string | null;
  form_name?: string | null;
  platform?: string | null;
  /** Full Graph JSON for this lead. */
  raw_lead: Record<string, unknown>;
  meta_created_at: string;
}

export function missingMetaConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.META_APP_ID) missing.push("META_APP_ID");
  if (!process.env.META_APP_SECRET) missing.push("META_APP_SECRET");
  if (!process.env.META_LEADGEN_VERIFY_TOKEN) missing.push("META_LEADGEN_VERIFY_TOKEN");
  if (!process.env.META_LONG_LIVED_TOKEN) missing.push("META_LONG_LIVED_TOKEN");
  if (!isMetaLeadsEnabled()) missing.push("META_LEADS_ENABLED=true");
  return missing;
}

export function graphVersion(): string {
  return (process.env.META_GRAPH_VERSION || META_GRAPH_VERSION || "v21.0").trim();
}

/** X-Hub-Signature-256: sha256=<hex> over the raw body with app secret. */
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null | undefined): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signatureHeader) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader.trim());
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function appsecretProof(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

function firstValue(
  fields: Array<{ name: string; values?: string[] }>,
  aliases: string[],
): string | null {
  const wanted = new Set(aliases.map((a) => a.toLowerCase().replace(/[\s_]+/g, "")));
  for (const f of fields) {
    const key = String(f.name || "").toLowerCase().replace(/[\s_]+/g, "");
    if (!wanted.has(key)) continue;
    const v = (f.values || []).map((x) => String(x || "").trim()).find(Boolean);
    if (v) return v;
  }
  return null;
}

/** Parse Meta leadgen webhook JSON into typed payloads (pure). */
export function extractLeadgenPayloads(body: unknown): MetaLeadgenPayload[] {
  if (!body || typeof body !== "object") return [];
  const entries = (body as { entry?: unknown[] }).entry;
  if (!Array.isArray(entries)) return [];
  const out: MetaLeadgenPayload[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const changes = (e as { changes?: unknown[] }).changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      if (!c || typeof c !== "object") continue;
      const field = (c as { field?: string }).field;
      if (field && field !== "leadgen") continue;
      const v = (c as { value?: unknown }).value;
      if (!v || typeof v !== "object") continue;
      const val = v as Record<string, unknown>;
      const leadgenId = typeof val.leadgen_id === "string" ? val.leadgen_id : String(val.leadgen_id ?? "");
      const pageId = typeof val.page_id === "string" ? val.page_id : String(val.page_id ?? "");
      const formId = typeof val.form_id === "string" ? val.form_id : String(val.form_id ?? "");
      const createdTime = typeof val.created_time === "number" ? val.created_time : Number(val.created_time ?? 0);
      if (!leadgenId || !pageId || !formId) continue;
      out.push({
        leadgen_id: leadgenId,
        page_id: pageId,
        form_id: formId,
        created_time: Number.isFinite(createdTime) ? createdTime : 0,
        ad_id: typeof val.ad_id === "string" ? val.ad_id : undefined,
        adgroup_id: typeof val.adgroup_id === "string" ? val.adgroup_id : undefined,
        campaign_id: typeof val.campaign_id === "string" ? val.campaign_id : undefined,
      });
    }
  }
  return out;
}

export function mapFieldData(
  fieldData: Array<{ name: string; values?: string[] }> | null | undefined,
): MetaLeadFieldSet {
  const raw = Array.isArray(fieldData)
    ? fieldData.map((f) => ({ name: String(f.name || ""), values: (f.values || []).map(String) }))
    : [];
  return {
    full_name: firstValue(raw, ["full_name", "full name", "name", "your name"]),
    phone_number: firstValue(raw, ["phone_number", "phone", "mobile", "mobile_number", "whatsapp"]),
    email: firstValue(raw, ["email", "email_address"]),
    city: firstValue(raw, ["city", "city_name", "town"]),
    raw_field_data: raw,
  };
}

async function graphGet(path: string, fields?: string): Promise<Record<string, unknown>> {
  const token = process.env.META_LONG_LIVED_TOKEN!;
  const secret = process.env.META_APP_SECRET!;
  const version = graphVersion();
  const url = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\//, "")}`);
  if (fields) url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);
  url.searchParams.set("appsecret_proof", appsecretProof(token, secret));
  const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string } | undefined)?.message || res.statusText;
    throw new Error(`Graph ${res.status}: ${err}`);
  }
  return json;
}

export async function fetchLeadgenRecord(payload: MetaLeadgenPayload): Promise<CapturedMetaLead> {
  const missing = missingMetaConfig();
  if (missing.length > 0) throw new MetaLeadsNotConfiguredError(missing);

  const lead = await graphGet(
    payload.leadgen_id,
    "created_time,id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,is_organic,platform",
  );

  const fieldData = Array.isArray(lead.field_data)
    ? (lead.field_data as Array<{ name: string; values?: string[] }>)
    : [];
  const fields = mapFieldData(fieldData);

  let formName: string | null = null;
  const formId = String(lead.form_id || payload.form_id || "");
  if (formId) {
    try {
      const form = await graphGet(formId, "name");
      formName = typeof form.name === "string" ? form.name : null;
    } catch {
      formName = null;
    }
  }

  const createdRaw = lead.created_time;
  let metaCreatedAt: string;
  if (typeof createdRaw === "string" && createdRaw) {
    metaCreatedAt = new Date(createdRaw).toISOString();
  } else if (payload.created_time > 0) {
    metaCreatedAt = new Date(payload.created_time * 1000).toISOString();
  } else {
    metaCreatedAt = new Date().toISOString();
  }

  return {
    ...payload,
    form_id: formId || payload.form_id,
    ad_id: typeof lead.ad_id === "string" ? lead.ad_id : payload.ad_id,
    adgroup_id: typeof lead.adset_id === "string" ? lead.adset_id : payload.adgroup_id,
    campaign_id: typeof lead.campaign_id === "string" ? lead.campaign_id : payload.campaign_id,
    fields,
    ad_name: typeof lead.ad_name === "string" ? lead.ad_name : null,
    adset_id: typeof lead.adset_id === "string" ? lead.adset_id : null,
    adset_name: typeof lead.adset_name === "string" ? lead.adset_name : null,
    campaign_name: typeof lead.campaign_name === "string" ? lead.campaign_name : null,
    form_name: formName,
    platform: typeof lead.platform === "string" ? lead.platform : null,
    raw_lead: lead,
    meta_created_at: metaCreatedAt,
  };
}

/** List lead forms on a Page (historical import / reconcile). */
export async function listPageLeadForms(pageId: string): Promise<Array<{ id: string; name: string }>> {
  const missing = missingMetaConfig();
  if (missing.length > 0) throw new MetaLeadsNotConfiguredError(missing);
  const out: Array<{ id: string; name: string }> = [];
  let after: string | null = null;
  for (let i = 0; i < 20; i++) {
    const token = process.env.META_LONG_LIVED_TOKEN!;
    const secret = process.env.META_APP_SECRET!;
    const version = graphVersion();
    const url = new URL(`https://graph.facebook.com/${version}/${pageId}/leadgen_forms`);
    url.searchParams.set("fields", "id,name");
    url.searchParams.set("limit", "50");
    url.searchParams.set("access_token", token);
    url.searchParams.set("appsecret_proof", appsecretProof(token, secret));
    if (after) url.searchParams.set("after", after);
    const res = await fetch(url.toString(), { cache: "no-store" });
    const json = (await res.json()) as {
      data?: Array<{ id: string; name?: string }>;
      paging?: { cursors?: { after?: string } };
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(json.error?.message || `forms ${res.status}`);
    for (const row of json.data || []) {
      if (row.id) out.push({ id: row.id, name: row.name || row.id });
    }
    after = json.paging?.cursors?.after || null;
    if (!after || !(json.data || []).length) break;
  }
  return out;
}

/** Page leads for one form (newest first). Caps pages for safety. */
export async function listFormLeads(
  formId: string,
  opts?: { maxPages?: number; sinceUnix?: number },
): Promise<Array<Record<string, unknown>>> {
  const missing = missingMetaConfig();
  if (missing.length > 0) throw new MetaLeadsNotConfiguredError(missing);
  const maxPages = opts?.maxPages ?? 10;
  const out: Array<Record<string, unknown>> = [];
  let after: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const token = process.env.META_LONG_LIVED_TOKEN!;
    const secret = process.env.META_APP_SECRET!;
    const version = graphVersion();
    const url = new URL(`https://graph.facebook.com/${version}/${formId}/leads`);
    url.searchParams.set(
      "fields",
      "created_time,id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,platform",
    );
    url.searchParams.set("limit", "100");
    url.searchParams.set("access_token", token);
    url.searchParams.set("appsecret_proof", appsecretProof(token, secret));
    if (after) url.searchParams.set("after", after);
    const res = await fetch(url.toString(), { cache: "no-store" });
    const json = (await res.json()) as {
      data?: Array<Record<string, unknown>>;
      paging?: { cursors?: { after?: string } };
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(json.error?.message || `leads ${res.status}`);
    for (const row of json.data || []) {
      if (opts?.sinceUnix && typeof row.created_time === "string") {
        const t = Math.floor(new Date(row.created_time).getTime() / 1000);
        if (t < opts.sinceUnix) continue;
      }
      out.push(row);
    }
    after = json.paging?.cursors?.after || null;
    if (!after || !(json.data || []).length) break;
  }
  return out;
}
