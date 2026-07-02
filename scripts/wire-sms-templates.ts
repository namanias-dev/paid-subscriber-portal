/**
 * One-off: run the SMS seed reconciliation against the LIVE DB so the approved
 * DLT template ids + bodies from code are written to sms_templates. Uses the SAME
 * ensureSeeded() the app uses — no parallel logic. Read-then-heal; idempotent.
 *   node --env-file=.env.local --import tsx scripts/wire-sms-templates.ts
 */
import { ensureSeeded, listTemplates } from "../lib/sms/store";

async function main() {
  console.log("Reconciling SMS templates (ensureSeeded)…");
  await ensureSeeded();
  const templates = await listTemplates();
  const approved = templates.filter((t) => t.gateway_template_id);
  const unapproved = templates.filter((t) => !t.gateway_template_id);
  console.log(`\nDLT-approved & send-ready (${approved.length}):`);
  for (const t of approved) {
    console.log(`  ${t.id.padEnd(24)} id=${t.gateway_template_id}  status=${t.status}  active=${t.is_active}`);
  }
  console.log(`\nNOT approved — cannot send (${unapproved.length}):`);
  for (const t of unapproved) console.log(`  ${t.id}`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
