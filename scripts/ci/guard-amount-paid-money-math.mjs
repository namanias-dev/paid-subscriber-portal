#!/usr/bin/env node
/**
 * CI guard: fail if new money-math reads of course_enrollments.amount_paid appear.
 * Existence gates (amount_paid > 0 / == 0 / != null) are allowed.
 *
 * Run: node scripts/ci/guard-amount-paid-money-math.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const SCAN_DIRS = ["app", "lib", "components"];

const ALLOWLIST = new Set([
  "lib/amountPaidCache.ts",
  "lib/types.ts",
  "lib/enrollmentFeeState.ts",
  "lib/dataProvider.ts",
  "lib/studentTimeline.ts", // historical plan-change audit rows, not live fee math
  "scripts/ci/guard-amount-paid-money-math.mjs",
]);

const MONEY_MATH = [
  /total_fee\s*[-+]\s*[^\n;]*amount_paid/,
  /amount_paid\s*[-+]\s*[^\n;]*total_fee/,
  /\(\s*[^)]*amount_paid[^)]*\)\s*\/\s*[^;\n]*total_fee/,
  /100\s*\*\s*\([^)]*amount_paid/,
  /\(\s*100\s*\*\s*[^)]*amount_paid/,
  /Math\.max\(\s*0\s*,\s*[^)]*total_fee[^)]*amount_paid/,
  /e\.amount_paid\s*[*/+-]/,
  /enrollment\.amount_paid\s*[*/+-]/,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".tmp") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const failures = [];
for (const d of SCAN_DIRS) {
  const abs = join(ROOT, d);
  try {
    for (const file of walk(abs)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (ALLOWLIST.has(rel)) continue;
      const src = readFileSync(file, "utf8");
      if (!src.includes("amount_paid")) continue;
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!line.includes("amount_paid")) return;
        if (/amount_paid\s*[><=!]=?\s*0/.test(line)) return;
        for (const re of MONEY_MATH) {
          if (re.test(line)) {
            failures.push(`${rel}:${i + 1}: ${line.trim()}`);
            break;
          }
        }
      });
    }
  } catch {
    /* missing dir */
  }
}

if (failures.length) {
  console.error("FAIL: money-math amount_paid reads:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("OK: no money-math amount_paid reads outside allowlist");
