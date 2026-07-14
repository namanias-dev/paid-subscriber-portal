/**
 * Verify + report the DRAFT SMS templates: char count (<=150), brand present,
 * variable-map matches body, and the whitelisted URL each uses. Prints a table
 * and exits non-zero if any draft fails a hard rule.
 *
 * Run: npx tsx scripts/verify-dlt-drafts.ts
 */
import { DRAFT_SMS_TEMPLATES, checkDraft, DRAFT_CHAR_LIMIT } from "../lib/journey-automation/draftTemplates";

function main() {
  let failures = 0;
  console.log(`\nDRAFT DLT templates (limit ${DRAFT_CHAR_LIMIT} chars, brand required):\n`);
  for (const t of DRAFT_SMS_TEMPLATES) {
    const c = checkDraft(t);
    if (!c.ok) failures++;
    console.log(`• ${c.template_key}`);
    console.log(`    chars=${c.chars} (${c.withinLimit ? "OK" : "OVER"})  brand=${c.hasBrand ? "yes" : "MISSING"}  map=${c.mapMatchesBody ? "OK" : "MISMATCH"}`);
    console.log(`    login_url -> ${c.loginUrl}`);
    console.log(`    vars: ${c.bodyVariables.join(", ")}`);
    console.log(`    body: ${t.body}`);
  }
  console.log(`\n${failures === 0 ? "ALL DRAFTS PASS" : `${failures} DRAFT(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
