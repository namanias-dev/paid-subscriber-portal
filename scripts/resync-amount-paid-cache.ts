/**
 * Report amount_paid drift and optionally resync cache to fee-state.
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/resync-amount-paid-cache.ts
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/resync-amount-paid-cache.ts --write
 */
import { readFileSync, existsSync } from "fs";
import { countAmountPaidDrift, resyncAllAmountPaidCaches } from "../lib/amountPaidCache";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1]!.trim();
    let v = m[2]!.trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

async function main() {
  const write = process.argv.includes("--write");
  const before = await countAmountPaidDrift();
  console.log("DRIFT_BEFORE", before.drift, "checked", before.checked);
  console.log("SAMPLES", JSON.stringify(before.samples, null, 2));
  if (!write) {
    console.log("No --write — skip resync");
    return;
  }
  const res = await resyncAllAmountPaidCaches();
  console.log("RESYNC", res);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
