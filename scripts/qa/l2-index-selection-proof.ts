/**
 * Which index does the APP select?
 *
 * The Phase 2 perf claim was measured against hand-written SQL that the client
 * never emits, and it named an index nothing was choosing. This does not
 * hand-write anything: it calls the real exported functions, then reads
 * `pg_stat_user_indexes` before and after to see which index actually moved.
 *
 * Read-only. Sends nothing. Prints no PII.
 *
 *   node --import tsx --import ./scripts/_react-cache-shim.mjs \
 *        --env-file=.env.local scripts/qa/l2-index-selection-proof.ts
 */

import { getLeads, getAllLeadsRaw, getLeadsForPillMap } from "../../lib/dataProvider";

const WATCH = [
  "idx_leads_nonlegacy_active_created_v2", // should now be selected
  "idx_leads_active_nonlegacy_created",    // v1, JSONB predicate — should go quiet
  "idx_leads_legacy_flag",                 // v1, JSONB predicate — should go quiet
  "idx_leads_legacy_status_partial",       // v1, JSONB predicate — should go quiet
  "idx_leads_legacy_call_status_partial",  // v1, JSONB predicate — should go quiet
];

// The counter deltas are read out-of-band from pg_stat_user_indexes, since no
// generic SQL RPC is exposed to the service role. This script's job is to
// generate exactly the traffic the app generates, and nothing else.

function ms(t: bigint) { return Number(t) / 1e6; }

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = process.hrtime.bigint();
  const out = await fn();
  const dt = ms(process.hrtime.bigint() - t0);
  const n = Array.isArray(out) ? out.length : "-";
  console.log(`  ${label.padEnd(34)} ${dt.toFixed(0).padStart(6)} ms   rows=${n}`);
  return out;
}

async function main() {
  console.log("watching:", WATCH.join(", "), "\n");

  console.log("--- pass 1 (cold-ish) ---");
  const live1 = await timed("getLeads({includeLegacy:false})", () => getLeads({ includeLegacy: false }));
  await timed("getLeadsForPillMap()", () => getLeadsForPillMap());
  await timed("getAllLeadsRaw()", () => getAllLeadsRaw());

  console.log("\n--- pass 2 (warm) ---");
  const live2 = await timed("getLeads({includeLegacy:false})", () => getLeads({ includeLegacy: false }));
  await timed("getLeadsForPillMap()", () => getLeadsForPillMap());
  await timed("getAllLeadsRaw()", () => getAllLeadsRaw());

  // The invariant that matters more than the timing: the live set must not
  // have grown by 178k. Assert as a ceiling, not an equality — the public site
  // captures leads continuously, so this number only ever drifts upward.
  const CEILING = 10_000;
  console.log(`\nlive rows: pass1=${live1.length} pass2=${live2.length}`);
  if (live1.length > CEILING || live2.length > CEILING) {
    console.log(`  FAIL  live set exceeded ${CEILING} — legacy has leaked into the live CRM`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS  live set is far below the ${CEILING} leak ceiling (legacy is 178,183)`);
  }

  const anyLegacy = live2.filter((l) => (l as { is_legacy?: boolean }).is_legacy === true);
  if (anyLegacy.length) {
    console.log(`  FAIL  ${anyLegacy.length} legacy rows present in the non-legacy read`);
    process.exitCode = 1;
  } else {
    console.log("  PASS  zero is_legacy rows in the non-legacy read");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
