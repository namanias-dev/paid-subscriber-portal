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

/**
 * Gateways and mailers: nothing here may ever be reachable.
 *
 * Note what is NOT on this list: `lib/sms/store`. Banning everything
 * sms-shaped was the first version of this rule and it was too blunt to be
 * correct — it would forbid `addOptOut`, the SUPPRESSION writer, which
 * `markOptedOut` is obliged to call. The invariant is "cannot transmit", not
 * "cannot touch anything sms-shaped", so senders are banned BY NAME below and
 * the suppression path is asserted to be present.
 */
const SENDER_MODULES = [
  "twilio", "msg91", "gupshup", "whatsapp", "lib/sms/gateway", "sms/service",
  "nodemailer", "sendgrid", "resend", "@/lib/mailer", "lib/mailer",
];

/** The functions that actually put a message on a wire. */
const SENDER_SYMBOLS = ["sendSms", "sendBatch", "sendTemplate", "dispatchSms", "sendViaGateway"];

describe("Phase 2 guardrail — the write layer cannot send anything", () => {
  it("imports no gateway, mailer or send service", () => {
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

  it("calls no send function", () => {
    const src = read("lib/legacy-crm/writes.ts");
    for (const sym of SENDER_SYMBOLS) {
      assert.ok(
        !new RegExp(`\\b${sym}\\s*\\(`).test(src),
        `writes.ts must not call ${sym}()`,
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

/**
 * "MARK OPTED OUT" HAS TO ACTUALLY SUPPRESS.
 *
 * Every send path screens against the `sms_opt_outs` table (`optedOutSet` /
 * `isOptedOut` in `lib/sms/store`, re-checked in `sendSms`, `sendBatch` and
 * `applySuppression`). NOTHING on any send path reads `leads.consent_status`.
 *
 * The first version of `markOptedOut` set `consent_status` alone, which meant
 * the drawer, the audit trail and the counsellor all reported someone as opted
 * out while the next campaign would still have messaged them. That is the exact
 * shape of failure this phase is least allowed to have, and it is invisible
 * until a real person receives a message they refused.
 */
describe("Phase 2 guardrail — an opt-out reaches the table that is actually enforced", () => {
  const src = read("lib/legacy-crm/writes.ts");

  it("markOptedOut writes the sms_opt_outs suppression row", () => {
    assert.ok(
      /import\s*\{[^}]*\baddOptOut\b[^}]*\}\s*from\s*["'][^"']*sms\/store["']/.test(src),
      "writes.ts must import addOptOut from lib/sms/store",
    );
    assert.ok(/\baddOptOut\s*\(/.test(src), "markOptedOut must call addOptOut()");
  });

  it("refuses to report success when the suppression write fails", () => {
    // addOptOut fails closed by RETURNING false — it never throws — so an
    // unchecked call would silently degrade to the decorative behaviour above.
    const fn = src.slice(src.indexOf("export async function markOptedOut"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.ok(
      /if\s*\(!\s*suppressed\s*\)/.test(body),
      "the addOptOut return value must be checked",
    );
    assert.ok(/throw new Error/.test(body), "a failed suppression write must throw");
  });

  it("suppresses BEFORE touching the lead, so a partial failure still protects the person", () => {
    const fn = src.slice(src.indexOf("export async function markOptedOut"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    const suppressAt = body.indexOf("addOptOut(");
    const patchAt = body.indexOf("applyLeadWrite(");
    assert.ok(suppressAt !== -1 && patchAt !== -1, "both writes must be present");
    assert.ok(
      suppressAt < patchAt,
      "the compliance write must land first; the reverse order fails towards sending",
    );
  });

  it("writes a consent_status that exists in the ConsentStatus union", () => {
    const union = read("lib/types.ts");
    const declared = /export type ConsentStatus\s*=\s*([^;]+);/.exec(union)?.[1] ?? "";
    const members = [...declared.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
    assert.ok(members.length > 0, "could not parse the ConsentStatus union");

    const written = [...src.matchAll(/consent_status:\s*"([a-z_]+)"/g)].map((m) => m[1]!);
    assert.ok(written.length > 0, "expected at least one consent_status write");
    for (const v of written) {
      assert.ok(
        members.includes(v),
        `writes.ts sets consent_status="${v}", which is not in ConsentStatus ` +
          `(${members.join(" | ")}). The column has no CHECK constraint, so this ` +
          `stores silently and leaves the type lying about its own domain.`,
      );
    }
  });
});

describe("Phase 2 guardrail — every WriteAction is audited as itself", () => {
  const src = read("lib/legacy-crm/writes.ts");

  it("a contact attempt is not logged as a work-status change", () => {
    assert.ok(
      /action:\s*"contact_attempt"/.test(src),
      "recordContactAttempt must audit itself as contact_attempt",
    );
  });

  it("declares no action the API will reject", () => {
    // `reveal_phone` sat in this union with no route accepting it, which implied
    // an audit guarantee for phone reveals that did not exist.
    const union = /export type WriteAction\s*=\s*([^;]+);/.exec(src)?.[1] ?? "";
    const declared = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
    const route = read("app/api/admin/leads/[id]/worklist-action/route.ts");
    for (const action of declared) {
      if (action === "revert") continue; // handled by its own branch name
      assert.ok(
        route.includes(`"${action}"`),
        `WriteAction declares "${action}" but the route never accepts it`,
      );
    }
  });

  it("operator-only actions are reachable from NO route", () => {
    // `note_retract` deletes a note. Notes are append-only for counsellors
    // precisely because a record that can be quietly deleted from the UI stops
    // being evidence. If this ever becomes route-reachable, that guarantee is
    // gone — so the absence is asserted rather than left to reviewer memory.
    const union = /export type OperatorAction\s*=\s*([^;]+);/.exec(src)?.[1] ?? "";
    const declared = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
    assert.ok(declared.length > 0, "could not parse the OperatorAction union");

    for (const file of PHASE2_ROUTES) {
      const body = read(file);
      for (const action of declared) {
        assert.ok(
          !body.includes(`"${action}"`),
          `${file} references operator-only action "${action}" — it must not be callable over HTTP`,
        );
      }
    }
  });

  it("retracting a note records what it removed, before removing it", () => {
    const fn = src.slice(src.indexOf("export async function retractLeadNote"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    const auditAt = body.indexOf("lead_worklist_audit");
    const deleteAt = body.indexOf(".delete()");
    assert.ok(auditAt !== -1 && deleteAt !== -1, "expected both an audit insert and a delete");
    assert.ok(auditAt < deleteAt, "the audit row must be written before the note is deleted");
    assert.ok(/requires a written reason/.test(body), "a retraction must demand a reason");
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
