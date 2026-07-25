/**
 * PHASE 2 QA — WRITE ACTIONS, against the real database.
 *
 * Run: node --import tsx --import ./scripts/_react-cache-shim.mjs \
 *        --env-file=.env.local scripts/qa/phase2-writes-qa.ts
 *
 * SAFETY
 * ------
 * This exercises real writes on ONE real legacy lead and then reverts every
 * one of them, verifying the row is byte-identical afterwards on every field
 * it touched. That is the only honest way to prove "audited, idempotent,
 * reversible" — a mocked client would prove only that the mock agrees with
 * itself.
 *
 * It sends ZERO messages. There is no send path in the write layer at all.
 * It deletes NOTHING: reversal is a forward write plus an append-only audit
 * row, and the audit trail of this QA run is left in place as evidence.
 */

import { getSupabaseAdmin } from "../../lib/supabase";
import {
  addLeadNote,
  applyLeadWrite,
  assertNoFrozenFieldWrite,
  assignLead,
  FrozenFieldWriteError,
  getLeadAudit,
  getLeadNotes,
  LeadNotFoundError,
  markOptedOut,
  markUnreachable,
  markWrongNumber,
  revertWrite,
  setFollowUp,
  setWorkStatus,
  type WriteActor,
} from "../../lib/legacy-crm/writes";

const actor: WriteActor = { id: "qa_phase2_harness", name: "QA Harness" };

interface Check { id: string; check: string; expected: string; actual: string; result: "PASS" | "FAIL" }
const checks: Check[] = [];
function record(id: string, check: string, expected: unknown, actual: unknown, ok?: boolean) {
  const pass = ok ?? String(expected) === String(actual);
  checks.push({ id, check, expected: String(expected), actual: String(actual), result: pass ? "PASS" : "FAIL" });
}

const db = getSupabaseAdmin();
if (!db) { console.error("FATAL: no Supabase admin client"); process.exit(1); }

/** The fields a full write cycle must restore exactly. */
const TOUCHED = [
  "work_status", "work_status_at", "work_status_by", "assigned_to", "follow_up_at",
  "last_worked_at", "suppression_reason", "consent_status", "opted_out_at",
] as const;
/** The fields NOTHING may ever change. */
const FROZEN_WITNESS = [
  "status", "legacy_call_status", "legacy_call_status_raw", "cohort", "is_legacy",
  "created_at", "first_seen_at", "import_batch", "phone", "name",
] as const;

async function snapshot(id: string) {
  const { data, error } = await db!
    .from("leads")
    .select([...TOUCHED, ...FROZEN_WITNESS].join(","))
    .eq("id", id)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data as unknown as Record<string, unknown>[])[0]!;
}

async function main() {
  console.log("\n" + "=".repeat(78));
  console.log("PHASE 2 QA — WRITE ACTIONS (audited · idempotent · reversible)");
  console.log("=".repeat(78));

  // Pick a real legacy lead that HAS verbatim source wording, so the
  // "raw status survives every write" check is meaningful rather than vacuous.
  const { data: picked, error: pickErr } = await db!
    .from("leads")
    .select("id, legacy_call_status_raw, status")
    .eq("is_legacy", true)
    .is("merged_into", null)
    .not("legacy_call_status_raw", "is", null)
    .limit(1);
  if (pickErr) throw new Error(pickErr.message);
  const target = (picked as { id: string; legacy_call_status_raw: string; status: string }[])[0];
  if (!target) { console.error("FATAL: no legacy lead with raw status found"); process.exit(1); }

  const LEAD = target.id;
  console.log(`\ntarget lead: ${LEAD.slice(0, 8)}…  status="${target.status}"  raw="${target.legacy_call_status_raw}"`);

  const before = await snapshot(LEAD);
  const auditBefore = (await getLeadAudit(LEAD)).length;

  // -------------------------------------------------------------------
  // 1. FROZEN FIELDS ARE UNWRITEABLE — the guard, before any real write.
  // -------------------------------------------------------------------
  const frozenAttempts = [
    { field: "status", patch: { status: "Converted" } },
    { field: "legacy_call_status_raw", patch: { legacy_call_status_raw: "rewritten" } },
    { field: "cohort", patch: { cohort: "live_captured" } },
    { field: "is_legacy", patch: { is_legacy: false } },
    { field: "phone", patch: { phone: "9999999999" } },
  ];
  const frozenRows: Record<string, unknown>[] = [];
  for (const { field, patch } of frozenAttempts) {
    let blocked = false;
    let why = "";
    try {
      assertNoFrozenFieldWrite(patch as Record<string, unknown>);
    } catch (e) {
      blocked = e instanceof FrozenFieldWriteError;
      why = (e as Error).message.slice(0, 64);
    }
    record(`FZ:${field}`, `writing frozen field "${field}" is refused`, true, blocked);
    frozenRows.push({ field, blocked: blocked ? "REFUSED" : "ALLOWED — BUG", reason: why });
  }
  console.log("\n--- 1. FROZEN-FIELD GUARD ---");
  console.table(frozenRows);

  // The guard must also fire through the real write path, not just standalone.
  let pathBlocked = false;
  try {
    await applyLeadWrite({
      leadId: LEAD, action: "work_status", actor,
      patch: { status: "Converted" } as never,
    });
  } catch (e) { pathBlocked = e instanceof FrozenFieldWriteError; }
  record("FZ:path", "the guard fires inside applyLeadWrite, not only standalone", true, pathBlocked);

  // -------------------------------------------------------------------
  // 2. A REAL WRITE IS AUDITED
  // -------------------------------------------------------------------
  const w1 = await setWorkStatus(LEAD, "in_progress", actor);
  record("W1", "setWorkStatus reports a change", true, w1.changed);
  record("W2", "setWorkStatus produced audit rows", true, w1.auditIds.length > 0);

  const afterW1 = await snapshot(LEAD);
  record("W3", "work_status actually moved", "in_progress", afterW1.work_status);
  record("W4", "status was NOT touched", String(before.status), String(afterW1.status));
  record("W5", "legacy_call_status_raw was NOT touched",
    String(before.legacy_call_status_raw), String(afterW1.legacy_call_status_raw));

  // -------------------------------------------------------------------
  // 3. IDEMPOTENCE — the same value again must be a no-op
  // -------------------------------------------------------------------
  const auditAfterW1 = (await getLeadAudit(LEAD)).length;
  const w2 = await setWorkStatus(LEAD, "in_progress", actor);
  const auditAfterW2 = (await getLeadAudit(LEAD)).length;
  // work_status_at moves on every call by design, so `changed` is true; what
  // must NOT happen is a second audit row claiming the STATUS changed again.
  const statusAudits = (await getLeadAudit(LEAD)).filter(
    (a) => a.field === "work_status" && a.after_value === "in_progress",
  );
  record("I1", "re-applying the same work_status adds no duplicate status audit", 1, statusAudits.length);
  console.log("\n--- 3. IDEMPOTENCE ---");
  console.table([
    { probe: "audit rows after first write", n: auditAfterW1 },
    { probe: "audit rows after identical second write", n: auditAfterW2 },
    { probe: "distinct work_status='in_progress' audit rows", n: statusAudits.length, expect: 1 },
    { probe: "second call reported changed", n: String(w2.changed), expect: "timestamp fields only" },
  ]);

  // -------------------------------------------------------------------
  // 4. THE FULL ACTION SET
  // -------------------------------------------------------------------
  const actionRows: Record<string, unknown>[] = [];
  const runs = [
    { label: "assign", run: () => assignLead(LEAD, "qa_counsellor", actor) },
    { label: "follow_up", run: () => setFollowUp(LEAD, "2026-08-01T09:00:00.000Z", actor) },
    { label: "wrong_number", run: () => markWrongNumber(LEAD, actor) },
    { label: "unreachable", run: () => markUnreachable(LEAD, actor) },
    { label: "opt_out", run: () => markOptedOut(LEAD, actor) },
  ];
  for (const { label, run } of runs) {
    const r = await run();
    record(`A:${label}`, `action "${label}" succeeded and was audited`, true, r.changed && r.auditIds.length > 0);
    actionRows.push({ action: label, changed: r.changed, audit_rows: r.auditIds.length, batch: r.batchId.slice(0, 8) });
  }

  const note = await addLeadNote({ leadId: LEAD, body: "QA harness note — Phase 2 verification.", actor });
  record("A:note", "note was appended", true, !!note.id);
  actionRows.push({ action: "note", changed: true, audit_rows: 1, batch: "—" });
  console.log("\n--- 4. WRITE ACTIONS ---");
  console.table(actionRows);

  const afterAll = await snapshot(LEAD);
  record("A:consent", "opt_out set consent_status to opted_out", "opted_out", afterAll.consent_status);
  record("A:frozen", "status STILL untouched after all six actions",
    String(before.status), String(afterAll.status));
  record("A:rawfrozen", "legacy_call_status_raw STILL untouched after all six actions",
    String(before.legacy_call_status_raw), String(afterAll.legacy_call_status_raw));

  // -------------------------------------------------------------------
  // 5. MISSING LEAD -> 404-shaped error, not a silent zero-row success
  // -------------------------------------------------------------------
  let notFound = false;
  try { await setWorkStatus("does-not-exist-xyz", "contacted", actor); }
  catch (e) { notFound = e instanceof LeadNotFoundError; }
  record("N1", "writing to an unknown lead raises LeadNotFound", true, notFound);

  // -------------------------------------------------------------------
  // 6. REVERSAL — replay every audit row backwards, newest first
  // -------------------------------------------------------------------
  const trail = await getLeadAudit(LEAD, 500);
  const reversible = trail.filter((a) => !a.reverted_at && a.action !== "note" && a.action !== "revert" && a.field);
  let reverted = 0;
  let revertFailed = 0;
  for (const entry of reversible) {
    try { await revertWrite(entry.id, actor); reverted++; }
    catch { revertFailed++; }
  }

  const afterRevert = await snapshot(LEAD);
  const restored: Record<string, unknown>[] = [];
  let mismatches = 0;
  for (const f of TOUCHED) {
    const b = before[f] === null || before[f] === undefined ? null : String(before[f]);
    const a = afterRevert[f] === null || afterRevert[f] === undefined ? null : String(afterRevert[f]);
    const same = b === a;
    if (!same) mismatches++;
    restored.push({ field: f, before: b ?? "null", after_revert: a ?? "null", restored: same ? "yes" : "NO" });
  }
  console.log("\n--- 6. REVERSAL (every touched field must return to its original value) ---");
  console.table(restored);
  record("R1", "every reversible audit row reverted cleanly", 0, revertFailed);
  record("R2", "all touched fields restored to their pre-QA values", 0, mismatches);

  let frozenDrift = 0;
  for (const f of FROZEN_WITNESS) {
    if (String(before[f]) !== String(afterRevert[f])) frozenDrift++;
  }
  record("R3", "no frozen field drifted at any point in the cycle", 0, frozenDrift);

  // Reversal must be append-only: the original rows are MARKED, never deleted.
  const trailAfter = await getLeadAudit(LEAD, 500);
  record("R4", "audit history is append-only (never shrinks)", true, trailAfter.length >= trail.length);
  const revertRows = trailAfter.filter((a) => a.reverses_id);
  record("R5", "each reversal points at the row it undid", true, revertRows.length >= reverted && reverted > 0);
  // A note is evidence: it must survive the revert sweep.
  const notesAfter = await getLeadNotes(LEAD);
  record("R6", "notes are append-only evidence and survive reversal", true, notesAfter.some((n) => n.id === note.id));

  console.log("\n--- 6b. AUDIT SPINE ---");
  console.table([
    { probe: "audit rows before QA", n: auditBefore },
    { probe: "audit rows after QA + reversals", n: trailAfter.length },
    { probe: "reversals applied", n: reverted },
    { probe: "reversals failed", n: revertFailed },
    { probe: "rows carrying reverses_id", n: revertRows.length },
    { probe: "notes surviving", n: notesAfter.length },
  ]);

  console.log("\n--- 6c. AUDIT TRAIL SAMPLE (newest first) ---");
  console.table(
    trailAfter.slice(0, 8).map((a) => ({
      action: a.action,
      field: a.field ?? "—",
      before: (a.before_value ?? "null").slice(0, 18),
      after: (a.after_value ?? "null").slice(0, 18),
      actor: a.actor,
      reverted: a.reverted_at ? "yes" : "—",
    })),
  );

  // -------------------------------------------------------------------
  console.log("\n" + "=".repeat(78));
  console.log("CHECK RESULTS");
  console.log("=".repeat(78));
  console.table(checks);
  const failed = checks.filter((c) => c.result === "FAIL");
  console.log(`\nTOTAL: ${checks.length} checks · ${checks.length - failed.length} PASS · ${failed.length} FAIL`);
  if (failed.length) { console.log("\nFAILURES:"); console.table(failed); }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
