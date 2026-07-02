/**
 * Byte-exact comparison of our welcome template vs the DLT-approved sheet body
 * for gateway template id 1707178280799637109. Compares the FIXED (non-variable)
 * text segments, since operators match the approved pattern with variables masked.
 *   node --import tsx scripts/compare-template-body.ts
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { SEED_TEMPLATES } from "../lib/sms/templates";

const XLSX_PATH = join(homedir(), "Downloads", "APPROVED SMS TEMPLATES.xlsx");
const GATEWAY_ID = "1707178280799637109";

const show = (s: string) => JSON.stringify(s);
/** Split a string into fixed segments around variable markers ({...} or {#var#}). */
function fixedSegments(s: string, varRe: RegExp): string[] {
  return s.split(varRe);
}
function hexdump(a: string, b: string) {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const ca = a[i], cb = b[i];
    if (ca !== cb) {
      console.log(`  first diff at index ${i}: ours=${show(ca ?? "<end>")} (${ca?.charCodeAt(0)}) vs approved=${show(cb ?? "<end>")} (${cb?.charCodeAt(0)})`);
      console.log(`    ours   …${show(a.slice(Math.max(0, i - 15), i + 15))}`);
      console.log(`    approv …${show(b.slice(Math.max(0, i - 15), i + 15))}`);
      return;
    }
  }
  console.log("  (no character difference)");
}

function main() {
  const wb = XLSX.read(readFileSync(XLSX_PATH));
  const rows: any[] = [];
  for (const name of wb.SheetNames) {
    for (const r of XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" }) as any[]) rows.push(r);
  }
  // Find the row whose any cell equals the gateway id.
  const row = rows.find((r) => Object.values(r).some((v) => String(v).replace(/\s/g, "") === GATEWAY_ID));
  if (!row) { console.log("Could not find approved row for", GATEWAY_ID, "\nHeaders seen:", Object.keys(rows[0] || {})); return; }
  console.log("Approved row keys:", Object.keys(row));
  // Pick the longest string cell as the body (heuristic), else print all cells.
  const bodyCell = Object.entries(row).map(([k, v]) => [k, String(v)] as [string, string]).sort((a, b) => b[1].length - a[1].length)[0];
  const approvedBody = bodyCell[1];
  console.log(`\nApproved body cell [${bodyCell[0]}]:\n  ${show(approvedBody)}`);

  const seed = SEED_TEMPLATES.find((t) => t.gateway_template_id === GATEWAY_ID);
  if (!seed) { console.log("No seed template with that gateway id."); return; }
  console.log(`\nOur template body [${seed.id}]:\n  ${show(seed.body)}`);

  // Compare fixed segments (mask variables on both sides).
  const ourFixed = fixedSegments(seed.body, /\{[^}]+\}/g);
  const apprFixed = fixedSegments(approvedBody, /\{#[^}]*#\}|\{[^}]+\}/g);
  console.log("\nFixed segments (ours):", JSON.stringify(ourFixed));
  console.log("Fixed segments (approved):", JSON.stringify(apprFixed));

  console.log("\nSegment-by-segment byte comparison:");
  const n = Math.max(ourFixed.length, apprFixed.length);
  let anyDiff = false;
  for (let i = 0; i < n; i++) {
    const a = ourFixed[i] ?? "<missing>";
    const b = apprFixed[i] ?? "<missing>";
    if (a === b) { console.log(`  [${i}] OK ${show(a)}`); continue; }
    anyDiff = true;
    console.log(`  [${i}] DIFF`);
    console.log(`      ours    : ${show(a)}`);
    console.log(`      approved: ${show(b)}`);
    hexdump(a, b);
  }
  console.log(anyDiff ? "\nRESULT: DISCREPANCY FOUND (see above)." : "\nRESULT: fixed text is BYTE-EXACT to the approved template.");
}

main();
