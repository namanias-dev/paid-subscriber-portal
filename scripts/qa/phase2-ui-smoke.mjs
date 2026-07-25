/**
 * LOCAL QA ONLY — read-only smoke of the Phase 2 worklist contract against a
 * running `next dev`, using the dev-fallback admin token.
 *
 * Deliberately prints NO phone numbers and no names: it reports shapes,
 * counts and null-coverage only. Nothing here writes.
 *
 *   TOKEN=$(node scripts/qa/mint-local-admin-token.mjs) \
 *   node scripts/qa/phase2-ui-smoke.mjs
 */
const BASE = process.env.BASE || "http://localhost:3000";
const TOKEN = process.env.TOKEN;
if (!TOKEN) throw new Error("Set TOKEN (see scripts/qa/mint-local-admin-token.mjs)");

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: `naman_admin_token=${TOKEN}` } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function pct(n, total) {
  return total === 0 ? "—" : `${((n / total) * 100).toFixed(1)}%`;
}

// ---- 1. keyset pagination accumulates without repeating a row -------------
const seen = new Set();
let cursor = null;
let pages = 0;
let total = null;
let capped = false;
for (let i = 0; i < 6; i++) {
  const qs = new URLSearchParams({ scope: "legacy", limit: "100" });
  if (cursor) {
    qs.set("cursor", cursor);
    qs.set("count", "0");
  }
  const { status, body } = await get(`/api/admin/leads/worklist?${qs}`);
  if (status !== 200 || !body?.ok) throw new Error(`page ${i}: HTTP ${status} ${body?.error}`);
  if (i === 0) {
    total = body.total;
    capped = body.totalIsCapped;
  }
  for (const r of body.rows) seen.add(r.id);
  pages++;
  cursor = body.nextCursor;
  if (!cursor) break;
}
console.log(
  `keyset: ${pages} pages, ${seen.size} unique ids (expect ${pages * 100}), total=${total} capped=${capped}`,
);

// ---- 2. null coverage on the columns the UI must render honestly ----------
const { body: sample } = await get("/api/admin/leads/worklist?scope=legacy&limit=100&count=0");
const rows = sample.rows;
const nulls = (k) => rows.filter((r) => r[k] === null || r[k] === "").length;
console.log("legacy sample of", rows.length, "rows:");
for (const k of [
  "campaign_clean",
  "legacy_call_status_raw",
  "assigned_to",
  "follow_up_at",
  "last_contacted_at",
  "first_seen_at",
  "work_status",
  "import_batch",
]) {
  console.log(`  ${k.padEnd(24)} null/empty: ${String(nulls(k)).padStart(4)}  ${pct(nulls(k), rows.length)}`);
}
console.log("  is_legacy true:", rows.filter((r) => r.is_legacy === true).length);
console.log("  consent values:", [...new Set(rows.map((r) => r.consent_status))].join(", "));
console.log("  distinct status:", [...new Set(rows.map((r) => r.status))].slice(0, 12).join(" | "));

// ---- 3. the drawer's detail payload ---------------------------------------
const id = rows[0].id;
const { status, body: detail } = await get(`/api/admin/leads/${id}/worklist-detail`);
console.log(`detail HTTP ${status} ok=${detail?.ok}`);
console.log("  lead keys:", Object.keys(detail.lead).length);
console.log(
  "  present:",
  ["email", "state", "import_source", "external_lead_id", "attribution", "cohort"]
    .map((k) => `${k}=${detail.lead[k] === null ? "null" : typeof detail.lead[k]}`)
    .join(" "),
);
console.log(
  `  legacyTouchCount=${detail.legacyTouchCount} touches=${Array.isArray(detail.legacyTouches) ? detail.legacyTouches.length : "?"} notes=${detail.notes.length} audit=${detail.audit.length} activities=${detail.activities.length}`,
);
if (Array.isArray(detail.legacyTouches) && detail.legacyTouches[0]) {
  console.log("  touch keys:", Object.keys(detail.legacyTouches[0]).join(","));
}

// ---- 4. live scope, so the UI's non-legacy branch is exercised too --------
const { body: live } = await get("/api/admin/leads/worklist?scope=live&limit=50&count=0");
console.log(
  `live sample: ${live.rows.length} rows, is_legacy true=${live.rows.filter((r) => r.is_legacy).length}, ` +
    `campaign_clean null=${live.rows.filter((r) => !r.campaign_clean).length}, ` +
    `consent=${[...new Set(live.rows.map((r) => r.consent_status))].join("/")}`,
);
