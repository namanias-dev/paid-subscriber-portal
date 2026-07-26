/**
 * Regression guard for the 2026-07-25 seed-fixture removal.
 *
 * Five demo leads (`lead-0001`..`lead-0005`, "Aspirant One".."Five", phones
 * 9000010001-0005) were defined in `supabase/seed.sql`. DEPLOY.md step 2 told
 * operators to run that file against the live database, so the fixtures were
 * inserted into the production CRM and counted as real prospects for five
 * weeks: by the time they were found, four of the five live leads with any
 * funnel progress were fake, including the only recorded admission.
 *
 * They have been deleted from production (batch
 * `seed-fixture-removal-2026-07-25`). Deleting the rows is only half a fix.
 * The seed block used `on conflict (id) do nothing`, which suppresses
 * duplicates but does nothing once a row is absent — so the next run of the
 * file would silently reinstate all five. These tests pin the other half: the
 * rows are gone from the file, and the docs no longer instruct anyone to run
 * the fixture blocks against production.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..", "..");
const SEED = readFileSync(join(REPO, "supabase", "seed.sql"), "utf8");

/** The exact fixtures removed from production. */
const FIXTURE_IDS = ["lead-0001", "lead-0002", "lead-0003", "lead-0004", "lead-0005"];
const FIXTURE_PHONES = ["9000010001", "9000010002", "9000010003", "9000010004", "9000010005"];
const FIXTURE_NAMES = ["Aspirant One", "Aspirant Two", "Aspirant Three", "Aspirant Four", "Aspirant Five"];

describe("supabase/seed.sql cannot reintroduce the deleted lead fixtures", () => {
  test("does not insert into public.leads at all", () => {
    const m = SEED.match(/insert\s+into\s+public\.leads/gi);
    assert.equal(
      m,
      null,
      "seed.sql inserts into public.leads again. `leads` is the live sales pipeline: " +
        "anything seeded here is reported to the academy as a real prospect. Demo mode " +
        "serves leads from lib/mockData.ts and never touches Supabase, so there is no " +
        "reason to seed this table.",
    );
  });

  test("contains none of the five fixture ids", () => {
    for (const id of FIXTURE_IDS) {
      assert.ok(
        !SEED.includes(id),
        `seed.sql mentions "${id}", one of the five fixtures deleted from production ` +
          `on 2026-07-25. Re-adding it will put it back in the live CRM.`,
      );
    }
  });

  test("contains none of the five fixture phone numbers", () => {
    // Checked separately from the ids: re-adding the same person under a new
    // id would recreate the same phantom prospect and defeat an id-only guard.
    for (const phone of FIXTURE_PHONES) {
      assert.ok(
        !SEED.includes(phone),
        `seed.sql mentions the fixture phone ${phone}. These five numbers are not real ` +
          `contacts and must not exist in any seeded row.`,
      );
    }
  });

  test("contains none of the five fixture names", () => {
    for (const name of FIXTURE_NAMES) {
      assert.ok(
        !SEED.includes(name),
        `seed.sql mentions "${name}", a deleted lead fixture.`,
      );
    }
  });

  test("still carries the bootstrap blocks a live deployment needs", () => {
    // The counterweight to the tests above. The fix for the fixture leak must
    // not be "stop seeding anything" — `admin_users` is the only way to log in
    // to a fresh deployment, and courses/plans are the real catalogue. If this
    // fails, someone has over-corrected and broken first-time setup.
    for (const table of ["admin_users", "courses", "plans"]) {
      assert.match(
        SEED,
        new RegExp(`insert\\s+into\\s+public\\.${table}\\b`, "i"),
        `seed.sql no longer seeds public.${table}, which a fresh production deployment ` +
          `needs in order to be usable.`,
      );
    }
  });
});

describe("zero-count statuses still appear in every status surface", () => {
  // Deleting the fixtures took `Demo Booked` to zero rows table-wide and
  // `Admission Done` to zero LIVE rows. Any surface that builds its status list
  // by scanning the current rows now silently drops them, so a counsellor
  // cannot file a demo booking and the stage vanishes from the segment builder.
  // That regression already happened once, in the SMS meta route, which
  // derived its stage list from `new Set(leads.map(l => l.status))`. These
  // tests pin the fix at the two surfaces where the data was the source.
  const read = (p: string) => readFileSync(join(REPO, p), "utf8");

  test("the SMS meta route serves the vocabulary, not the observed values", () => {
    const src = read("app/api/admin/sms/meta/route.ts");
    assert.match(
      src,
      /const\s+leadStages\s*=\s*LEAD_STATUSES\b/,
      "app/api/admin/sms/meta/route.ts must serve leadStages straight from LEAD_STATUSES.",
    );
    assert.ok(
      !/leadStages[\s\S]{0,200}?leads\.map\(\s*\(?\s*l\s*\)?\s*=>\s*l\.status/.test(src),
      "leadStages is being derived from the lead rows again. Statuses with no rows " +
        "today — currently Demo Booked, and Admission Done in the live cohort — would " +
        "disappear from the segment builder while remaining valid values.",
    );
  });

  test("the Kanban renders a column per canonical value", () => {
    const src = read("app/admin/leads/page.tsx");
    assert.match(
      src,
      /const\s+STAGES\s*:\s*readonly\s+LeadStatus\[\]\s*=\s*LEAD_STATUSES\b/,
      "The Kanban's STAGES must come from LEAD_STATUSES so an empty stage still renders " +
        "as a drop target. Deriving columns from the rows present would remove the " +
        "Demo Booked column entirely, making the stage unreachable through the UI.",
    );
  });
});

describe("the deployment docs no longer route fixtures into production", () => {
  test("DEPLOY.md does not tell operators to run the whole seed file", () => {
    const deploy = readFileSync(join(REPO, "DEPLOY.md"), "utf8");
    const live = deploy.slice(deploy.indexOf("## 2. Set up the database"));
    assert.ok(
      /only the bootstrap blocks/i.test(live),
      "DEPLOY.md's live-database step must tell operators to run only the bootstrap " +
        "blocks of seed.sql. Instructing them to run the whole file is the mechanism " +
        "that put demo rows into the production database.",
    );
  });

  test("seed.sql itself names which blocks are unsafe in production", () => {
    const header = SEED.slice(0, SEED.indexOf("insert into"));
    assert.ok(
      /must NEVER reach production/i.test(header),
      "seed.sql's header must state plainly which of its blocks are demo fixtures. " +
        "It previously claimed only that the file was 'safe to re-run', which reads as " +
        "a safety guarantee and is not one.",
    );
  });
});
