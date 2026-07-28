/**
 * Reconcile the live `installment_instructions` row with the code seed and prove
 * the wire body is byte-identical to the approved DLT registration.
 *
 * WHY THIS IS NEEDED. The row was created through the admin UI with the login URL
 * as a `{login_url}` variable. That renders to the same text today, but it is a
 * variable in a registration that has none — so a change to the login-url config
 * would silently push the wire body out of step with the approved content, which
 * the provider rejects or garbles. `ensureSeeded` is the existing, idempotent
 * mechanism for exactly this: it heals an approved seed's body and DLT id back to
 * the values in code without touching the admin-controlled active/status flags.
 *
 * Read-mostly and safe to re-run.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/_react-cache-shim.mjs \
 *     scripts/qa-heal-instructions-template.mts
 */
import { ensureSeeded, getTemplate } from "../lib/sms/store";
import { buildFollowUpPreview } from "../lib/sms/installmentFollowUp";

const APPROVED =
  "To pay your installment, login: https://www.namanias.com/login. Open Course Card > View & Pay > select Installment > Pay. Confirmation will follow. Naman Sharma IAS Academy.";

const before = await getTemplate("installment_instructions");
console.log("BEFORE  body:", JSON.stringify(before?.body_template));
console.log("BEFORE  vars:", JSON.stringify(before?.variables), "| status:", before?.status, "| active:", before?.is_active);

await ensureSeeded();

const after = await getTemplate("installment_instructions");
console.log("\nAFTER   body:", JSON.stringify(after?.body_template));
console.log("AFTER   vars:", JSON.stringify(after?.variables), "| status:", after?.status, "| active:", after?.is_active);
console.log("AFTER   sender:", after?.sender_id, "| route:", after?.route, "| DLT:", after?.gateway_template_id);
console.log("stored body byte-identical to approved registration:", after?.body_template === APPROVED);

const p = await buildFollowUpPreview();
console.log("\nPREVIEW body:", JSON.stringify(p.body));
console.log(
  "preview byte-identical:", p.body === APPROVED,
  "| sendable:", p.sendable,
  "| segments:", p.segments,
  "| chars:", p.characterCount,
  "| DLT:", p.dltTemplateId,
  "| delay:", `${p.delayMinutes}m`,
);
if (p.body !== APPROVED || !p.sendable) process.exit(1);
