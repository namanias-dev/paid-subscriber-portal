/**
 * Local dry-run helper for sales today seed (no Telegram send).
 * Usage: npx tsx --require ./scripts/react-cache-shim.cjs scripts/sales-seed-today.ts [--confirm]
 */
import { runSalesTodaySeed } from "../lib/telegram/sales/seed";

async function main() {
  const confirm = process.argv.includes("--confirm");
  const result = await runSalesTodaySeed({ dryRun: !confirm, confirm });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
