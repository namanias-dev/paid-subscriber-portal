/**
 * PHASE 2 — THE LEGACY LEAK GUARD.
 *
 * Phase 2 makes legacy leads first-class in the Lead CRM by replacing implicit
 * hiding with an explicit scope control. That is the right product direction
 * and it is also the single most dangerous change in this program, because the
 * `includeLegacy` default is currently the only thing keeping 178,183 legacy
 * leads out of:
 *
 *     Payments  ·  Analytics  ·  SMS audiences  ·  Dashboards
 *
 * A leak into Analytics silently corrupts published revenue attribution. A leak
 * into SMS audiences sends real messages to 178k people who never consented —
 * `consent_status = 'unknown'` for 100% of them (178,183/178,183 measured).
 *
 * THE FAILURE MODE THIS FILE EXISTS TO PREVENT
 * --------------------------------------------
 * Before Phase 2, two protected consumers reached the legacy-free universe by
 * calling a BARE `getLeads()` and inheriting `includeLegacy: false` from a
 * default declared in `lib/dataProvider.ts`:
 *
 *     app/api/admin/sms/meta/route.ts   — SMS send dropdowns
 *     lib/dataProvider.ts::getDashboard — every headline metric
 *
 * Nothing about those call sites said "legacy must not be here". A single edit
 * to the default — exactly the kind of edit a legacy-scope feature invites —
 * would have leaked 178k rows into both, with no test failing. The exclusion is
 * now spelled at each call site, and this file is the thing that keeps it
 * spelled.
 *
 * WHY THIS IS A SOURCE-TEXT TEST
 * ------------------------------
 * A behavioural test would need a live 179k-row Postgres to be meaningful, and
 * would pass against a mocked provider that happened to return no legacy rows.
 * The invariant being protected is a PROPERTY OF THE SOURCE: "this call site
 * states its legacy scope explicitly." Reading the source is the direct,
 * non-flaky way to assert exactly that, and it fails loudly the moment someone
 * reintroduces a bare call.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");

function source(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

/**
 * Strip line- and block-comments so the big explanatory docblocks in this
 * codebase (which legitimately quote `getLeads()` in prose) cannot satisfy or
 * trip an assertion. Only executable text is inspected.
 */
function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Every consumer that must NEVER see a legacy lead, and the reader it uses.
 *
 * `getLeadsForPillMap()` is deliberately absent from the "must be explicit"
 * check: it takes no options at all. Its legacy scope is baked into its body
 * and covered by `payment-source-restore` tests, so there is no default for a
 * caller to accidentally inherit.
 */
const PROTECTED_CONSUMERS: Array<{
  file: string;
  reader: "getLeads" | "getAllLeadsRaw";
  why: string;
}> = [
  {
    file: "app/api/admin/sms/meta/route.ts",
    reader: "getLeads",
    why: "SMS send dropdowns — a leak here puts legacy sources in front of a bulk send",
  },
  {
    file: "lib/dataProvider.ts",
    reader: "getLeads",
    why: "getDashboard() — a leak here inflates every headline metric by ~180x",
  },
  {
    file: "lib/sms/audiences.ts",
    reader: "getLeads",
    why: "bulk SMS audiences — a leak here messages 178k non-consented people",
  },
  {
    file: "app/api/admin/analytics/lead-campaigns/route.ts",
    reader: "getAllLeadsRaw",
    why: "campaign ROI math — a leak here corrupts published attribution",
  },
];

describe("PHASE 2 GUARD — protected consumers exclude legacy EXPLICITLY", () => {
  for (const { file, reader, why } of PROTECTED_CONSUMERS) {
    it(`${file} never calls ${reader}() bare — ${why}`, () => {
      const text = code(file);

      // A bare call is `getLeads()` with nothing between the parens. That is
      // the exact shape that silently inherits the default.
      const bare = new RegExp(`\\b${reader}\\s*\\(\\s*\\)`, "g");
      const hits = text.match(bare) ?? [];

      assert.equal(
        hits.length,
        0,
        `${file} contains ${hits.length} bare \`${reader}()\` call(s). This is a ` +
          `PROTECTED consumer: ${why}. Spell the scope explicitly as ` +
          `\`${reader}({ includeLegacy: false })\` so the exclusion is visible ` +
          `at the call site and cannot be changed by editing a default elsewhere.`,
      );
    });

    it(`${file} states includeLegacy: false at least once`, () => {
      const text = code(file);
      assert.ok(
        /includeLegacy\s*:\s*false/.test(text),
        `${file} must contain an explicit \`includeLegacy: false\`. ${why}.`,
      );
    });
  }

  it("no protected consumer ever opts INTO legacy", () => {
    for (const { file, why } of PROTECTED_CONSUMERS) {
      const text = code(file);
      // `includeLegacy: true` / `"only"` must never appear in a protected file.
      // getDashboard lives in dataProvider.ts alongside the CRM readers, which
      // legitimately accept the flag as a PARAMETER — so we only forbid the
      // literal opt-in, not the identifier.
      const optIn = /includeLegacy\s*:\s*(true|["']only["'])/.exec(text);
      assert.equal(
        optIn,
        null,
        `${file} opts into legacy via \`${optIn?.[0]}\`. ${why}. ` +
          `Legacy rows are scoped to the Lead CRM only — never to this surface.`,
      );
    }
  });
});

describe("PHASE 2 GUARD — the CRM scope control is the ONLY legacy entry point", () => {
  it("getLeadsPaged is the only reader exposing an 'only' legacy mode", () => {
    const provider = code("lib/dataProvider.ts");
    // The tri-state ('exclude' | 'include' | 'only') belongs to the paged
    // worklist reader. If another reader grows one, it needs its own audit.
    const occurrences = provider.match(/_legacyModeFor\s*\(/g) ?? [];
    assert.ok(
      occurrences.length >= 1,
      "expected the paged reader to map its legacy tri-state through _legacyModeFor",
    );
  });

  it("the JSONB NULL trap is not reintroduced in any new source", () => {
    // `(attribution->>'legacy') = 'true'` is three-valued: rows lacking the key
    // satisfy NEITHER `= 'true'` NOR `<> 'true'`, so bucketing with it silently
    // loses rows. `is_legacy boolean NOT NULL` replaced it. Two published
    // numbers in this program were wrong for exactly this reason.
    const files = [
      "lib/dataProvider.ts",
      "app/api/admin/sms/meta/route.ts",
      "lib/sms/audiences.ts",
      "app/api/admin/analytics/lead-campaigns/route.ts",
    ];
    for (const f of files) {
      const text = code(f);
      const trap = /attribution\s*->>\s*'legacy'\s*(=|<>|!=)\s*'true'/.exec(text);
      assert.equal(
        trap,
        null,
        `${f} reintroduces the JSONB NULL trap via \`${trap?.[0]}\`. Use the ` +
          `promoted \`is_legacy boolean NOT NULL\` column instead — it is a ` +
          `total, exact, two-valued partition.`,
      );
    }
  });
});
