/**
 * PHASE 3 guardrails.
 *
 * Bulk assignment is the first thing in this program that can change thousands
 * of rows from one click, so the limits on what it can reach matter more than
 * the feature itself. These are source-text assertions: they hold even for code
 * paths no test happens to execute.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BULK_ASSIGN_MAX,
  TYPED_CONFIRMATION_THRESHOLD,
  confirmationPhraseFor,
} from "../../lib/legacy-crm/bulkAssign";
import { FROZEN_FIELDS } from "../../lib/legacy-crm/writes";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const PHASE3_ROUTES = [
  "app/api/admin/leads/bulk-assign/route.ts",
  "app/api/admin/leads/assignees/route.ts",
];
const CORE = "lib/legacy-crm/bulkAssign.ts";

/** Anything that could put a message on a wire. */
const SENDER_MODULES = [
  "twilio", "msg91", "gupshup", "whatsapp", "lib/sms/gateway", "sms/service",
  "nodemailer", "sendgrid", "resend", "lib/mailer",
];
const SENDER_SYMBOLS = ["sendSms", "sendBatch", "sendTemplate", "dispatchSms"];

describe("Phase 3 guardrail — permission is enforced before any data is touched", () => {
  for (const route of PHASE3_ROUTES) {
    const src = read(route);

    it(`${route} requires manage_students_leads`, () => {
      assert.ok(
        src.includes('requirePermission("manage_students_leads")'),
        "every bulk route must gate on the worklist permission",
      );
    });

    it(`${route} checks the gate before it reads or writes`, () => {
      const gate = src.indexOf("requirePermission");
      const firstWork = Math.min(
        ...["planBulkAssign", "commitBulkAssign", "revertAssignBatch", "listAssignBatches",
            "listAssignableCounsellors", "queueDepths"]
          .map((s) => { const i = src.indexOf(s + "("); return i === -1 ? Number.MAX_SAFE_INTEGER : i; }),
      );
      assert.ok(gate !== -1, "no permission gate found");
      assert.ok(gate < firstWork, "the gate must precede the first data call");
    });
  }

  it("the commit path also demands an authenticated actor", () => {
    // Permission alone is not enough: every audit row records WHO, and an
    // unattributed bulk reassignment of 1,000 leads is not auditable.
    const src = read("app/api/admin/leads/bulk-assign/route.ts");
    assert.ok(src.includes("getActionActor()"), "must resolve a real actor");
    const actorAt = src.indexOf("getActionActor()");
    const commitAt = src.indexOf("commitBulkAssign(");
    assert.ok(actorAt !== -1 && commitAt !== -1 && actorAt < commitAt);
  });
});

describe("Phase 3 guardrail — no destructive bulk action exists", () => {
  const src = read(CORE);

  it("the only column bulk assignment writes is assigned_to", () => {
    // The update payloads in this module. If a second column ever appears
    // here, "bulk assignment" has quietly become "bulk edit".
    const patches = [...src.matchAll(/\.update\(\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    for (const p of patches) {
      const keys = [...p.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]!);
      for (const k of keys) {
        assert.ok(
          ["assigned_to", "reverted_at", "reverted_by"].includes(k),
          `bulk assignment wrote "${k}" — only assigned_to (and the audit's own ` +
            `reverted_at/reverted_by bookkeeping) may be written here`,
        );
      }
    }
  });

  it("writes no frozen field", () => {
    // Scoped to update PAYLOADS. Matching the whole file would also flag type
    // annotations like `created_at: string`, which read the column rather than
    // write it — a false positive that would train the next person to
    // weaken this test rather than trust it.
    const patches = [...src.matchAll(/\.update\(\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    for (const p of patches) {
      for (const f of FROZEN_FIELDS) {
        assert.ok(
          !new RegExp(`\\b${f}\\s*:`).test(p),
          `bulk assignment must never write the frozen field ${f}`,
        );
      }
    }
  });

  it("contains no delete of business data", () => {
    assert.ok(!/\.delete\(\)/.test(src), "bulk assignment must never delete a row");
  });

  it("cannot change a status in bulk", () => {
    for (const forbidden of ["work_status:", "status:", "legacy_call_status"]) {
      assert.ok(
        !src.includes(forbidden),
        `Phase 3 is assignment only — found "${forbidden}"`,
      );
    }
  });

  it("sends nothing", () => {
    const imports = src.split("\n").filter((l) => /^\s*import\s.*from\s|require\(/.test(l));
    for (const banned of SENDER_MODULES) {
      assert.ok(
        !imports.some((l) => l.toLowerCase().includes(banned)),
        `must not import ${banned}`,
      );
    }
    for (const sym of SENDER_SYMBOLS) {
      assert.ok(!new RegExp(`\\b${sym}\\s*\\(`).test(src), `must not call ${sym}()`);
    }
    for (const route of PHASE3_ROUTES) {
      const rsrc = read(route);
      for (const sym of SENDER_SYMBOLS) {
        assert.ok(!new RegExp(`\\b${sym}\\s*\\(`).test(rsrc), `${route} must not call ${sym}()`);
      }
    }
  });
});

describe("Phase 3 guardrail — the blast radius is bounded", () => {
  const src = read(CORE);

  it("the cap is real and below the legacy population", () => {
    assert.ok(BULK_ASSIGN_MAX > 0);
    assert.ok(
      BULK_ASSIGN_MAX < 178_183,
      "the cap must be smaller than the legacy set, or it is not a cap",
    );
  });

  it("the typed-confirmation threshold sits below the cap", () => {
    assert.ok(TYPED_CONFIRMATION_THRESHOLD < BULK_ASSIGN_MAX);
    assert.equal(TYPED_CONFIRMATION_THRESHOLD, 1_000, "the requirement names 1,000 explicitly");
  });

  it("the confirmation phrase encodes the row count", () => {
    // A fixed word like "CONFIRM" can be typed from habit. Including the count
    // means the operator has to have read the number to reproduce it.
    assert.notEqual(confirmationPhraseFor(1200), confirmationPhraseFor(1201));
    assert.ok(confirmationPhraseFor(1200).includes("1200"));
  });

  it("commit re-checks the cap rather than trusting the plan it was handed", () => {
    // The plan arrives over HTTP from the client and could say anything.
    const fn = src.slice(src.indexOf("export async function commitBulkAssign"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.ok(body.includes("BULK_ASSIGN_MAX"), "commit must enforce the cap itself");
    assert.ok(body.includes("assertAssigneesExist"), "commit must re-validate the assignees itself");
  });
});
