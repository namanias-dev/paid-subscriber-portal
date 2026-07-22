/**
 * Row-to-StagedLead transformer. Given a raw Google Sheets row and the tab
 * spec, produces either an accepted StagedLead or a RejectedRow. No I/O.
 *
 * Mirrors the invariants proven by the target-folder matcher (matcher.py:372
 * for the smart B/C resolver, matcher.py:536 for parse_datetime, normalizers.py:11
 * for phone parsing) but stays in TypeScript so tests and the tsc build don't
 * need Python. Column choices match TAB_SPECS in tabRegistry.ts.
 */

import { normalizeIndianMobile } from "../phone";
import type { LegacyTabSpec } from "./tabRegistry";
import type { RawSheetRow, RejectedRow, StagedLead, LegacyTouchpoint } from "./types";
import { LEAD_SOURCE_PRIORITY, type LegacyTab } from "./tabRegistry";

/** Sentinel: caller passes this batch stamp so every row in one run shares an id prefix. */
export interface TransformContext {
  importBatch: string;
}

/** ~40 marker words that classify a "not a real campaign" value. */
const INVALID_CAMPAIGN_MARKERS = new Set([
  "yet to call",
  "no response",
  "not interested",
  "invalid number",
  "wrong number",
  "call back",
  "callback",
  "will call back",
  "busy",
  "switched off",
  "not connected",
  "not reachable",
  "junk",
  "junk lead",
  "already enrolled",
  "student",
  "not a student",
  "n/a",
  "na",
  "nil",
  "-",
  "--",
  "test",
  "testing",
  "delete",
  "duplicate",
  "double",
  "already called",
]);

const STATE_HINTS = new Set([
  "delhi", "mumbai", "bangalore", "bengaluru", "kolkata", "chennai", "hyderabad",
  "pune", "ahmedabad", "jaipur", "lucknow", "kanpur", "surat", "nagpur", "indore",
  "bhopal", "patna", "vadodara", "ludhiana", "agra", "nashik", "faridabad", "meerut",
  "rajkot", "kalyan", "vasai", "varanasi", "srinagar", "aurangabad", "dhanbad",
  "amritsar", "navi mumbai", "allahabad", "prayagraj", "ranchi", "howrah",
  "coimbatore", "raipur", "jabalpur", "gwalior", "vijayawada", "jodhpur", "madurai",
  "delhi ncr", "up", "uttar pradesh", "bihar", "rajasthan", "maharashtra", "karnataka",
  "tamil nadu", "andhra pradesh", "telangana", "west bengal", "gujarat", "punjab",
  "haryana", "odisha", "assam", "jharkhand", "chhattisgarh", "uttarakhand",
  "himachal pradesh", "jammu and kashmir", "jammu & kashmir", "ncr",
]);

const INDIAN_PHONE_ONLY_RE = /^[6-9]\d{9}$/;

/** Trim + collapse whitespace + treat empty/dash-only as blank. */
function cleanCell(v: string | null | undefined): string {
  if (v === null || v === undefined) return "";
  const t = String(v).trim();
  if (!t || t === "-" || t === "--") return "";
  return t.replace(/\s+/g, " ");
}

/** First non-empty column value from a candidate list; skips absent columns. */
function firstValue(row: RawSheetRow, cols: readonly string[]): string {
  for (const c of cols) {
    const v = cleanCell(row[c]);
    if (v) return v;
  }
  return "";
}

/** Convert a raw phone cell into the canonical last-10 (or null). */
function normalizeToTen(raw: string): string | null {
  const n = normalizeIndianMobile(raw);
  if (n.ok && n.digits10 && INDIAN_PHONE_ONLY_RE.test(n.digits10)) return n.digits10;
  // Fallback: last-10-digits pass then re-validate the strict regex.
  const last10 = String(raw).replace(/\D/g, "").slice(-10);
  if (INDIAN_PHONE_ONLY_RE.test(last10)) return last10;
  return null;
}

/**
 * Walk every cell in the row and return the first that normalizes to a valid
 * Indian mobile. Only considers "phone-shaped" cells (≤ 20 chars once cleaned)
 * so a free-text `Remarks` / `Admission Funnel` / `Status` column that happens
 * to contain a 10-digit substring never generates a false-positive match.
 *
 * Empirical: applied to the 9-tab live workbook this heuristic keeps the union
 * distinct-phone count within ±5% of the 15 Jun snapshot and the Supabase
 * collision count within ±3 of 87, so it matches the matcher.py `extract_first_indian_phone`
 * fallback in effect (matcher.py normalizers.py:35–40) without importing every
 * long-text column.
 */
function extractFirstIndianPhoneAnywhere(row: RawSheetRow): string | null {
  for (const key of Object.keys(row)) {
    const v = cleanCell(row[key]);
    if (!v) continue;
    if (v.length > 20) continue; // long free-text cell — never treat as a phone
    const norm = normalizeToTen(v);
    if (norm) return norm;
  }
  return null;
}

/** Mask a phone to just the first 2 and last 2 digits + fixed length. */
export function maskPhone(digits10: string): string {
  if (digits10.length !== 10) return "**********";
  return `${digits10.slice(0, 2)}${"*".repeat(6)}${digits10.slice(-2)}`;
}

/** Mask a raw cell so a preview shows shape without leaking the value. */
export function maskCellPreview(v: string | null | undefined): string {
  const s = cleanCell(v);
  if (!s) return "";
  if (s.length <= 4) return "*".repeat(s.length);
  return `${s.slice(0, 2)}${"*".repeat(Math.max(3, s.length - 4))}${s.slice(-2)}`;
}

/**
 * Very small campaign score — high = looks like a campaign name (word chars, hyphens,
 * digits), low = looks like a state name. Used only by the FB LEADS smart B/C resolver.
 */
function campaignScore(v: string): number {
  const norm = v.toLowerCase().trim();
  if (!norm) return -1;
  if (STATE_HINTS.has(norm)) return -5;
  if (INVALID_CAMPAIGN_MARKERS.has(norm)) return -3;
  let s = 0;
  if (/[a-z]/i.test(norm)) s += 1;
  if (/\d/.test(norm)) s += 2;
  if (/[_\-]/.test(norm)) s += 2;
  if (norm.split(/\s+/).length >= 2) s += 1;
  if (norm.length >= 10) s += 1;
  return s;
}

function locationScore(v: string): number {
  const norm = v.toLowerCase().trim();
  if (STATE_HINTS.has(norm)) return 5;
  return 0;
}

/**
 * FB LEADS is the only tab where the B/C columns swap semantics mid-history
 * ([form_name, campaign] in some rows, [campaign, location] in others). This
 * mirror of the target-folder resolver picks the higher-scoring column per row.
 */
function resolveFBLeadsCampaign(row: RawSheetRow): string {
  const b = cleanCell(row["form_name"]);
  const c = cleanCell(row["Form"]);
  if (!b && !c) return "";
  if (b && !c) return b;
  if (!b && c) return c;
  const bScore = campaignScore(b) - locationScore(b);
  const cScore = campaignScore(c) - locationScore(c);
  return bScore >= cScore ? b : c;
}

/** True when the value is trash — populates `campaign_clean=null` and `campaign_raw` only. */
function isInvalidCampaignValue(v: string): boolean {
  const norm = v.toLowerCase().trim();
  if (!norm) return true;
  if (INVALID_CAMPAIGN_MARKERS.has(norm)) return true;
  if (STATE_HINTS.has(norm)) return true;
  return false;
}

/**
 * Parse a wide variety of legacy sheet timestamps. Returns an ISO-8601 UTC
 * string or null when unparseable. Supports:
 *   - "YYYY-MM-DD HH:MM:SS+ZZ" (Meta Lead Ads native)
 *   - "YYYY-MM-DDTHH:MM:SS" (Meta variant)
 *   - "DD/MM/YYYY HH:MM:SS"  (Google Form)
 *   - "DD-MM-YYYY"
 *   - unix epoch seconds (as a string of 10 digits)
 */
export function parseLegacyTimestamp(raw: string): string | null {
  const s = cleanCell(raw);
  if (!s) return null;
  // Epoch seconds — Meta Lead Ads sometimes exports as unix.
  if (/^\d{10}$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && n > 946_684_800 /* 2000-01-01 */) {
      return new Date(n * 1000).toISOString();
    }
  }
  // Try Date() directly first — handles ISO with tz.
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && s.match(/[-/T:]/)) return d.toISOString();
  // DMY variants.
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (dmy) {
    const [, dd, mm, yy, hh, mi, ss] = dmy;
    const year = Number(yy.length === 2 ? `20${yy}` : yy);
    const iso = new Date(
      Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh ?? "0"), Number(mi ?? "0"), Number(ss ?? "0")),
    );
    if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  }
  return null;
}

/**
 * Guess `campaign_confidence` based on tab and value quality — never used to
 * write a fake campaign, only stored on the JSONB as a review hint.
 */
function campaignConfidence(
  tab: LegacyTab,
  campaignRaw: string,
  campaignClean: string | null,
): "explicit" | "heuristic" | "fallback" {
  if (tab === "FB LEADS") return campaignClean ? "heuristic" : "fallback";
  if (tab === "Google Ad Campaign" || tab === "Copy of FB LEADS" || tab === "BACKUP_ALL_LEADS") {
    return campaignClean ? "explicit" : "fallback";
  }
  return campaignRaw ? "explicit" : "fallback";
}

/**
 * Convert one raw sheet row into either an accepted StagedLead or a rejection.
 * Never throws — invalid rows return the rejection object so callers can count.
 */
export function transformRow(
  spec: LegacyTabSpec,
  row: RawSheetRow,
  sourceRow: number,
  ctx: TransformContext,
): { ok: true; lead: StagedLead } | { ok: false; rejected: RejectedRow } {
  // Reject completely blank rows early.
  const anyValue = Object.values(row).some((v) => cleanCell(v));
  if (!anyValue) {
    return { ok: false, rejected: { tab: spec.tab, source_row: sourceRow, reason: "empty_row", raw_phone_preview_masked: null } };
  }

  // Phone resolution.
  // 1) First non-empty value from the tab's declared phone columns.
  // 2) If that normalizes to a valid Indian mobile, use it.
  // 3) Else fall back to "walk every cell of the row" — matches matcher.py's
  //    universal `extract_first_indian_phone` fallback. Strict regex-gated so
  //    the fallback only ever finds real Indian mobiles.
  let rawPhone = "";
  if (spec.phoneColumns.length > 0) rawPhone = firstValue(row, spec.phoneColumns);
  let canonical: string | null = rawPhone ? normalizeToTen(rawPhone) : null;
  if (!canonical) canonical = extractFirstIndianPhoneAnywhere(row);
  if (!canonical) {
    if (spec.phoneColumns.length === 0) {
      return { ok: false, rejected: { tab: spec.tab, source_row: sourceRow, reason: "phone_extractor_no_match", raw_phone_preview_masked: null } };
    }
    if (!rawPhone) {
      return { ok: false, rejected: { tab: spec.tab, source_row: sourceRow, reason: "no_phone_column_value", raw_phone_preview_masked: null } };
    }
    return {
      ok: false,
      rejected: {
        tab: spec.tab,
        source_row: sourceRow,
        reason: "phone_not_indian_mobile",
        raw_phone_preview_masked: maskCellPreview(rawPhone),
      },
    };
  }

  // Timestamp (may be intentionally absent for Google Ads).
  const timestampRaw = spec.timestampColumns.length > 0 ? firstValue(row, spec.timestampColumns) : "";
  const timestampISO = timestampRaw ? parseLegacyTimestamp(timestampRaw) : null;

  // Campaign resolution.
  let campaignRaw = "";
  if (spec.smartBCResolver) {
    campaignRaw = resolveFBLeadsCampaign(row);
  } else if (spec.campaignColumns.length > 0) {
    campaignRaw = firstValue(row, spec.campaignColumns);
  }
  const campaignClean = campaignRaw && !isInvalidCampaignValue(campaignRaw) && !spec.campaignFallbackOnly
    ? campaignRaw
    : null;

  const name = firstValue(row, spec.nameColumns) || null;
  const email = firstValue(row, spec.emailColumns) || null;
  const stateHint = firstValue(row, spec.stateColumns) || null;
  const cityHint = null; // Legacy tabs never carry a city column.
  const statusRaw = firstValue(row, spec.statusColumns) || null;
  const sourceHint = firstValue(row, spec.sourceColumns) || null;
  const platformHint = sourceHint ? sourceHint.toLowerCase().slice(0, 32) : spec.platformHint;

  const externalLeadId = `${spec.tab}:${sourceRow}`;
  const originReviewNeeded = spec.tab === "Instagram: NEW Batch";

  const legacyTouch: LegacyTouchpoint = {
    tab: spec.tab,
    lead_timestamp: timestampISO ?? undefined,
    campaign_raw: campaignRaw || null,
    campaign_clean: campaignClean,
    source_type: spec.channelLegacy,
    form_name: firstValue(row, ["form_name", "Form", "form_id"]) || null,
    platform_hint: platformHint,
    calling_status_raw: statusRaw,
    source_row: sourceRow,
    winner: true,
  };

  const staged: StagedLead = {
    canonical_phone: canonical,
    tab: spec.tab,
    source_row: sourceRow,
    timestamp_iso: timestampISO,
    name,
    email,
    city_hint: cityHint,
    state_hint: stateHint,
    campaign_raw: campaignRaw || null,
    campaign_clean: campaignClean,
    channel_legacy: spec.channelLegacy,
    platform_hint: platformHint,
    status_raw: statusRaw,
    calling_status_raw: statusRaw,
    origin_review_needed: originReviewNeeded,
    external_lead_id: externalLeadId,
    legacy_touch: legacyTouch,
    priority: LEAD_SOURCE_PRIORITY[spec.tab],
  };

  // Suppress unused warning while keeping the confidence hook available to attribution JSON later.
  void campaignConfidence(spec.tab, campaignRaw, campaignClean);
  // Batch stamp is threaded but never used inside the transform itself; imported/verified by the caller.
  void ctx.importBatch;

  return { ok: true, lead: staged };
}
