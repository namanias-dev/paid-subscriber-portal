/**
 * PHASE 4 — promotion correctness.
 *
 * The properties that make it safe to move a real person into the live sales
 * pipeline:
 *
 *   1. Promote then demote returns the row to byte-identical state, INCLUDING
 *      the attribution JSONB. Asserted column by column, not sampled.
 *   2. An existing live lead for the same human BLOCKS the promotion. Phase 0
 *      measured zero collisions, so this is proven against a constructed one —
 *      an unexercised guard is not a guard.
 *   3. A second promote is a no-op, not a second act.
 *   4. Nothing outside PROMOTION_FIELDS is ever written, and `is_legacy` in
 *      particular survives, because provenance is not membership.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  previewPromote,
  promoteLead,
  demoteLead,
  findActiveLiveDuplicate,
  assertOnlyPromotionFields,
  dryRunBulkPromote,
  _setPromoteClientForTests,
  PROMOTION_FIELDS,
  PROMOTION_PRESERVED,
  COHORT_LEGACY_PROMOTED,
  PROMOTED_STATUS,
  PromoteError,
  DuplicateLiveLeadError,
} from "../../lib/legacy-crm/promote";
import { FROZEN_FIELDS } from "../../lib/legacy-crm/writes";
import { FakeLeadsDb, type FakeLead } from "../legacy-crm-phase3/fakeLeadsDb";

const ACTOR = { id: "aman", name: "Aman Sharma" };

/** A legacy lead shaped like the real thing, blob and all. */
function legacyLead(over: Partial<FakeLead> = {}): FakeLead {
  return {
    id: "LEG-1",
    created_at: "2023-04-11T06:30:00.000Z",
    is_legacy: true,
    merged_into: null,
    assigned_to: null,
    phone: "9876543210",
    name: "Sunita Devi",
    status: "Not Replied",
    cohort: null,
    promoted_at: null,
    promoted_by: null,
    work_status: null,
    legacy_call_status_raw: "call back after 6pm - sounded keen",
    legacy_source_tab: "Feb 2023 Enquiries",
    campaign_clean: "UPSC Foundation 2023",
    import_batch: "sheets-2024-01",
    import_source: "google_sheets",
    attribution: {
      legacy: true,
      first_touch: { channel: "Offline", campaign: "UPSC Foundation 2023", at: "2023-04-11" },
      last_touch: { channel: "Offline" },
    },
    ...over,
  };
}

function liveLead(over: Partial<FakeLead> = {}): FakeLead {
  return {
    id: "LIVE-1",
    created_at: "2026-07-01T10:00:00.000Z",
    is_legacy: false,
    merged_into: null,
    assigned_to: null,
    phone: "9876543210",
    name: "Sunita D",
    status: "New",
    cohort: null,
    promoted_at: null,
    promoted_by: null,
    attribution: { first_touch: { channel: "Google Ads" } },
    ...over,
  };
}

function useDb(leads: FakeLead[]) {
  const db = new FakeLeadsDb(leads);
  _setPromoteClientForTests(db);
  return db;
}

describe("Phase 4 — the write contract", () => {
  afterEach(() => _setPromoteClientForTests(null));

  it("promotion may not touch is_legacy", () => {
    assert.ok(
      !(PROMOTION_FIELDS as readonly string[]).includes("is_legacy"),
      "is_legacy is provenance. A promoted lead is a legacy lead being worked, " +
      "and every historical count that says 178,183 must keep saying it.",
    );
  });

  it("refuses any field outside the contract", () => {
    assert.throws(() => assertOnlyPromotionFields({ phone: "9" }), PromoteError);
    assert.throws(() => assertOnlyPromotionFields({ attribution: {} }), PromoteError);
    assert.throws(() => assertOnlyPromotionFields({ legacy_call_status_raw: "x" }), PromoteError);
    assert.doesNotThrow(() => assertOnlyPromotionFields({
      promoted_at: "x", promoted_by: "y", cohort: "z", status: "New",
    }));
  });

  it("everything promotion preserves is either frozen or provenance", () => {
    // The two lists must not drift apart: anything the CRM freezes and
    // promotion also touches would be a hole between the two contracts.
    const both = PROMOTION_PRESERVED.filter((f) =>
      (PROMOTION_FIELDS as readonly string[]).includes(f));
    assert.deepEqual(both, [], "a column cannot be both preserved and written");

    for (const f of ["attribution", "legacy_call_status_raw", "created_at", "phone"]) {
      assert.ok(
        (PROMOTION_PRESERVED as readonly string[]).includes(f),
        `${f} must be preserved byte-identically`,
      );
      assert.ok((FROZEN_FIELDS as readonly string[]).includes(f));
    }
  });
});

describe("Phase 4 — promote / demote round trip", () => {
  afterEach(() => _setPromoteClientForTests(null));

  it("restores every column byte-identically, JSONB included", async () => {
    const original = legacyLead();
    const snapshot = structuredClone(original);
    const db = useDb([original]);

    await promoteLead({ leadId: "LEG-1", actor: ACTOR });

    const promoted = db.leads[0]!;
    assert.equal(promoted.status, PROMOTED_STATUS, "lands in a neutral live state");
    assert.equal(promoted.cohort, COHORT_LEGACY_PROMOTED);
    assert.ok(promoted.promoted_at, "promoted_at is the live-pipeline flag");
    assert.equal(promoted.promoted_by, ACTOR.id);
    assert.equal(promoted.is_legacy, true, "provenance survives promotion");

    // Preserved through the promotion itself, not merely after the round trip.
    for (const f of PROMOTION_PRESERVED) {
      assert.deepEqual(
        promoted[f], snapshot[f],
        `${f} changed during promotion — promotion never rewrites history`,
      );
    }

    await demoteLead({ leadId: "LEG-1", actor: ACTOR });

    const after = db.leads[0]!;
    for (const key of Object.keys(snapshot)) {
      assert.deepEqual(
        after[key], snapshot[key],
        `${key} did not survive the round trip: ${JSON.stringify(snapshot[key])} -> ${JSON.stringify(after[key])}`,
      );
    }
  });

  it("restores the ORIGINAL mapped status, not a guessed default", async () => {
    // Two leads whose pre-promotion statuses differ. A demote that assumed
    // "Not Replied" would be right for one and silently wrong for the other.
    for (const status of ["Not Replied", "Call Back", "Interested"]) {
      const db = useDb([legacyLead({ id: `L-${status}`, status })]);
      await promoteLead({ leadId: `L-${status}`, actor: ACTOR });
      assert.equal(db.leads[0]!.status, PROMOTED_STATUS);
      await demoteLead({ leadId: `L-${status}`, actor: ACTOR });
      assert.equal(db.leads[0]!.status, status, `demote must restore ${status} exactly`);
    }
  });

  it("audits every field it changes, with true before-values", async () => {
    const db = useDb([legacyLead()]);
    await promoteLead({ leadId: "LEG-1", actor: ACTOR });

    const rows = db.audit.filter((a) => a.action === "promote");
    assert.equal(rows.length, PROMOTION_FIELDS.length);
    const statusRow = rows.find((r) => r.field === "status")!;
    assert.equal(statusRow.before_value, "Not Replied");
    assert.equal(statusRow.after_value, PROMOTED_STATUS);
    assert.ok(rows.every((r) => r.batch_id), "every promotion row is batch-tagged");
  });
});

describe("Phase 4 — duplicate safety", () => {
  afterEach(() => _setPromoteClientForTests(null));

  it("blocks when an active live lead holds the same number", async () => {
    useDb([legacyLead(), liveLead()]);

    const preview = await previewPromote("LEG-1");
    assert.equal(preview.ok, false, "preview must surface the block before the click");
    assert.ok(preview.duplicateOf, "and say which record to open instead");
    assert.equal(preview.duplicateOf!.leadId, "LIVE-1");

    await assert.rejects(
      () => promoteLead({ leadId: "LEG-1", actor: ACTOR }),
      DuplicateLiveLeadError,
      "never two live rows for one human",
    );
  });

  it("matches across formatting, the way the SMS layer does", async () => {
    // Same person, three renderings. Comparing raw text would miss all of them
    // and cheerfully create a second live row.
    for (const stored of ["+91 98765 43210", "098765 43210", "919876543210"]) {
      useDb([legacyLead({ phone: "9876543210" }), liveLead({ phone: stored })]);
      const dup = await findActiveLiveDuplicate("9876543210", "LEG-1");
      assert.ok(dup, `"${stored}" is the same human and must collide`);
    }
  });

  it("does not treat a merged or unpromoted legacy row as a live lead", async () => {
    // A second legacy row with the same number is not a live lead, so it must
    // not block — otherwise the legacy set blocks its own promotion.
    useDb([legacyLead(), legacyLead({ id: "LEG-2" })]);
    assert.equal(await findActiveLiveDuplicate("9876543210", "LEG-1"), null);

    useDb([legacyLead(), liveLead({ merged_into: "SOMETHING" })]);
    assert.equal(
      await findActiveLiveDuplicate("9876543210", "LEG-1"), null,
      "a merged row is not active and must not block",
    );
  });

  it("treats an already-promoted legacy lead as live", async () => {
    useDb([
      legacyLead(),
      legacyLead({ id: "LEG-OLD", promoted_at: "2026-07-01T00:00:00.000Z" }),
    ]);
    const dup = await findActiveLiveDuplicate("9876543210", "LEG-1");
    assert.ok(dup, "a promoted legacy lead IS in the live pipeline");
    assert.equal(dup!.leadId, "LEG-OLD");
  });

  it("re-checks at commit, not just at preview", async () => {
    const db = useDb([legacyLead()]);
    const preview = await previewPromote("LEG-1");
    assert.equal(preview.ok, true, "clean at preview time");

    // The public site captures a lead for the same number in between.
    db.leads.push(liveLead({ id: "LIVE-LATE" }));

    await assert.rejects(
      () => promoteLead({ leadId: "LEG-1", actor: ACTOR }),
      DuplicateLiveLeadError,
      "the collision window is exactly where a real one arrives",
    );
  });
});

describe("Phase 4 — idempotence", () => {
  afterEach(() => _setPromoteClientForTests(null));

  it("a second promote changes nothing and writes no audit row", async () => {
    const db = useDb([legacyLead()]);
    const first = await promoteLead({ leadId: "LEG-1", actor: ACTOR });
    assert.equal(first.changed, true);
    const promotedAt = db.leads[0]!.promoted_at;
    const auditCount = db.audit.length;

    const second = await promoteLead({ leadId: "LEG-1", actor: ACTOR });
    assert.equal(second.changed, false, "a repeat is not a second act");
    assert.equal(db.leads[0]!.promoted_at, promotedAt, "the original timestamp stands");
    assert.equal(db.audit.length, auditCount, "no audit row implies an act that did not happen");
  });

  it("demoting an unpromoted lead is a no-op", async () => {
    useDb([legacyLead()]);
    const r = await demoteLead({ leadId: "LEG-1", actor: ACTOR });
    assert.equal(r.changed, false);
  });

  it("refuses to demote a promoted lead with no audit to restore from", async () => {
    // Guessing the prior status would be right often enough to look correct.
    useDb([legacyLead({ promoted_at: "2026-07-01T00:00:00.000Z", status: "New" })]);
    await assert.rejects(
      () => demoteLead({ leadId: "LEG-1", actor: ACTOR }),
      PromoteError,
    );
  });
});

describe("Phase 4 — bulk dry run", () => {
  afterEach(() => _setPromoteClientForTests(null));

  it("counts promotable, already-promoted and duplicate-blocked separately", async () => {
    useDb([
      legacyLead({ id: "A", phone: "9000000001" }),
      legacyLead({ id: "B", phone: "9000000002" }),
      legacyLead({ id: "C", phone: "9000000003", promoted_at: "2026-01-01T00:00:00.000Z" }),
      legacyLead({ id: "D", phone: "9000000004" }),
      liveLead({ id: "LIVE-D", phone: "9000000004" }),
    ]);

    const dry = await dryRunBulkPromote({ filter: {} });
    assert.equal(dry.totalPromotable, 2, "A and B");
    assert.equal(dry.totalAlreadyPromoted, 1, "C");
    assert.equal(dry.totalDuplicateBlocked, 1, "D collides with LIVE-D");
    assert.equal(dry.duplicateSamples[0]!.leadId, "D");
    assert.ok(dry.rollbackCommand.includes(dry.batchId), "the undo must be printed with it");
  });

  it("writes nothing at all", async () => {
    const db = useDb([legacyLead({ id: "A" }), legacyLead({ id: "B" })]);
    await dryRunBulkPromote({ filter: {} });
    assert.deepEqual(db.updates, [], "a dry run that writes is not a dry run");
    assert.deepEqual(db.audit, []);
    assert.equal(db.leads.every((l) => l.promoted_at === null), true);
  });
});

/**
 * `cohort` reads like a promotion marker and is not one. Measured in
 * production: all 178,183 legacy rows already carry `legacy_promoted` (set by
 * the Phase 0/1 import, meaning "came from the sheets"), and all live-captured
 * rows carry `live_captured`.
 *
 * Two things follow, both tested here: promotion must not file an audit row
 * claiming it changed something it did not, and nothing may infer promotion
 * from the cohort value.
 */
describe("Phase 4 — cohort is provenance, not promotion", () => {
  afterEach(() => _setPromoteClientForTests(null));

  it("files no audit row for a cohort that was already set", async () => {
    const db = useDb([legacyLead({ cohort: COHORT_LEGACY_PROMOTED })]);
    await promoteLead({ leadId: "LEG-1", actor: ACTOR });

    const fields = db.audit.filter((a) => a.action === "promote").map((a) => a.field);
    assert.ok(
      !fields.includes("cohort"),
      "audited a cohort change that did not happen — the trail must mean something",
    );
    assert.ok(fields.includes("promoted_at") && fields.includes("status"));
  });

  it("still writes cohort when it genuinely differs", async () => {
    const db = useDb([legacyLead({ cohort: null })]);
    await promoteLead({ leadId: "LEG-1", actor: ACTOR });
    assert.equal(db.leads[0]!.cohort, COHORT_LEGACY_PROMOTED);
    const fields = db.audit.filter((a) => a.action === "promote").map((a) => a.field);
    assert.ok(fields.includes("cohort"));
  });

  it("round-trips byte-identically in both cohort cases", async () => {
    for (const cohort of [COHORT_LEGACY_PROMOTED, null, "something_else"]) {
      const db = useDb([legacyLead({ cohort })]);
      const snapshot = structuredClone(db.leads[0]!);
      await promoteLead({ leadId: "LEG-1", actor: ACTOR });
      await demoteLead({ leadId: "LEG-1", actor: ACTOR });
      for (const key of Object.keys(snapshot)) {
        assert.deepEqual(
          db.leads[0]![key], snapshot[key],
          `${key} drifted when cohort started as ${JSON.stringify(cohort)}`,
        );
      }
    }
  });

  it("promotion is never inferred from the cohort value", async () => {
    // A legacy lead carrying `legacy_promoted` but never promoted is NOT live,
    // so it must not block a promotion as a duplicate.
    useDb([
      legacyLead({ id: "LEG-1", cohort: COHORT_LEGACY_PROMOTED }),
      legacyLead({ id: "LEG-2", cohort: COHORT_LEGACY_PROMOTED }),
    ]);
    assert.equal(
      await findActiveLiveDuplicate("9876543210", "LEG-1"), null,
      "if cohort were read as promotion, the legacy set would block itself entirely",
    );
  });
});
