/**
 * Remove the one QA note Phase 2 left on a real legacy lead.
 *
 * Written by `qa_phase2_harness` at 2026-07-25T20:25:33Z while verifying the
 * note path. Everything else that run touched was reverted; notes are
 * append-only so there was no revert path for this one.
 *
 * Goes through `retractLeadNote`, not a raw DELETE, so the audit trail records
 * that a note existed and was pulled, by whom, and why. A counsellor opening
 * that lead should not find a test note in a real person's history — and should
 * not find an unexplained gap either.
 *
 *   node --import tsx --import ./scripts/_react-cache-shim.mjs \
 *        --env-file=.env.local scripts/qa/retract-phase2-qa-note.ts
 */

import { getSupabaseAdmin } from "../../lib/supabase";
import { retractLeadNote } from "../../lib/legacy-crm/writes";

const EXPECTED_AUTHOR = "qa_phase2_harness";

async function main() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("no service-role client");

  const { data, error } = await db
    .from("lead_notes")
    .select("id, lead_id, author, body, created_at");
  if (error) throw new Error(`could not read lead_notes: ${error.message}`);
  const notes = (data as { id: string; lead_id: string; author: string | null; body: string }[] | null) ?? [];

  console.log(`lead_notes currently holds ${notes.length} row(s)`);
  if (!notes.length) { console.log("nothing to do"); return; }

  // Only ever touch QA residue. A real counsellor note reaching this script is
  // a stop condition, not something to clean up.
  const foreign = notes.filter((n) => n.author !== EXPECTED_AUTHOR);
  if (foreign.length) {
    console.log(`REFUSING: ${foreign.length} note(s) not authored by ${EXPECTED_AUTHOR}`);
    for (const n of foreign) console.log(`  ${n.id} author=${n.author}`);
    process.exitCode = 1;
    return;
  }

  for (const n of notes) {
    const res = await retractLeadNote({
      noteId: n.id,
      actor: { id: "operator:phase2-cleanup", name: "Phase 2 cleanup" },
      reason:
        "QA harness note written against a real legacy lead during Phase 2 " +
        "verification. Not a counsellor observation; removed so the lead's " +
        "history contains only genuine contact records.",
    });
    console.log(`retracted ${n.id} from lead ${res.leadId}`);
  }

  const { count } = await db
    .from("lead_notes").select("id", { count: "exact", head: true });
  console.log(`\nlead_notes now holds ${count ?? 0} row(s)`);
  if ((count ?? 0) !== 0) process.exitCode = 1;

  const { count: auditCount } = await db
    .from("lead_worklist_audit").select("id", { count: "exact", head: true })
    .eq("action", "note_retract");
  console.log(`audit rows recording the retraction: ${auditCount ?? 0}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
