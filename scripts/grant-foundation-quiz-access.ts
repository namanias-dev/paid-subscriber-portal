/**
 * Grant PAID-QUIZ access to all Safalta + Saarthi students.
 *
 * Access is enrollment-driven via the course↔quiz mapping (see lib/entitlements.ts):
 * a paid enrollee is entitled to a paid quiz iff their course id is in the quiz's
 * access_rules.allowed_course_ids. So the "grant" = union the foundation
 * (Safalta/Saarthi) course IDs into every PAID quiz's allowed_course_ids. This
 * covers every CURRENT and FUTURE paid enrollee of those courses automatically,
 * and never clears is_lead (is_lead does not gate quizzes).
 *
 * IDEMPOTENT (set union — re-running adds nothing new). SCOPE-LIMITED (only paid
 * quizzes; only foundation course IDs added; no student or other course touched).
 * Per-quiz failures are logged and do NOT abort the run.
 *
 * DRY-RUN by default. Pass --commit to write.
 *   node --env-file=.env.local --import tsx scripts/grant-foundation-quiz-access.ts
 *   node --env-file=.env.local --import tsx scripts/grant-foundation-quiz-access.ts --commit
 */
import {
  getAllQuizzes,
  getAllCourses,
  isFoundationCourse,
  updateQuiz,
} from "../lib/dataProvider";
import { getSupabaseAdmin } from "../lib/supabase";

async function main() {
  const commit = process.argv.includes("--commit");
  console.log("=".repeat(88));
  console.log(`  GRANT PAID-QUIZ ACCESS — Safalta + Saarthi   ${commit ? ">>> COMMIT (WRITES) <<<" : "DRY-RUN (writes nothing)"}`);
  console.log("=".repeat(88));

  if (commit && !getSupabaseAdmin()) {
    console.error("✗ --commit needs Supabase creds in env. Aborting (nothing written).");
    process.exit(1);
  }

  const [quizzes, courses] = await Promise.all([getAllQuizzes(), getAllCourses()]);
  const foundation = courses.filter(isFoundationCourse);
  const foundationIds = foundation.map((c) => c.id);

  console.log(`\nFoundation (Safalta/Saarthi) courses: ${foundation.length}`);
  for (const c of foundation) console.log(`  • ${c.slug}  (${c.id})  status=${c.status}`);

  const paid = quizzes.filter((q) => q.requires_payment === true);
  console.log(`\nPaid quizzes found: ${paid.length}  (of ${quizzes.length} total)`);
  if (!foundationIds.length) {
    console.error("✗ No foundation courses found — nothing to grant. Aborting.");
    process.exit(1);
  }

  let changed = 0, unchanged = 0, failed = 0;
  for (const q of paid) {
    try {
      const existing = q.access_rules?.allowed_course_ids || [];
      const missing = foundationIds.filter((id) => !existing.includes(id));
      if (!missing.length) {
        unchanged++;
        console.log(`\n  = ${q.title}\n      already mapped (no change).`);
        continue;
      }
      const merged = [...new Set([...existing, ...foundationIds])];
      console.log(`\n  ${commit ? "✓" : "→"} ${q.title}`);
      console.log(`      current allowed_course_ids: ${existing.length}`);
      console.log(`      adding: ${missing.join(", ")}`);
      console.log(`      result allowed_course_ids: ${merged.length}`);
      if (commit) {
        const res = await updateQuiz(q.id, { access_rules: { ...(q.access_rules || {}), allowed_course_ids: merged } });
        if (!res) throw new Error("updateQuiz returned null");
      }
      changed++;
    } catch (e) {
      failed++;
      console.error(`  ✗ FAILED for quiz "${q.title}" (${q.id}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log("\n" + "-".repeat(88));
  console.log(`SUMMARY: ${changed} ${commit ? "updated" : "would update"} · ${unchanged} already-mapped · ${failed} failed · ${paid.length} paid quizzes`);
  console.log("-".repeat(88));
  if (!commit) {
    console.log("DRY-RUN COMPLETE — nothing written. Re-run with --commit to apply.");
  } else {
    console.log("COMMIT COMPLETE.");
  }
}

main().catch((e) => {
  console.error("✗ Fatal:", e);
  process.exit(1);
});
