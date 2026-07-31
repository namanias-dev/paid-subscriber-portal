/**
 * PHASE 4 guardrails — structural properties, asserted against the source.
 *
 * The headline one is ZERO SENDS. Promotion is the only operation in this
 * program that touches the live-lead surface, and the live-lead surface is
 * wired to the messaging fan-out. If promotion could reach it, promoting the
 * legacy set would text 178,183 people. That risk is not managed by being
 * careful; it is managed by there being no path.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const PROMOTE_MODULE = "lib/legacy-crm/promote.ts";
const PROMOTE_ROUTE = "app/api/admin/leads/[id]/promote/route.ts";

describe("Phase 4 guardrail — promotion cannot send anything", () => {
  /**
   * The argument has three independent layers. Any one of them alone would
   * stop a send; all three have to fail together for a message to escape.
   */

  it("layer 1: the only lead fan-out is on the INSERT path, and promotion UPDATEs", () => {
    const dp = read("lib/dataProvider.ts");

    // `fireLeadCreated` is the sole lead-lifecycle fan-out.
    const definitions = [...dp.matchAll(/function fireLeadCreated\b/g)];
    assert.equal(definitions.length, 1, "expected exactly one definition of fireLeadCreated");

    // Every call to it must sit inside addLead, the INSERT path.
    const calls = [...dp.matchAll(/^\s*fireLeadCreated\(/gm)];
    assert.equal(calls.length, 2, "fireLeadCreated is called twice: demo insert and real insert");

    const addLeadStart = dp.indexOf("export async function addLead");
    assert.ok(addLeadStart > 0, "addLead must exist");
    const addLeadEnd = dp.indexOf("\nfunction fireLeadCreated", addLeadStart);
    for (const c of calls) {
      const at = c.index!;
      assert.ok(
        at > addLeadStart && at < addLeadEnd,
        "a fireLeadCreated call escaped addLead — an UPDATE path could now fan out",
      );
    }

    // updateLead, the UPDATE path, does not fan out at all.
    const updateLead = dp.slice(
      dp.indexOf("export async function updateLead"),
      dp.indexOf("export async function deleteLead"),
    );
    assert.ok(!/fireLeadCreated|fireAutoSms|sendSms/.test(updateLead),
      "updateLead must remain a bare write");
  });

  /**
   * Imports and call sites only. An earlier version of this grepped the raw
   * text and failed on the doc comment that explains WHY promotion cannot
   * send — a guardrail that punishes documenting the guarantee teaches people
   * to delete the documentation.
   */
  const FORBIDDEN = [
    "sms/service", "sms/dispatch", "fireAutoSms", "sendSms",
    "fireAutomationEvent", "fireLeadCreated", "addLead", "lectureNotify",
  ];

  function codeOnly(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
      .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments
  }

  for (const [label, file] of [
    ["module", PROMOTE_MODULE],
    ["route", PROMOTE_ROUTE],
  ] as const) {
    it(`layer 2: the promotion ${label} cannot reach anything that sends`, () => {
      const code = codeOnly(read(file));
      const imports = [...code.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)]
        .map((m) => m[0]);
      for (const forbidden of FORBIDDEN) {
        assert.ok(
          !imports.some((i) => i.includes(forbidden)),
          `${file} imports "${forbidden}"`,
        );
        assert.ok(
          !new RegExp(`\\b${forbidden}\\s*\\(`).test(code),
          `${file} calls "${forbidden}"`,
        );
      }
    });
  }

  it("layer 3: only INSERT-path lead_created may exist; promotion triggers stay banned", () => {
    // Mission Control may auto-SMS on genuine lead INSERT via lead_created
    // (wired only inside fireLeadCreated → addLead). Promotion / status /
    // fold paths must still have no trigger to fire even if called.
    const dispatch = read("lib/sms/dispatch.ts");
    assert.ok(
      /if \(!rule \|\| !rule\.enabled \|\| !rule\.template_id\) return;/.test(dispatch),
      "the fail-closed rule gate must remain the first thing dispatch does",
    );

    // Only the TRIGGERS map. Scanning the whole file matched `message_type:
    // "promotional"`, which is a marketing classification on a webinar
    // template and has nothing to do with lead promotion.
    const templates = read("lib/sms/templates.ts");
    const block = templates.slice(
      templates.indexOf("export const TRIGGERS = {"),
      templates.indexOf("} as const;", templates.indexOf("export const TRIGGERS = {")),
    );
    const triggers = [...block.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]!);
    assert.ok(triggers.length > 10, "expected to have found the trigger list");
    assert.ok(triggers.includes("lead_created"), "lead_created Mission Control trigger must exist");

    const ALLOWED_LEAD = new Set(["lead_created"]);
    for (const t of triggers) {
      if (ALLOWED_LEAD.has(t)) continue;
      assert.ok(
        !/^lead_/.test(t) && !/^promot/.test(t),
        `a banned lead-lifecycle SMS trigger "${t}" now exists — re-derive the zero-send proof`,
      );
    }

    // fireLeadCreated is the only place that may call fireAutoSms for leads.
    const dp = read("lib/dataProvider.ts");
    const fireBody = dp.slice(
      dp.indexOf("function fireLeadCreated"),
      dp.indexOf("export async function updateLead"),
    );
    assert.ok(
      /fireAutoSms\(\s*\{[\s\S]*?trigger:\s*TRIGGERS\.lead_created/.test(fireBody),
      "fireLeadCreated must wire Mission Control lead_created auto-SMS",
    );
    const fold = dp.slice(
      dp.indexOf("async function foldTouchIntoLead") >= 0
        ? dp.indexOf("async function foldTouchIntoLead")
        : dp.indexOf("function foldTouchIntoLead"),
      dp.indexOf("export async function addLead"),
    );
    assert.ok(
      !/fireAutoSms|fireLeadCreated/.test(fold),
      "phone-fold path must not fan out SMS or lead_created",
    );
  });

  it("promotion only ever writes its four declared columns", () => {
    const src = read(PROMOTE_MODULE);
    // Every .update({...}) payload in the module.
    const updates = [...src.matchAll(/\.update\(\s*(\{[^}]*\}|\w+)\s*\)/g)].map((m) => m[1]!);
    assert.ok(updates.length > 0, "expected some updates to inspect");

    for (const u of updates) {
      // Object literals are checked key by key; variables must be ones that
      // passed through assertOnlyPromotionFields.
      if (u.startsWith("{")) {
        const keys = [...u.matchAll(/(\w+)\s*:/g)].map((m) => m[1]!);
        for (const k of keys) {
          assert.ok(
            ["promoted_at", "promoted_by", "cohort", "status", "reverted_at", "reverted_by"].includes(k),
            `promotion writes "${k}", which is outside its contract`,
          );
        }
      } else {
        assert.ok(
          ["patch", "restored"].includes(u),
          `update(${u}) is not a guarded payload — route it through assertOnlyPromotionFields`,
        );
      }
    }
    assert.ok(
      src.includes("assertOnlyPromotionFields(patch)") &&
      src.includes("assertOnlyPromotionFields(restored)"),
      "both write payloads must be guarded",
    );
  });

  it("never deletes business data", () => {
    const src = read(PROMOTE_MODULE);
    assert.ok(!/\.delete\(\)/.test(src), "promotion deletes nothing");
  });
});

describe("Phase 4 guardrail — permission is enforced at the API layer", () => {
  it("every method on the promote route requires Super Admin", () => {
    const src = read(PROMOTE_ROUTE);
    for (const method of ["GET", "POST", "DELETE"]) {
      const start = src.indexOf(`export async function ${method}(`);
      assert.ok(start > 0, `${method} must exist`);
      const body = src.slice(start, start + 400);
      assert.ok(
        body.includes("requireSuperAdmin()"),
        `${method} must gate on requireSuperAdmin — promotion is not a counsellor action`,
      );
    }
  });

  it("checks the gate before reading or writing anything", () => {
    const src = read(PROMOTE_ROUTE);
    for (const method of ["GET", "POST", "DELETE"]) {
      const start = src.indexOf(`export async function ${method}(`);
      const body = src.slice(start, src.indexOf("\n}", start));
      const gate = body.indexOf("requireSuperAdmin");
      const firstWork = Math.min(
        ...["previewPromote(", "promoteLead(", "demoteLead("]
          .map((f) => body.indexOf(f))
          .filter((i) => i >= 0),
      );
      assert.ok(gate >= 0 && gate < firstWork, `${method} does work before authorizing`);
    }
  });

  it("a stricter gate than the rest of the worklist, on purpose", () => {
    const promote = read(PROMOTE_ROUTE);
    const worklist = read("app/api/admin/leads/[id]/worklist-action/route.ts");
    assert.ok(promote.includes("requireSuperAdmin"));
    assert.ok(
      worklist.includes("manage_students_leads"),
      "ordinary lead actions stay on the ordinary permission",
    );
    assert.ok(
      !promote.includes('requirePermission("manage_students_leads")'),
      "promotion must not be reachable with only the counsellor permission",
    );
  });
});

describe("Phase 4 guardrail — provenance survives", () => {
  it("no code path writes is_legacy", () => {
    const src = read("lib/legacy-crm/promote.ts");
    assert.ok(
      !/is_legacy\s*:/.test(src.replace(/is_legacy: boolean/g, "")),
      "is_legacy must never appear as a write key",
    );
  });

  it("attribution is never written during promotion", () => {
    const src = read("lib/legacy-crm/promote.ts");
    const updates = [...src.matchAll(/\.update\(\s*\{[^}]*\}\s*\)/g)].map((m) => m[0]);
    for (const u of updates) {
      assert.ok(!u.includes("attribution"), "the blob carries first_touch and is history");
    }
  });
});
