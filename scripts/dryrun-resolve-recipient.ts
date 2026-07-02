/**
 * READ-ONLY dry-run of the REAL recipient-resolution path (Issue 2). Shows the
 * exact name + login_code the production send path would bind to a number, using
 * the SAME resolveAudience() + previewSms() the app uses. Sends NOTHING.
 *   node --env-file=.env.local --import tsx scripts/dryrun-resolve-recipient.ts [mobile]
 */
import { resolveAudience } from "../lib/sms/audiences";
import { resolveBuyerByPhone } from "../lib/sms/store";
import { previewSms } from "../lib/sms/service";
import { normalizeIndianMobile } from "../lib/phone";

const MOBILE = process.argv[2] || "9988791797";
const TEMPLATE = "welcome_first_login";

async function main() {
  const n = normalizeIndianMobile(MOBILE);
  const digits = n.digits10 || MOBILE;
  console.log(`Dry-run recipient resolution for ${MOBILE} (normalized ${digits})\n`);

  // 1) Raw identity resolution (fail-closed check).
  const buyer = await resolveBuyerByPhone(digits);
  console.log("resolveBuyerByPhone:", JSON.stringify(buyer));
  if (buyer.status === "ambiguous") console.log("  -> AMBIGUOUS: multiple buyers share this number; login_code will be WITHHELD.");
  if (buyer.status === "none") console.log("  -> No buyer on this number; login_code will be empty (code-bearing templates fail-closed).");

  // 2) The real audience path used by manual/bulk sends ("A specific person").
  const recips = await resolveAudience({ type: "person", mobile: MOBILE });
  const r = recips[0];
  console.log("\nresolveAudience({type:'person'}) ->");
  console.log("  name (addressed as):", r?.name ?? "(none)");
  console.log("  login_code (bound):  ", r?.vars?.login_code || "(withheld/empty)");

  // 3) What the Welcome/First-Login SMS would actually render.
  const preview = await previewSms(TEMPLATE, r?.vars || {});
  console.log("\nWould send (template welcome_first_login):");
  console.log("  ok:", preview?.ok, "| missing:", preview?.missing);
  console.log("  body:", preview?.text);
  console.log("\nNOTHING WAS SENT.");
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
