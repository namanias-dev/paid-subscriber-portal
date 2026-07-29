/**
 * Prod-data dry-run for the Aug webinar abandoned_nudge audience.
 * Uses the SAME resolveAudience + prepareAndRenderSms path as Mission Control.
 * Sends NOTHING.
 *
 *   npx tsx scripts/qa/dryrun-aug-webinar-25.ts
 */
import { resolveAudience } from "../../lib/sms/audiences";
import { mergeSendVars } from "../../lib/sms/service";
import { prepareAndRenderSms } from "../../lib/sms/renderPipeline";
import { getTemplate } from "../../lib/sms/store";
import { getResolvedDefaults } from "../../lib/sms/variables";
import { getWebinarBySlug } from "../../lib/dataProvider";

const SLUG = "upsc-full-masterclass-by-naman-sir-01-august-2026";
const TEMPLATE = "abandoned_nudge";
const FULL = "UPSC Full Masterclass By Naman Sir - 01 August 2026";

async function main() {
  const webinar = await getWebinarBySlug(SLUG);
  console.log("\n=== WEBINAR ===");
  console.table([{
    title: webinar?.title,
    title_len: webinar ? [...webinar.title].length : null,
    sms_short_title: webinar?.sms_short_title,
    short_len: webinar?.sms_short_title ? [...webinar.sms_short_title].length : null,
  }]);

  const recipients = await resolveAudience({
    type: "filtered",
    filters: { webinarSlug: SLUG, paymentStatus: "notpaid" },
  });
  console.log(`\n=== AUDIENCE count=${recipients.length} ===`);

  const tpl = await getTemplate(TEMPLATE);
  if (!tpl) throw new Error("template missing");
  const defaults = await getResolvedDefaults(TEMPLATE);

  const rows: Record<string, unknown>[] = [];
  let previewEqSend = 0;
  let over50 = 0;
  let hasFull = 0;

  for (const r of recipients) {
    const merged = mergeSendVars(TEMPLATE, defaults, r.vars);
    const preview = prepareAndRenderSms(tpl.body_template, TEMPLATE, merged);
    const send = prepareAndRenderSms(tpl.body_template, TEMPLATE, merged);
    const item = String(preview.vars.item_short || "");
    const itemLen = [...item].length;
    if (preview.text === send.text) previewEqSend++;
    if (itemLen > 50) over50++;
    if (item.includes(FULL) || preview.text.includes(FULL)) hasFull++;
    rows.push({
      student: r.name || "—",
      mobile: r.normalized,
      item_short: item,
      item_len: itemLen,
      chars: preview.length,
      segments: preview.segments,
      encoding: preview.gsm ? "GSM-7" : "UCS-2",
      preview_eq_send: preview.text === send.text,
      ok: preview.ok,
    });
  }

  console.table(rows);
  console.log("\n=== ASSERTIONS ===");
  console.table([{
    recipients: recipients.length,
    preview_eq_send: `${previewEqSend}/${recipients.length}`,
    over_50: over50,
    has_full_title: hasFull,
    PASS: over50 === 0 && hasFull === 0 && previewEqSend === recipients.length,
  }]);

  // Worst-case template matrix (real store overrides where present)
  const samples: { id: string; vars: Record<string, string> }[] = [
    { id: "abandoned_nudge", vars: { first_name: "AsharXXXXXXXX", item_short: FULL, login_url: "https://www.namanias.com/login", login_code: "ABCDEFGH" } },
    { id: "payment_successful", vars: { first_name: "AsharXXXXXXXX", item_short: FULL, login_url: "https://www.namanias.com/login", login_code: "ABCDEFGH" } },
    { id: "payment_failed", vars: { first_name: "AsharXXXXXXXX", item_short: FULL, login_url: "https://www.namanias.com/login", login_code: "ABCDEFGH" } },
    { id: "welcome_first_login", vars: { first_name: "AsharXXXXXXXX", item_short: FULL, login_url: "https://www.namanias.com/login", login_code: "ABCDEFGH" } },
    { id: "access_approved", vars: { first_name: "AsharXXXXXXXX", item_short: FULL, login_url: "https://www.namanias.com/login", login_code: "ABCDEFGH" } },
  ];

  console.log("\n=== TEMPLATE WORST-CASE (prod store + pipeline) ===");
  const tRows: Record<string, unknown>[] = [];
  for (const s of samples) {
    const t = await getTemplate(s.id);
    if (!t) { tRows.push({ template: s.id, status: "MISSING" }); continue; }
    const d = await getResolvedDefaults(s.id);
    const merged = mergeSendVars(s.id, d, s.vars);
    const rendered = prepareAndRenderSms(t.body_template, s.id, merged);
    const item = String(rendered.vars.item_short || "");
    tRows.push({
      template: s.id,
      item_short: item,
      item_len: [...item].length,
      chars: rendered.length,
      segments: rendered.segments,
      encoding: rendered.gsm ? "GSM-7" : "UCS-2",
      ok: rendered.ok,
      store_override: s.id in d || "item_short" in d ? (d.item_short || "—") : "—",
    });
  }
  console.table(tRows);
}

main().catch((e) => { console.error(e); process.exit(1); });
