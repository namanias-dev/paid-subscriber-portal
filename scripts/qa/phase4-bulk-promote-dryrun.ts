/**
 * PHASE 4e — bulk promotion DRY RUN. Prints projections; promotes nothing.
 *
 * There is no execute flag and no commented-out call to add one. The execution
 * path exists in `lib/legacy-crm/promote.ts` behind the same caps and typed
 * confirmation as bulk assignment, and it stays unexecuted until a human who
 * has read these numbers says otherwise.
 *
 *   node --import tsx --import ./scripts/_react-cache-shim.mjs \
 *        --env-file=.env.local scripts/qa/phase4-bulk-promote-dryrun.ts
 */

import { getSupabaseAdmin } from "../../lib/supabase";
import {
  dryRunBulkPromote, BULK_PROMOTE_MAX, PROMOTE_TYPED_CONFIRMATION_THRESHOLD,
  type BulkPromoteFilter,
} from "../../lib/legacy-crm/promote";

function pad(s: string | number, n: number, right = false) {
  const v = String(s);
  return right ? v.padStart(n) : v.padEnd(n);
}

async function run(label: string, filter: BulkPromoteFilter) {
  console.log("\n" + "-".repeat(72));
  console.log(`SEGMENT: ${label}`);
  console.log(JSON.stringify(filter));
  console.log("-".repeat(72));

  const dry = await dryRunBulkPromote({ filter });

  console.log(`  matched (capped at ${BULK_PROMOTE_MAX})   ${pad(dry.totalMatched, 8, true)}`);
  console.log(`  WOULD PROMOTE                  ${pad(dry.totalPromotable, 8, true)}`);
  console.log(`  already promoted (skipped)     ${pad(dry.totalAlreadyPromoted, 8, true)}`);
  console.log(`  BLOCKED — duplicate live lead  ${pad(dry.totalDuplicateBlocked, 8, true)}`);
  console.log(`  more matched beyond the cap    ${dry.capped ? "YES" : "no"}`);
  console.log(`  typed confirmation required    ${dry.requiresTypedConfirmation ? `YES  "${dry.confirmationPhrase}"` : "no"}`);

  if (dry.duplicateSamples.length) {
    console.log("\n  duplicate blocks (masked):");
    for (const d of dry.duplicateSamples.slice(0, 10)) {
      console.log(`    ${pad(d.maskedPhone, 14)} lead ${d.leadId}  ->  live ${d.existingLeadId}`);
    }
  }

  if (dry.perSourceTab.length) {
    console.log("\n  by source tab:");
    for (const s of dry.perSourceTab.slice(0, 12)) {
      console.log(`    ${pad(s.sourceTab, 44)} ${pad(s.count, 7, true)}`);
    }
    if (dry.perSourceTab.length > 12) {
      console.log(`    ... and ${dry.perSourceTab.length - 12} more tabs`);
    }
  }

  if (dry.perStatus.length) {
    console.log("\n  by frozen status:");
    for (const s of dry.perStatus) {
      console.log(`    ${pad(s.status, 44)} ${pad(s.count, 7, true)}`);
    }
  }

  for (const w of dry.warnings) console.log(`\n  ! ${w}`);

  console.log(`\n  ROLLBACK (if this were ever run):`);
  console.log(`    ${dry.rollbackCommand}`);
  return dry;
}

async function main() {
  console.log("=".repeat(72));
  console.log("PHASE 4e — BULK PROMOTION DRY RUN");
  console.log("=".repeat(72));
  console.log(`cap ${BULK_PROMOTE_MAX} per operation; typed confirmation above ${PROMOTE_TYPED_CONFIRMATION_THRESHOLD}`);
  console.log("NOTHING IS PROMOTED BY THIS SCRIPT.");

  const db = getSupabaseAdmin();
  if (!db) throw new Error("no service-role client");

  // What the segments actually look like, so the projection is read against
  // the real population rather than in isolation.
  const { data: tabs } = await db
    .from("leads").select("legacy_source_tab")
    .is("merged_into", null).eq("is_legacy", true).limit(1000);
  const tabCounts = new Map<string, number>();
  for (const r of (tabs as { legacy_source_tab: string | null }[] | null) ?? []) {
    const k = r.legacy_source_tab ?? "(none)";
    tabCounts.set(k, (tabCounts.get(k) ?? 0) + 1);
  }
  console.log(`\nsource tabs seen in a 1,000-row sample: ${tabCounts.size}`);

  const dryRuns = [] as Awaited<ReturnType<typeof run>>[];
  dryRuns.push(await run("Whole legacy set (oldest first, capped)", {}));

  const topTab = [...tabCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (topTab && topTab !== "(none)") {
    dryRuns.push(await run(`Single source tab: ${topTab}`, { sourceTab: topTab }));
  }

  dryRuns.push(await run("Status = Interested", { status: "Interested" }));

  console.log("\n" + "=".repeat(72));
  console.log("TOTALS ACROSS THE SEGMENTS PROJECTED ABOVE");
  console.log("=".repeat(72));
  console.log(`  would promote        ${pad(dryRuns.reduce((s, d) => s + d.totalPromotable, 0), 8, true)}`);
  console.log(`  duplicate blocked    ${pad(dryRuns.reduce((s, d) => s + d.totalDuplicateBlocked, 0), 8, true)}`);
  console.log(`  already promoted     ${pad(dryRuns.reduce((s, d) => s + d.totalAlreadyPromoted, 0), 8, true)}`);
  console.log("\nHALT. No bulk promotion has been executed.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
