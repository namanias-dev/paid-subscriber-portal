/**
 * READ-ONLY watcher: follow one batch of scheduled instructions through the
 * production cron drain, recording every state transition so it can be shown that
 * each job moved exactly once.
 *
 *   CAMPAIGN=<original campaign id> node --env-file=.env.local --import tsx \
 *     --import ./scripts/_react-cache-shim.mjs scripts/qa-watch-followup-drain.mts
 */
import { getSupabaseAdmin } from "../lib/supabase";

const db = getSupabaseAdmin();
if (!db) throw new Error("no service-role client");

const jobId = `retry:${process.env.CAMPAIGN ?? "0f4dcc21-9ed3-458e-86af-143c4fbbab04"}`;
const mask = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)}******${d.slice(-2)}` : "—";
};
const ist = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso)) : "—";

const TERMINAL = new Set(["sent", "cancelled", "failed"]);
/** id -> ordered list of statuses seen, so a job that flapped is visible. */
const history = new Map<string, string[]>();

console.log(`watching ${jobId} — polling every 20s until every job is terminal\n`);

for (let tick = 0; tick < 150; tick++) {
  const { data: jobs } = await db
    .from("sms_scheduled_sends")
    .select("id, normalized_mobile, status, attempts, scheduled_at, claimed_at, finished_at, sent_log_id, cancel_reason, last_error")
    .eq("job_id", jobId);

  if (!jobs?.length) { console.log("no jobs found for this id"); process.exit(1); }

  for (const j of jobs) {
    const seen = history.get(j.id) ?? [];
    if (seen[seen.length - 1] !== j.status) {
      seen.push(j.status);
      history.set(j.id, seen);
      if (seen.length > 1) {
        const detail = j.sent_log_id ? `log ${j.sent_log_id.slice(0, 8)}…` : j.cancel_reason ?? j.last_error ?? "";
        console.log(`  ${new Date().toISOString().slice(11, 19)}Z  ${mask(j.normalized_mobile)}  ${seen[seen.length - 2]} -> ${j.status}  attempt ${j.attempts}  ${detail}`);
      }
    }
  }

  const terminal = jobs.filter((j) => TERMINAL.has(j.status));
  if (terminal.length === jobs.length) {
    console.log(`\nall ${jobs.length} jobs terminal after ${((tick * 20) / 60).toFixed(1)} min of watching\n`);
    console.log("=".repeat(84));
    console.log("TRANSITION HISTORY — one move per job is the requirement");
    console.log("=".repeat(84));
    let flapped = 0, multiAttempt = 0;
    for (const j of jobs.sort((a, b) => a.normalized_mobile.localeCompare(b.normalized_mobile))) {
      const seen = history.get(j.id) ?? [];
      // The watcher may not observe an intermediate 'claimed' between two polls,
      // so the authority on "exactly once" is the attempt counter plus a single
      // terminal state, not the number of statuses this loop happened to catch.
      const moves = seen.filter((s) => TERMINAL.has(s)).length;
      if (moves > 1) flapped++;
      if (j.attempts > 1) multiAttempt++;
      console.log(
        `  ${mask(j.normalized_mobile)}  due ${ist(j.scheduled_at)}  claimed ${ist(j.claimed_at)}  finished ${ist(j.finished_at)}  ` +
        `attempts ${j.attempts}  path: ${seen.join(" -> ")}`,
      );
    }
    console.log(`\n  jobs that reached more than one terminal state : ${flapped} ${flapped === 0 ? "— PASS" : "<-- DOUBLE TRANSITION"}`);
    console.log(`  jobs that needed more than one attempt        : ${multiAttempt}`);

    const sent = jobs.filter((j) => j.status === "sent");
    const logs = new Set(sent.map((j) => j.sent_log_id));
    console.log(`  sent ${sent.length} · distinct send logs ${logs.size} ${sent.length === logs.size ? "— one message each" : "<-- DUPLICATE LOG REUSE"}`);

    const { data: instr } = await db
      .from("sms_logs")
      .select("mobile, status, error_message, created_at")
      .eq("template_id", "installment_instructions")
      .order("created_at");
    console.log(`\n  instructions messages in the log: ${instr?.length ?? 0}`);
    for (const l of instr ?? []) {
      console.log(`    ${ist(l.created_at)} IST  ${mask(l.mobile)}  ${l.status}${l.error_message ? `  ${l.error_message}` : ""}`);
    }
    process.exit(0);
  }

  if (tick % 6 === 0) {
    const counts = jobs.reduce<Record<string, number>>((a, j) => ((a[j.status] = (a[j.status] ?? 0) + 1), a), {});
    const first = jobs[0]?.scheduled_at;
    const mins = first ? (new Date(first).getTime() - Date.now()) / 60000 : 0;
    console.log(`  ${new Date().toISOString().slice(11, 19)}Z  ${JSON.stringify(counts)}  ${mins > 0 ? `due in ${mins.toFixed(1)}m` : `due ${Math.abs(mins).toFixed(1)}m ago`}`);
  }
  await new Promise((r) => setTimeout(r, 20_000));
}

console.log("\ngave up waiting — jobs did not all reach a terminal state");
process.exit(1);
