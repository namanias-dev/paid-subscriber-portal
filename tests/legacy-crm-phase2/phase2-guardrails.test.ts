/**
 * PHASE 2 — GUARDRAILS ON THE NEW SURFACE AREA.
 *
 * Phase 2 adds the first WRITE path over the legacy set: three API routes and a
 * write layer that can touch any of 178,183 rows. Two properties must hold, and
 * neither is visible in a screenshot:
 *
 *   1. ZERO MESSAGES. Every legacy lead has `consent_status = 'unknown'`
 *      (178,183 of 178,183 measured), so messaging any of them is a consent
 *      violation, not a bug. The write layer must have no route to a sender at
 *      all — not a disabled one, not a guarded one, none.
 *
 *   2. PERMISSION AT THE API LAYER. A disabled button is a UI courtesy; the
 *      route is the actual boundary. Every Phase 2 route must reject before it
 *      reads or writes anything.
 *
 * Both are source properties, which is why they are asserted against source
 * text: a behavioural test would need a live 179k-row Postgres plus a real
 * session to be meaningful, and would pass against any mock that happened not
 * to send. Reading the source fails the moment someone adds an import.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  WRITABLE_FIELDS,
  FROZEN_FIELDS,
  assertNoFrozenFieldWrite,
  FrozenFieldWriteError,
} from "../../lib/legacy-crm/writes";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** The routes Phase 2 introduces over the legacy set. */
const PHASE2_ROUTES = [
  "app/api/admin/leads/worklist/route.ts",
  "app/api/admin/leads/[id]/worklist-action/route.ts",
  "app/api/admin/leads/[id]/worklist-detail/route.ts",
];

/** Anything that could put a message on a wire. */
const SENDER_MODULES = [
  "lib/sms", "/sms", "twilio", "msg91", "gupshup", "whatsapp",
  "nodemailer", "sendgrid", "resend", "@/lib/mailer", "lib/mailer",
];

describe("Phase 2 guardrail — the write layer cannot send anything", () => {
  it("imports no messaging module, directly or by alias", () => {
    const src = read("lib/legacy-crm/writes.ts");
    const imports = src
      .split("\n")
      .filter((l) => /^\s*(import|export)\s.*from\s|require\(/.test(l));

    for (const banned of SENDER_MODULES) {
      const hit = imports.find((l) => l.toLowerCase().includes(banned.toLowerCase()));
      assert.equal(
        hit, undefined,
        `writes.ts must not import a sender — found: ${hit?.trim()}`,
      );
    }
  });

  it("the write action routes import no messaging module either", () => {
    for (const route of PHASE2_ROUTES) {
      const imports = read(route)
        .split("\n")
        .filter((l) => /^\s*import\s.*from\s|require\(/.test(l));
      for (const banned of SENDER_MODULES) {
        const hit = imports.find((l) => l.toLowerCase().includes(banned.toLowerCase()));
        assert.equal(hit, undefined, `${route} must not import a sender — found: ${hit?.trim()}`);
      }
    }
  });
});

describe("Phase 2 guardrail — permission is enforced at the API layer", () => {
  for (const route of PHASE2_ROUTES) {
    it(`${route} rejects without the manage_students_leads permission`, () => {
      const src = read(route);
      assert.ok(
        src.includes('requirePermission("manage_students_leads")'),
        "route must gate on the same permission as the existing Lead CRM",
      );
      assert.ok(src.includes("401"), "route must answer 401 when the gate fails");
    });

    it(`${route} checks the gate before it touches data`, () => {
      // Import lines name these helpers before any of them run, so compare
      // positions from the first route handler onward — otherwise every route
      // looks like a violation purely because of its import order.
      const src = read(route);
      const handler = src.search(/export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)\b/);
      assert.notEqual(handler, -1, `no exported route handler found in ${route}`);
      const body = src.slice(handler);

      const gate = body.indexOf("requirePermission(");
      assert.notEqual(gate, -1, `no requirePermission call found in the body of ${route}`);

      // Any data access must come after the gate, or the gate is decorative.
      for (const access of ["getLeadsPaged(", "getSupabaseAdmin(", "applyLeadWrite("]) {
        const at = body.indexOf(access);
        if (at === -1) continue;
        assert.ok(
          gate < at,
          `${access.slice(0, -1)} runs before the permission check in ${route}`,
        );
      }
    });
  }
});

describe("Phase 2 guardrail — frozen provenance can never be written", () => {
  it("the writable allow-list and the frozen deny-list are disjoint", () => {
    const writable = new Set<string>(WRITABLE_FIELDS as readonly string[]);
    const overlap = (FROZEN_FIELDS as readonly string[]).filter((f) => writable.has(f));
    assert.deepEqual(
      overlap, [],
      "a field cannot be both writable and frozen — provenance would be silently editable",
    );
  });

  it("the fields the team's trust depends on are all frozen", () => {
    const frozen = new Set<string>(FROZEN_FIELDS as readonly string[]);
    // `legacy_call_status_raw` is the team's own wording from their sheet and is
    // the reason they believe the migration. `phone` is the dedupe key against
    // future imports. `is_legacy`/`cohort` define the partition every protected
    // consumer filters on.
    for (const field of [
      "legacy_call_status_raw", "phone", "is_legacy", "cohort",
      "created_at", "first_seen_at", "import_batch", "attribution", "status",
    ]) {
      assert.ok(frozen.has(field), `${field} must be frozen against writes`);
    }
  });

  /**
   * `trg_leads_sync_legacy_columns` is BEFORE INSERT OR UPDATE **OF attribution**
   * and unconditionally re-derives `is_legacy` from the blob. Measured: even a
   * no-op `SET attribution = attribution` flips it, because a column-scoped
   * trigger fires on presence in the SET list, not on a value change.
   *
   * Phase 2 is safe only because `attribution` can never enter a patch, so the
   * column never appears in the emitted SET list. That is the whole argument,
   * and this is the test that keeps it true.
   * Full contract: supabase/qa/phase2-legacy-trigger-contract.sql
   */
  it("a patch touching `attribution` is rejected, so the legacy trigger never fires", () => {
    assert.throws(
      () => assertNoFrozenFieldWrite({ attribution: { legacy: "true" } }),
      FrozenFieldWriteError,
      "writing attribution would re-derive is_legacy and could silently change a lead's scope",
    );
  });

  it("a patch mixing one legal field with `attribution` is rejected whole", () => {
    assert.throws(
      () => assertNoFrozenFieldWrite({ work_status: "contacted", attribution: {} }),
      FrozenFieldWriteError,
      "a frozen field smuggled alongside a legal one must fail the entire write",
    );
  });

  it("an unknown field is refused rather than passed through", () => {
    assert.throws(
      () => assertNoFrozenFieldWrite({ some_new_column: "x" }),
      "fields must be added to WRITABLE_FIELDS deliberately, never by accident",
    );
  });
});

/**
 * THE NULL TRAP.
 *
 * `is_legacy IS DISTINCT FROM ((attribution->>'legacy') = 'true')` looks like a
 * correct two-directional reconciliation and is not. When the `legacy` key is
 * absent the right-hand side is NULL, and `false IS DISTINCT FROM NULL` is
 * TRUE, so every ordinary live lead is reported as a mismatch. Measured against
 * production: the naive form reports 1,350 false alarms (exactly the non-legacy
 * rows with no `legacy` key — 178,183 + 1,350 = 179,533 = every row in the
 * table) where the correct form reports 0.
 *
 * If that can bite someone writing a one-off verification query, it can bite
 * someone writing a filter. The durable fix is to read `is_legacy` — a NOT NULL
 * boolean — and never re-derive legacy membership from the JSONB.
 */
describe("Phase 2 guardrail — legacy membership is read from is_legacy, never re-derived", () => {
  const SOURCES = [
    "lib/dataProvider.ts",
    "lib/legacy-crm/writes.ts",
    "app/api/admin/leads/worklist/route.ts",
    "supabase/migrations/2026-07-25-leads-paged-rpc-phase2.sql",
  ];

  it("no shipped source re-derives the flag with the NULL-trap comparison", () => {
    for (const file of SOURCES) {
      const src = read(file);
      assert.ok(
        !/is_legacy\s+is\s+distinct\s+from/i.test(src),
        `${file} uses the NULL-trap reconciliation form; compare each direction explicitly instead`,
      );
    }
  });

  it("the RPC's scope arms are expressed on the boolean column alone", () => {
    const sql = read("supabase/migrations/2026-07-25-leads-paged-rpc-phase2.sql");
    assert.ok(sql.includes("and l.is_legacy"), "legacy arm must filter on the column");
    assert.ok(sql.includes("and not l.is_legacy"), "live arm must filter on the column");
    assert.ok(
      !/attribution\s*->>\s*'legacy'/.test(sql),
      "the RPC must never reach into the JSONB to decide scope",
    );
  });
});
