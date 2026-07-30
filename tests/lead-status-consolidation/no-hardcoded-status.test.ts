/**
 * THE REGRESSION GUARD FOR THE STATUS CONSOLIDATION.
 *
 * This consolidation replaced five divergent status vocabularies. Nothing
 * stopped them diverging the first time, so nothing would stop a sixth
 * appearing — a hard-coded `"Interested"` in a new filter, a `"New"` default in
 * a new capture route — and the whole point of `lib/leadStatus.ts` would erode
 * one literal at a time.
 *
 * This file fails the build if:
 *   1. any status string literal appears in application code outside the
 *      source of truth,
 *   2. any RETIRED value (`New`, `Admitted`, `Lost`, `Contacted`,
 *      `Negotiation`, `Paid Rs. 50`) appears anywhere it could be written or
 *      rendered,
 *   3. the `.mjs` ops-script mirror of the merge-rank table drifts from the
 *      canonical one,
 *   4. the vocabulary, its ordering, or its colour mapping is internally
 *      inconsistent.
 */

import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

import {
  LEAD_STATUSES,
  LEAD_STATUS_META,
  LEAD_STATUS_MERGE_RANK,
  RETIRED_LEAD_STATUS_MAP,
  RETIRED_LEAD_STATUSES,
  DEFAULT_LEAD_STATUS,
  PROMOTED_LEAD_STATUS,
  isLeadStatus,
  leadStatusFlags,
  leadStatusLabel,
  leadStatusOrder,
  leadStatusPill,
  normalizeLeadStatus,
  type LeadStatus,
} from "../../lib/leadStatus";

const REPO = join(__dirname, "..", "..");

/** The one file allowed to spell status values. */
const SOURCE_OF_TRUTH = "lib/leadStatus.ts";

/**
 * Files that legitimately contain status literals, each for a stated reason.
 * Adding to this list should feel like a decision, not a convenience.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  [SOURCE_OF_TRUTH]: "the source of truth itself",
  "lib/leadBehaviourStatus.ts": "behaviour engine; ladder/negative literals are LeadStatus via satisfies / typed arrays",
  "scripts/dedupe-leads.mjs": "bare-node ops script; cannot import TS. Pinned key-for-key below.",
  "supabase/seed.sql": "local fixture data; asserted canonical below.",
  "supabase/schema.sql": "table DDL default + CHECK vocabulary.",
  "supabase/migrations/2026-07-25-lead-status-consolidation.sql": "the migration that performs the rename.",
  "supabase/migrations/2026-07-30-lead-behaviour-status.sql": "extends vocabulary with Webinar Registered + Seat Booked.",
};

/** Directories that are not application code. */
const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", "docs", "tests", "public", ".vercel", "coverage",
]);

const CODE_EXT = new Set([".ts", ".tsx", ".mjs", ".js", ".jsx", ".sql"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE_EXT.has(extname(entry))) out.push(full);
  }
  return out;
}

/**
 * Strip comments and JSX text so prose may discuss a status without tripping
 * the guard. We only care about VALUES the program can act on: string literals
 * in real code. Documentation explaining why `New` became `Not Called` is not a
 * regression — silently reintroducing `status: "New"` is.
 */
function stripNonCode(src: string, ext: string): string {
  if (ext === ".sql") {
    return src.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  }
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments (incl. JSDoc)
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments, sparing "https://"
}

/** Every string literal on one line, for both JS/TS and SQL quoting. */
function stringLiterals(line: string, isSql: boolean): string[] {
  const out: string[] = [];
  const re = isSql ? /'((?:[^']|'')*)'/g : /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(isSql ? m[1] : m[2]);
  return out;
}

/**
 * Is this line handling a LEAD PIPELINE STATUS, as opposed to one of the many
 * other things in this codebase that are also called "status"?
 *
 * This matters more than it sounds. `Interested` is a value in BOTH the lead
 * status vocabulary AND the `temperature` vocabulary
 * ("Interested" | "Warm" | "Cold" | "Junk"), which is a genuinely separate
 * field on the same table. A blunt string search flags every temperature pill
 * in the CRM. Likewise `Admitted` is a referrals-table column header and
 * `Contacted` is the label on a yes/no "has been contacted" filter — neither is
 * a pipeline status.
 */
const OTHER_STATUS_FIELDS =
  /temperature|work_status|consent_status|dnd_status|upload_status|verify_status|settlement_status|registration_status|payout_status|payment_status|template.?status|log.?status|access.?status|enrollment.?status|receipt\.status|seat_booked|Fully Paid|Partially Paid/i;

function isStatusContext(line: string): boolean {
  if (OTHER_STATUS_FIELDS.test(line)) return false;
  return /\bstatus\b|\bstage\b|STAGES|LeadStatus/i.test(line);
}

const CODE_FILES = walk(REPO).map((f) => relative(REPO, f).split("\\").join("/"));

interface Offender { file: string; line: number; literal: string }

/** Scan every non-allowlisted code file for status literals in status context. */
function scanForLiterals(match: (literal: string) => boolean): Offender[] {
  const offenders: Offender[] = [];
  for (const file of CODE_FILES) {
    if (ALLOWED[file]) continue;
    const ext = extname(file);
    const isSql = ext === ".sql";
    const lines = stripNonCode(readFileSync(join(REPO, file), "utf8"), ext).split("\n");
    lines.forEach((line, i) => {
      if (!isStatusContext(line)) return;
      for (const lit of stringLiterals(line, isSql)) {
        if (match(lit)) offenders.push({ file, line: i + 1, literal: lit });
      }
    });
  }
  return offenders;
}

const fmt = (o: Offender[]) => o.map((x) => `${x.file}:${x.line} -> "${x.literal}"`);

// ===========================================================================

describe("lead status — the vocabulary itself", () => {
  test("has exactly 15 values", () => {
    assert.equal(LEAD_STATUSES.length, 15);
    assert.equal(LEAD_STATUS_META.length, 15);
  });

  test("values are unique", () => {
    assert.equal(new Set(LEAD_STATUSES).size, LEAD_STATUSES.length);
  });

  test("sort order is 1..15 with no gaps, matching array position", () => {
    LEAD_STATUS_META.forEach((m, i) => {
      assert.equal(m.order, i + 1, `${m.value} declares order ${m.order} but sits at index ${i}`);
    });
  });

  test("the approved sort order is exact — cold -> warm -> converted -> dead", () => {
    assert.deepEqual([...LEAD_STATUSES], [
      "Not Called",
      "Not Replied",
      "Call Back",
      "Interested",
      "High Potential Lead",
      "Wants Free Seminar",
      "Walk In",
      "Demo Booked",
      "Demo Attended",
      "Webinar Registered",
      "Seat Booked",
      "Admission Done",
      "Repeat",
      "Not Interested",
      "Wrong No.",
    ]);
  });

  test("every value has a label, a pill and a description", () => {
    for (const m of LEAD_STATUS_META) {
      assert.ok(m.label.length > 0, `${m.value} has no label`);
      assert.ok(m.pill.startsWith("pill-"), `${m.value} pill "${m.pill}" is not a design-system class`);
      assert.ok(m.description.length > 10, `${m.value} has no usable description`);
    }
  });

  test("every value has a merge rank, and ranks are unique", () => {
    const ranks = LEAD_STATUSES.map((s) => {
      const r = LEAD_STATUS_MERGE_RANK[s];
      assert.equal(typeof r, "number", `${s} has no merge rank`);
      return r;
    });
    assert.equal(new Set(ranks).size, ranks.length, "merge ranks must be unique or a merge is a coin flip");
  });

  test("Not Interested keeps the negative merge rank the retired Lost had", () => {
    // Pre-consolidation `STATUS_RANK` put `Lost` at -1 so it always lost a
    // merge. `Lost` now maps to `Not Interested`; if that inherited a positive
    // rank, dedupe would start preferring dead leads over live ones.
    assert.ok(LEAD_STATUS_MERGE_RANK["Not Interested"] < 0);
    assert.ok(LEAD_STATUS_MERGE_RANK["Wrong No."] < LEAD_STATUS_MERGE_RANK["Not Interested"]);
    assert.ok(LEAD_STATUS_MERGE_RANK["Admission Done"] === Math.max(...Object.values(LEAD_STATUS_MERGE_RANK)));
  });

  test("defaults are canonical", () => {
    assert.ok(isLeadStatus(DEFAULT_LEAD_STATUS));
    assert.ok(isLeadStatus(PROMOTED_LEAD_STATUS));
    assert.equal(DEFAULT_LEAD_STATUS, "Not Called");
    assert.equal(PROMOTED_LEAD_STATUS, "Not Called");
  });
});

describe("lead status — retired values", () => {
  test("the retired map covers every pre-consolidation value and targets canonical ones", () => {
    assert.deepEqual(
      [...RETIRED_LEAD_STATUSES].sort(),
      ["Admitted", "Contacted", "Lost", "Negotiation", "New", "Paid Rs. 50"],
    );
    for (const [from, to] of Object.entries(RETIRED_LEAD_STATUS_MAP)) {
      assert.ok(isLeadStatus(to), `${from} maps to "${to}", which is not canonical`);
      assert.ok(!isLeadStatus(from), `${from} is both retired and canonical`);
    }
  });

  test("the approved mapping is exact", () => {
    assert.equal(RETIRED_LEAD_STATUS_MAP["New"], "Not Called");
    assert.equal(RETIRED_LEAD_STATUS_MAP["Admitted"], "Admission Done");
    assert.equal(RETIRED_LEAD_STATUS_MAP["Lost"], "Not Interested");
    assert.equal(RETIRED_LEAD_STATUS_MAP["Contacted"], "Interested");
    assert.equal(RETIRED_LEAD_STATUS_MAP["Paid Rs. 50"], "High Potential Lead");
    assert.equal(RETIRED_LEAD_STATUS_MAP["Negotiation"], "Interested");
  });

  test("normalizeLeadStatus resolves retired values and passes canonical ones through", () => {
    for (const s of LEAD_STATUSES) assert.equal(normalizeLeadStatus(s), s);
    for (const [from, to] of Object.entries(RETIRED_LEAD_STATUS_MAP)) {
      assert.equal(normalizeLeadStatus(from), to);
    }
    assert.equal(normalizeLeadStatus(null), null);
    assert.equal(normalizeLeadStatus(undefined), null);
    assert.equal(normalizeLeadStatus("Nonsense"), null);
  });

  test("normalizeLeadStatus is idempotent", () => {
    for (const s of [...LEAD_STATUSES, ...RETIRED_LEAD_STATUSES]) {
      const once = normalizeLeadStatus(s);
      assert.equal(normalizeLeadStatus(once), once, `normalizing "${s}" twice is not stable`);
    }
  });
});

describe("lead status — lookups degrade safely", () => {
  test("unknown values render visibly rather than blank", () => {
    assert.equal(leadStatusLabel("Nonsense"), "Nonsense");
    assert.equal(leadStatusLabel(null), "—");
    assert.equal(leadStatusPill("Nonsense"), "pill-gray");
  });

  test("unknown values sort last, so they cannot displace Not Called", () => {
    assert.ok(leadStatusOrder("Nonsense") > leadStatusOrder("Wrong No."));
    assert.equal(leadStatusOrder("Not Called"), 1);
  });
});

describe("lead status — derived boolean columns", () => {
  test("Admission Done implies admitted, webinar, and the whole demo chain", () => {
    const f = leadStatusFlags("Admission Done");
    assert.deepEqual(f, { demo_booked: true, demo_attended: true, admitted: true, webinar_registered: true });
  });

  test("the retired 'Admitted' string still derives admitted", () => {
    // This is the exact silent breakage the rename threatened: the CRM used to
    // set `admitted` from `status === "Admitted"`.
    assert.equal(leadStatusFlags("Admitted").admitted, true);
  });

  test("Demo Attended implies Demo Booked but not admitted or webinar", () => {
    assert.deepEqual(leadStatusFlags("Demo Attended"), {
      demo_booked: true,
      demo_attended: true,
      admitted: false,
      webinar_registered: false,
    });
  });

  test("Seat Booked implies webinar + demo chain but not admitted", () => {
    assert.deepEqual(leadStatusFlags("Seat Booked"), {
      demo_booked: true,
      demo_attended: true,
      admitted: false,
      webinar_registered: true,
    });
  });

  test("Webinar Registered implies webinar only", () => {
    assert.deepEqual(leadStatusFlags("Webinar Registered"), {
      demo_booked: false,
      demo_attended: false,
      admitted: false,
      webinar_registered: true,
    });
  });

  test("cold statuses derive nothing", () => {
    for (const s of ["Not Called", "Not Replied", "Call Back", "Wrong No."] as LeadStatus[]) {
      assert.deepEqual(
        leadStatusFlags(s),
        { demo_booked: false, demo_attended: false, admitted: false, webinar_registered: false },
        s,
      );
    }
  });
});

// ===========================================================================
// THE ACTUAL GUARD
// ===========================================================================

describe("no hard-coded status strings outside the source of truth", () => {
  test("no canonical status value is written as a literal in application code", () => {
    const canonical = new Set<string>(LEAD_STATUSES);
    const offenders = fmt(scanForLiterals((lit) => canonical.has(lit)));

    assert.deepEqual(
      offenders,
      [],
      "Status values must come from lib/leadStatus.ts, never a literal. " +
        "Import LEAD_STATUSES / LEAD_STATUS_META / DEFAULT_LEAD_STATUS instead.\n" +
        offenders.join("\n"),
    );
  });

  test("no RETIRED status value appears in application code at all", () => {
    const retired = new Set(RETIRED_LEAD_STATUSES);
    const offenders = fmt(scanForLiterals((lit) => retired.has(lit)));

    assert.deepEqual(
      offenders,
      [],
      "Retired status values (New, Admitted, Lost, Contacted, Negotiation, Paid Rs. 50) " +
        "must not appear in code — they no longer exist in the database and the CHECK " +
        "constraint rejects them.\n" + offenders.join("\n"),
    );
  });

  test("the guard itself works — it catches a planted literal", () => {
    // A guard nobody has seen fail is a guard nobody knows is wired up. This
    // pins the two things it depends on: literal extraction, and the
    // status-context filter that stops `temperature: "Interested"` tripping it.
    assert.deepEqual(stringLiterals(`  status: "Not Called",`, false), ["Not Called"]);
    assert.equal(isStatusContext(`  status: "Not Called",`), true);
    assert.equal(isStatusContext(`  temperature: input.temperature || "Interested",`), false);
    assert.equal(isStatusContext(`  <Field label="Contacted" htmlFor="f-contacted">`), false);
    assert.equal(isStatusContext(`  if (!LEAD_WORK_STATUSES.includes(work_status))`), false);
  });

  test("the dedupe ops-script mirror matches the canonical merge rank exactly", () => {
    const src = readFileSync(join(REPO, "scripts", "dedupe-leads.mjs"), "utf8");
    const block = src.match(/const STATUS_RANK = \{([\s\S]*?)\n\};/);
    assert.ok(block, "STATUS_RANK literal not found in scripts/dedupe-leads.mjs");

    const mirrored: Record<string, number> = {};
    for (const m of block[1].matchAll(/"([^"]+)":\s*(-?\d+)/g)) mirrored[m[1]] = Number(m[2]);

    assert.deepEqual(
      mirrored,
      { ...LEAD_STATUS_MERGE_RANK },
      "scripts/dedupe-leads.mjs STATUS_RANK has drifted from LEAD_STATUS_MERGE_RANK. " +
        "The script is bare-node and cannot import the TS source, so the two are kept in sync by this test. Edit both.",
    );

    const dflt = src.match(/const DEFAULT_STATUS = "([^"]+)"/);
    assert.ok(dflt, "DEFAULT_STATUS not found in scripts/dedupe-leads.mjs");
    assert.equal(dflt[1], DEFAULT_LEAD_STATUS, "dedupe-leads.mjs DEFAULT_STATUS has drifted");
  });

  test("the DB CHECK constraint in the behaviour-status migration lists exactly the 15 values", () => {
    const sql = readFileSync(
      join(REPO, "supabase", "migrations", "2026-07-30-lead-behaviour-status.sql"),
      "utf8",
    );
    const check = sql.match(/add constraint leads_status_vocab check \(([\s\S]*?)\) not valid;/);
    assert.ok(check, "leads_status_vocab CHECK not found in 2026-07-30-lead-behaviour-status.sql");
    const listed = [...check[1].matchAll(/'((?:[^']|'')*)'::text/g)].map((m) => m[1]);
    assert.deepEqual(
      listed,
      [...LEAD_STATUSES],
      "the CHECK constraint vocabulary must match LEAD_STATUSES exactly, in order",
    );
  });

  test("schema.sql leads.status default matches DEFAULT_LEAD_STATUS", () => {
    const sql = readFileSync(join(REPO, "supabase", "schema.sql"), "utf8");
    // Scoped to the leads CREATE TABLE. Several other tables have a `status`
    // column with its own default ('draft', 'active'); an unscoped regex
    // matches whichever appears first in the file.
    const table = sql.match(/create table if not exists public\.leads \(([\s\S]*?)\n\);/);
    assert.ok(table, "public.leads CREATE TABLE not found in schema.sql");
    const m = table[1].match(/^\s*status text default '([^']+)'/m);
    assert.ok(m, "leads.status default not found");
    assert.equal(m[1], DEFAULT_LEAD_STATUS);
  });

  // This used to assert the leads seed block spelled canonical statuses. The
  // block itself is now gone — seeding `public.leads` at all is the defect, not
  // the vocabulary it used — so the canonicity check has nothing to inspect and
  // the real invariant is the absence. Enforced by
  // `tests/seed-fixture-removal/seed-has-no-lead-fixtures.test.ts`.
  test("seed.sql seeds no leads at all, canonical or otherwise", () => {
    const sql = readFileSync(join(REPO, "supabase", "seed.sql"), "utf8");
    assert.equal(
      sql.match(/insert\s+into\s+public\.leads/i),
      null,
      "supabase/seed.sql inserts into public.leads again. DEPLOY.md tells operators to run " +
        "this file against the live database, so any row here lands in the production CRM " +
        "and is counted as a real prospect.",
    );
  });
});

describe("the two vocabularies stay separate", () => {
  test("LeadStatus and LeadWorkStatus share no value", async () => {
    const { LEAD_WORK_STATUSES } = await import("../../lib/types");
    const pipeline = new Set<string>(LEAD_STATUSES);
    for (const w of LEAD_WORK_STATUSES) {
      assert.ok(
        !pipeline.has(w),
        `"${w}" is in both vocabularies. They are different axes — the counsellor's ` +
          `mutable working state vs the pipeline disposition of record — and must not converge.`,
      );
    }
  });
});
