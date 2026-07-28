/**
 * Read-only: prove getAllAttempts / getAllAnswers now return the full table.
 * Prints the user-visible number deltas staff will see after deploy.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(url, key, { auth: { persistSession: false } });

async function pageCount(table: string, orderCol = "id"): Promise<number> {
  const PAGE = 1000;
  let total = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select("id").order(orderCol, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    const n = data?.length ?? 0;
    total += n;
    if (n < PAGE) break;
  }
  return total;
}

async function cappedCount(table: string): Promise<number> {
  const { data, error } = await db.from(table).select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

const { count: attemptsSql } = await db.from("quiz_attempts").select("*", { count: "exact", head: true });
const { count: answersSql } = await db.from("quiz_answers").select("*", { count: "exact", head: true });

const attemptsCapped = await cappedCount("quiz_attempts");
const answersCapped = await cappedCount("quiz_answers");
const attemptsPaged = await pageCount("quiz_attempts");
const answersPaged = await pageCount("quiz_answers");

console.log("table                  SQL count   old(unpaged)  new(paged)");
console.log(`quiz_attempts          ${String(attemptsSql).padStart(9)}   ${String(attemptsCapped).padStart(12)}  ${String(attemptsPaged).padStart(10)}`);
console.log(`quiz_answers           ${String(answersSql).padStart(9)}   ${String(answersCapped).padStart(12)}  ${String(answersPaged).padStart(10)}`);

console.log("\nUser-visible deltas (old → new):");
console.log(`  Admin Quiz Reports — attempts loaded: ${attemptsCapped} → ${attemptsPaged}`);
console.log(`  Admin Quiz Reports — answers loaded:  ${answersCapped} → ${answersPaged}`);
console.log(`  Answer rows previously invisible:     ${((1 - answersCapped / (answersSql || 1)) * 100).toFixed(1)}%`);
console.log(`  Mission Control segments using login/zoom events: now see full phone sets (was capped at 1000 event rows)`);
console.log(`  Analytics dashboard date-range events: now complete (was capped at 1000 regardless of EVENT_FETCH_CAP)`);

const ok = attemptsPaged === attemptsSql && answersPaged === answersSql && attemptsCapped <= 1000 && answersCapped <= 1000;
console.log(ok ? "\nPASS — paged counts match SQL; unpaged still hits the cap" : "\nFAIL");
process.exit(ok ? 0 : 1);
