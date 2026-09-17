#!/usr/bin/env node
/**
 * CI guard: Notes Store domain isolation. ISOLATION LAYER 3 of 4.
 *
 * Store orders are a separate money domain from course enrolments
 * (docs/notes-store-spec.md §3). The store gets its own thin data layer so that
 * "just reuse createPayment" has no on-ramp. This guard makes that structural
 * rather than conventional, by failing the build on three classes of violation:
 *
 *   1. Importing an academy money / identity / entitlement module.
 *   2. Naming one of the forbidden academy functions, even indirectly.
 *   3. Reading or writing an academy money / identity table.
 *
 * Rationale: getDashboard() sums every paid payments row with no item_type
 * filter (lib/dataProvider.ts:6728), and the analytics revenue queries and
 * Telegram digests read the same source. One store row in the wrong table
 * pollutes academy revenue in surfaces nobody would think to check.
 *
 * Run: node scripts/ci/guard-store-domain-isolation.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

/** Every directory where store code is allowed to live. */
export const STORE_DIRS = [
  "lib/store",
  "app/(notes)",
  "app/api/notes",
  "app/admin/notes",
  "app/api/admin/notes",
  "components/notes",
];

/**
 * Module specifiers a store file may never import. Matched against the
 * specifier's basename chain, so "@/lib/dataProvider", "../../lib/dataProvider"
 * and "@/lib/paymentOutcome/applyVerify" are all caught.
 */
const FORBIDDEN_MODULES = [
  { pattern: /(^|\/)dataProvider$/, why: "academy data layer — owns payments, students, buyers, enrolments" },
  { pattern: /(^|\/)entitlements$/, why: "entitlement resolution — the store grants nothing" },
  { pattern: /(^|\/)paymentOutcome(\/|$)/, why: "course payment terminal writer" },
  { pattern: /(^|\/)installment[A-Za-z]*$/, why: "instalment / fee-state machinery" },
  { pattern: /(^|\/)enrollment[A-Za-z]*$/, why: "enrolment and fee-state machinery" },
];

/** Functions the store must never call, per spec §3. Caught by name. */
const FORBIDDEN_SYMBOLS = [
  "finalizeCoursePaymentByReference",
  "runPaidTerminalSideEffects",
  "confirmOnce",
  "enrollStudentInCourse",
  "ensureStudentForCustomer",
  "ensureBuyerRow",
  "enrollmentFeeStateFromEnrollment",
  "lectureAccessForCourse",
  "clearGrantOverrideOnFullyPaid",
  "gateQuiz",
  "learnerCourseIds",
  "quizUnlockCourseIds",
  "createPayment",
];

/** Academy tables the store may never touch. */
const FORBIDDEN_TABLES = [
  "payments",
  "payment_receipts",
  "students",
  "buyers",
  "course_enrollments",
  "enrollments",
  "leads",
  "course_access_overrides",
  "installment_payment_proofs",
  "access_logs",
];

/**
 * Shared infrastructure the store IS allowed to use. These are not money,
 * identity or entitlement surfaces:
 *  - app_feature_flags: the kill switch, mandated by spec §23.
 *  - analytics_events: behavioural only. Verified in Phase 0 that no revenue
 *    query sums amounts from it, and the table has no monetary column at all.
 *  - auth_attempts: the durable rate limiter backing rateLimited().
 *  - sms_*: the DLT sender's own tables, reached through lib/sms.
 */
const ALLOWED_TABLES = new Set([
  "app_feature_flags",
  "analytics_events",
  "auth_attempts",
]);

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE_RE = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
const FROM_TABLE_RE = /\.from\s*\(\s*["']([a-zA-Z0-9_]+)["']\s*\)/g;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // directory does not exist yet
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name === ".tmp") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

function lineOf(src, index) {
  return src.slice(0, index).split("\n").length;
}

/**
 * Scan one file's source. Exported so the test suite can prove the guard
 * catches a violation without needing a file on disk.
 */
export function scanSource(rel, src) {
  const violations = [];

  const specifiers = [];
  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) specifiers.push({ spec: m[1], index: m.index });
  }

  for (const { spec, index } of specifiers) {
    // Strip an extension and any query, then test the path chain.
    const clean = spec.replace(/\.(ts|tsx|js|mjs)$/, "");
    for (const { pattern, why } of FORBIDDEN_MODULES) {
      if (pattern.test(clean)) {
        violations.push({
          rel,
          line: lineOf(src, index),
          kind: "forbidden-import",
          detail: spec,
          why,
        });
      }
    }
  }

  for (const symbol of FORBIDDEN_SYMBOLS) {
    const re = new RegExp(`\\b${symbol}\\b`, "g");
    let m;
    while ((m = re.exec(src)) !== null) {
      violations.push({
        rel,
        line: lineOf(src, m.index),
        kind: "forbidden-symbol",
        detail: symbol,
        why: "spec §3 — store code never calls this",
      });
      break; // one report per symbol per file is enough
    }
  }

  FROM_TABLE_RE.lastIndex = 0;
  let t;
  while ((t = FROM_TABLE_RE.exec(src)) !== null) {
    const table = t[1];
    if (ALLOWED_TABLES.has(table)) continue;
    if (table.startsWith("store_")) continue;
    if (FORBIDDEN_TABLES.includes(table)) {
      violations.push({
        rel,
        line: lineOf(src, t.index),
        kind: "forbidden-table",
        detail: table,
        why: "academy money / identity table — the only link is phone_key, read-time",
      });
    }
  }

  return violations;
}

export function scanStoreIsolation(root = ROOT) {
  const violations = [];
  for (const dir of STORE_DIRS) {
    for (const file of walk(join(root, dir))) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (rel === "scripts/ci/guard-store-domain-isolation.mjs") continue;
      violations.push(...scanSource(rel, readFileSync(file, "utf8")));
    }
  }
  return violations;
}

function isDirectRun() {
  const invoked = process.argv[1] || "";
  return invoked.endsWith("guard-store-domain-isolation.mjs");
}

if (isDirectRun()) {
  const violations = scanStoreIsolation();
  if (violations.length) {
    console.error(
      `FAIL: Notes Store domain isolation violated (${violations.length}):\n` +
        violations
          .map((v) => `  ${v.rel}:${v.line}  [${v.kind}] ${v.detail}\n      ↳ ${v.why}`)
          .join("\n"),
    );
    console.error(
      "\nThe store is a separate money domain (docs/notes-store-spec.md §3).\n" +
        "Use the store's own data layer in lib/store/. If you believe an exception is\n" +
        "warranted, it is not — that is how the last three production bugs happened.",
    );
    process.exit(1);
  }
  console.log("OK: Notes Store imports no academy money, identity or entitlement surface");
}
