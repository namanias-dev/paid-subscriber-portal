/**
 * PHASE 3 — bulk assignment correctness.
 *
 * The properties proven here are the ones that make a 1,000-row ownership
 * change safe to click:
 *
 *   1. The preview count equals what commits, EVEN IF rows are inserted in
 *      between. This is the requirement most likely to be quietly false,
 *      because the public site inserts leads continuously and a filter-based
 *      commit would silently include them.
 *   2. Round-robin is fair and deterministic.
 *   3. Reverting restores each lead's PREVIOUS owner, not "unassigned".
 *   4. A repeated commit is a no-op rather than a second batch.
 *   5. The cap and the typed confirmation cannot be talked around.
 *   6. Only `assigned_to` is ever written.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  planBulkAssign,
  commitBulkAssign,
  revertAssignBatch,
  distribute,
  resolveSelectionIds,
  listAssignableCounsellors,
  _setBulkAssignClientForTests,
  BulkAssignError,
  BULK_ASSIGN_MAX,
  TYPED_CONFIRMATION_THRESHOLD,
  confirmationPhraseFor,
} from "../../lib/legacy-crm/bulkAssign";
import { FROZEN_FIELDS } from "../../lib/legacy-crm/writes";
import { FakeLeadsDb, makeLeads, type FakeLead } from "./fakeLeadsDb";

const ACTOR = { id: "supervisor", name: "Supervisor" };

/** Resolved from the demo admin accounts this test run sees. */
let PEOPLE: string[] = [];

function useDb(leads: FakeLead[]) {
  const db = new FakeLeadsDb(leads);
  _setBulkAssignClientForTests(db);
  return db;
}

describe("Phase 3 — who can be assigned to", () => {
  afterEach(() => _setBulkAssignClientForTests(null));

  it("only lists people who could actually open the worklist", async () => {
    const people = await listAssignableCounsellors();
    assert.ok(people.length > 0, "expected at least one assignable admin in demo mode");
    for (const p of people) {
      assert.ok(p.username, "every counsellor needs a username — that IS the assignment key");
    }
    PEOPLE = people.map((p) => p.username);
  });

  it("refuses an assignee who is not one of them", async () => {
    useDb(makeLeads(10));
    await assert.rejects(
      () => planBulkAssign({
        filter: { scope: "legacy", assignedMode: "unassigned" },
        distribution: { mode: "single", assignee: "definitely-not-a-real-user" },
      }),
      BulkAssignError,
      "a typo'd assignee must be refused — `assigned_to` has no FK, so the DB would accept it " +
        "and build a queue that My Queue can never match",
    );
  });
});

describe("Phase 3 — round-robin distribution is fair and deterministic", () => {
  it("splits as evenly as arithmetic allows", () => {
    const ids = makeLeads(10).map((l) => l.id);
    const out = distribute(ids, { mode: "round_robin", assignees: ["a", "b", "c"] });
    const counts = new Map<string, number>();
    for (const u of Object.values(out)) counts.set(u, (counts.get(u) ?? 0) + 1);
    // 10 across 3 → 4/3/3.
    assert.deepEqual([...counts.values()].sort((x, y) => y - x), [4, 3, 3]);
  });

  it("gives the same answer twice", () => {
    const ids = makeLeads(97).map((l) => l.id);
    const a = distribute(ids, { mode: "round_robin", assignees: ["x", "y", "z"] });
    const b = distribute(ids, { mode: "round_robin", assignees: ["x", "y", "z"] });
    assert.deepEqual(a, b, "the operator approves a preview; it must be the thing that commits");
  });

  it("never leaves a lead unassigned or double-assigned", () => {
    const ids = makeLeads(53).map((l) => l.id);
    const out = distribute(ids, { mode: "round_robin", assignees: ["p", "q"] });
    assert.equal(Object.keys(out).length, 53);
    for (const id of ids) assert.ok(out[id], `${id} was not assigned`);
  });

  it("refuses fixed counts that exceed the matched rows", () => {
    const ids = makeLeads(5).map((l) => l.id);
    assert.throws(
      () => distribute(ids, { mode: "fixed", allocations: [{ username: "a", count: 10 }] }),
      BulkAssignError,
      "under-delivering against an approved number silently is worse than refusing",
    );
  });
});

describe("Phase 3 — the preview is exactly what commits", () => {
  beforeEach(async () => { if (!PEOPLE.length) PEOPLE = (await listAssignableCounsellors()).map((p) => p.username); });
  afterEach(() => _setBulkAssignClientForTests(null));

  it("a lead inserted BETWEEN preview and commit is not swept in", async () => {
    // THE headline requirement. A filter-based commit would re-resolve and
    // silently include the new row, so the operator would approve 40 and 41
    // would happen. The manifest makes that structurally impossible.
    const db = useDb(makeLeads(40));
    const plan = await planBulkAssign({
      filter: { scope: "legacy", assignedMode: "unassigned" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });
    assert.equal(plan.totalChanging, 40);

    // The public site captures a lead. It matches the filter perfectly.
    db.leads.push(...makeLeads(1, { id: "NEW-ARRIVAL" }));

    const res = await commitBulkAssign({ plan, actor: ACTOR });
    assert.equal(res.assigned, 40, "commit must move exactly what the preview promised");

    const newcomer = db.leads.find((l) => l.id === "NEW-ARRIVAL")!;
    assert.equal(newcomer.assigned_to, null, "the lead that arrived mid-flight must be untouched");
  });

  it("a lead DELETED between preview and commit is reported, not fatal", async () => {
    const db = useDb(makeLeads(10));
    const plan = await planBulkAssign({
      filter: { scope: "legacy", assignedMode: "unassigned" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });
    db.leads = db.leads.filter((l) => l.id !== "L00003");

    const res = await commitBulkAssign({ plan, actor: ACTOR });
    assert.equal(res.assigned, 9);
    assert.deepEqual(res.missing, ["L00003"]);
  });

  it("a lead REASSIGNED by hand between preview and commit is flagged as drift", async () => {
    const db = useDb(makeLeads(5));
    const plan = await planBulkAssign({
      filter: { scope: "legacy", assignedMode: "unassigned" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });
    db.leads.find((l) => l.id === "L00002")!.assigned_to = "someone-else";

    const res = await commitBulkAssign({ plan, actor: ACTOR });
    assert.equal(res.driftedSincePreview.length, 1);
    assert.equal(res.driftedSincePreview[0]!.leadId, "L00002");
    assert.equal(res.driftedSincePreview[0]!.actualBefore, "someone-else");
  });

  it("counts rows already owned by their target as no-ops, not work", async () => {
    const leads = makeLeads(10);
    for (const l of leads.slice(0, 4)) l.assigned_to = PEOPLE[0]!;
    useDb(leads);

    const plan = await planBulkAssign({
      filter: { scope: "legacy" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });
    assert.equal(plan.totalMatched, 10);
    assert.equal(plan.totalChanging, 6, "4 already belong to the target");
    assert.equal(plan.totalAlreadyOwned, 4);
  });
});

describe("Phase 3 — the scope boundary holds", () => {
  afterEach(() => _setBulkAssignClientForTests(null));

  it("a legacy-scoped selection never picks up a live lead", async () => {
    const leads = [...makeLeads(6), ...makeLeads(4, { is_legacy: false }).map((l, i) => ({ ...l, id: `LIVE${i}` }))];
    useDb(leads);
    const { ids } = await resolveSelectionIds({ scope: "legacy" });
    assert.equal(ids.length, 6);
    assert.ok(!ids.some((id) => id.startsWith("LIVE")));
  });

  it("soft-merged rows are never assignable", async () => {
    const leads = makeLeads(5);
    leads[0]!.merged_into = "some-other-lead";
    useDb(leads);
    const { ids } = await resolveSelectionIds({ scope: "legacy" });
    assert.equal(ids.length, 4);
    assert.ok(!ids.includes("L00000"));
  });
});

describe("Phase 3 — caps and typed confirmation", () => {
  beforeEach(async () => { if (!PEOPLE.length) PEOPLE = (await listAssignableCounsellors()).map((p) => p.username); });
  afterEach(() => _setBulkAssignClientForTests(null));

  it("truncates at the cap and says so rather than silently trimming", async () => {
    useDb(makeLeads(BULK_ASSIGN_MAX + 25));
    const plan = await planBulkAssign({
      filter: { scope: "legacy" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });
    assert.equal(plan.totalMatched, BULK_ASSIGN_MAX);
    assert.equal(plan.capped, true);
    assert.ok(plan.warnings.some((w) => w.includes(String(BULK_ASSIGN_MAX))));
  });

  it("demands the exact phrase above the threshold", async () => {
    const n = TYPED_CONFIRMATION_THRESHOLD + 10;
    useDb(makeLeads(n));
    const plan = await planBulkAssign({
      filter: { scope: "legacy" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });
    assert.equal(plan.requiresTypedConfirmation, true);
    assert.equal(plan.confirmationPhrase, confirmationPhraseFor(n));

    await assert.rejects(() => commitBulkAssign({ plan, actor: ACTOR }), BulkAssignError);
    await assert.rejects(
      () => commitBulkAssign({ plan, actor: ACTOR, typedConfirmation: "ASSIGN" }),
      BulkAssignError,
    );
    const res = await commitBulkAssign({ plan, actor: ACTOR, typedConfirmation: confirmationPhraseFor(n) });
    assert.equal(res.assigned, n);
  });

  it("does not ask for confirmation on a small batch", async () => {
    useDb(makeLeads(10));
    const plan = await planBulkAssign({
      filter: { scope: "legacy" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });
    assert.equal(plan.requiresTypedConfirmation, false);
    const res = await commitBulkAssign({ plan, actor: ACTOR });
    assert.equal(res.assigned, 10);
  });

  it("re-derives the phrase from what will ACTUALLY change", async () => {
    // The operator approved a phrase for N rows. If drift makes the real
    // number different, the approval no longer describes what is about to
    // happen, and the phrase must stop matching.
    const n = TYPED_CONFIRMATION_THRESHOLD + 5;
    const db = useDb(makeLeads(n));
    const plan = await planBulkAssign({
      filter: { scope: "legacy" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });
    const approved = plan.confirmationPhrase!;

    // Three rows get the target owner by hand, so only n-3 will change.
    for (const l of db.leads.slice(0, 3)) l.assigned_to = PEOPLE[0]!;

    await assert.rejects(
      () => commitBulkAssign({ plan, actor: ACTOR, typedConfirmation: approved }),
      /needs typed confirmation/,
      "the stale phrase must be rejected once the real count moved",
    );
    const res = await commitBulkAssign({
      plan, actor: ACTOR, typedConfirmation: confirmationPhraseFor(n - 3),
    });
    assert.equal(res.assigned, n - 3);
  });
});

describe("Phase 3 — reversal restores the PREVIOUS owner", () => {
  beforeEach(async () => { if (!PEOPLE.length) PEOPLE = (await listAssignableCounsellors()).map((p) => p.username); });
  afterEach(() => _setBulkAssignClientForTests(null));

  it("puts each lead back where it was, including previously-owned ones", async () => {
    // The interesting case is not the unassigned pool — it is a reassignment.
    // Clearing the field on revert would look like it worked and quietly
    // dispossess whoever owned the lead beforehand.
    const leads = makeLeads(9);
    leads[0]!.assigned_to = "priya";
    leads[1]!.assigned_to = "arjun";
    const db = useDb(leads);
    const before = new Map(db.leads.map((l) => [l.id, l.assigned_to]));

    const plan = await planBulkAssign({
      filter: { scope: "legacy" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });
    const res = await commitBulkAssign({ plan, actor: ACTOR });
    assert.ok(res.assigned > 0);
    assert.ok(db.leads.every((l) => l.assigned_to === PEOPLE[0]!));

    const rev = await revertAssignBatch(plan.batchId, ACTOR);
    assert.equal(rev.reverted, res.assigned);
    for (const l of db.leads) {
      assert.equal(l.assigned_to, before.get(l.id), `${l.id} was not restored to its prior owner`);
    }
  });

  it("is safe to run twice", async () => {
    useDb(makeLeads(6));
    const plan = await planBulkAssign({
      filter: { scope: "legacy" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });
    await commitBulkAssign({ plan, actor: ACTOR });

    const first = await revertAssignBatch(plan.batchId, ACTOR);
    assert.equal(first.reverted, 6);
    const second = await revertAssignBatch(plan.batchId, ACTOR);
    assert.equal(second.reverted, 0, "a second revert must be a no-op");
    assert.equal(second.skipped, 6);
  });

  it("refuses an unknown batch rather than silently doing nothing", async () => {
    useDb(makeLeads(3));
    await assert.rejects(() => revertAssignBatch("no-such-batch", ACTOR), BulkAssignError);
  });

  it("reverses a round-robin across several counsellors", async () => {
    if (PEOPLE.length < 1) return;
    const db = useDb(makeLeads(12));
    const people = [PEOPLE[0]!, ...(PEOPLE[1] ? [PEOPLE[1]] : [])];
    const plan = await planBulkAssign({
      filter: { scope: "legacy" },
      distribution: { mode: "round_robin", assignees: people },
    });
    await commitBulkAssign({ plan, actor: ACTOR });
    await revertAssignBatch(plan.batchId, ACTOR);
    assert.ok(db.leads.every((l) => l.assigned_to === null));
  });
});

describe("Phase 3 — idempotence and the audit trail", () => {
  beforeEach(async () => { if (!PEOPLE.length) PEOPLE = (await listAssignableCounsellors()).map((p) => p.username); });
  afterEach(() => _setBulkAssignClientForTests(null));

  it("committing the same plan twice does not reassign or double-audit", async () => {
    const db = useDb(makeLeads(8));
    const plan = await planBulkAssign({
      filter: { scope: "legacy" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });

    const first = await commitBulkAssign({ plan, actor: ACTOR });
    assert.equal(first.assigned, 8);
    const auditAfterFirst = db.audit.length;

    const second = await commitBulkAssign({ plan, actor: ACTOR });
    assert.equal(second.assigned, 0, "a replayed request must write nothing");
    assert.equal(second.skippedAlreadyOwned, 8);
    assert.equal(db.audit.length, auditAfterFirst, "and must not add audit rows implying a second act");
  });

  it("writes one audit row per lead, all sharing the batch id", async () => {
    const db = useDb(makeLeads(7));
    const plan = await planBulkAssign({
      filter: { scope: "legacy" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });
    await commitBulkAssign({ plan, actor: ACTOR });

    const rows = db.audit.filter((a) => a.batch_id === plan.batchId);
    assert.equal(rows.length, 7);
    for (const r of rows) {
      assert.equal(r.action, "assign");
      assert.equal(r.field, "assigned_to");
      assert.equal(r.before_value, null);
      assert.equal(r.after_value, PEOPLE[0]!);
      assert.equal(r.actor, ACTOR.id);
    }
  });

  it("records a truthful before_value when the lead already had an owner", async () => {
    const leads = makeLeads(3);
    leads[0]!.assigned_to = "priya";
    const db = useDb(leads);
    const plan = await planBulkAssign({
      filter: { scope: "legacy" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });
    await commitBulkAssign({ plan, actor: ACTOR });

    const row = db.audit.find((a) => a.lead_id === "L00000")!;
    assert.equal(row.before_value, "priya", "the audit must record who actually held it");
  });
});

describe("Phase 3 — ownership is the ONLY thing that changes", () => {
  beforeEach(async () => { if (!PEOPLE.length) PEOPLE = (await listAssignableCounsellors()).map((p) => p.username); });
  afterEach(() => _setBulkAssignClientForTests(null));

  it("no update touches any column other than assigned_to", async () => {
    const db = useDb(makeLeads(20));
    const plan = await planBulkAssign({
      filter: { scope: "legacy" },
      distribution: { mode: "round_robin", assignees: [PEOPLE[0]!] },
    });
    await commitBulkAssign({ plan, actor: ACTOR });

    const leadUpdates = db.updates.filter((u) => u.table === "leads");
    assert.ok(leadUpdates.length > 0);
    for (const u of leadUpdates) {
      assert.deepEqual(
        Object.keys(u.patch), ["assigned_to"],
        `bulk assignment wrote ${Object.keys(u.patch).join(", ")} — it may only ever write assigned_to`,
      );
      for (const f of FROZEN_FIELDS) {
        assert.ok(!Object.prototype.hasOwnProperty.call(u.patch, f), `must never write frozen field ${f}`);
      }
    }
  });

  it("leaves status and work_status untouched across assign and revert", async () => {
    const db = useDb(makeLeads(10, { status: "New", work_status: "in_progress" }));
    const plan = await planBulkAssign({
      filter: { scope: "legacy" },
      distribution: { mode: "single", assignee: PEOPLE[0]! },
    });
    await commitBulkAssign({ plan, actor: ACTOR });
    await revertAssignBatch(plan.batchId, ACTOR);

    for (const l of db.leads) {
      assert.equal(l.status, "New");
      assert.equal(l.work_status, "in_progress");
    }
  });
});
