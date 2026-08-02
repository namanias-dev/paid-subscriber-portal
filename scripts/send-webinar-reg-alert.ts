/**
 * One-shot: post a webinar-registration Telegram alert for a known registration.
 * Usage: npx tsx --require ./scripts/react-cache-shim.cjs scripts/send-webinar-reg-alert.ts [registrationId]
 */
import { alertWebinarRegistration } from "../lib/telegram/reports/alerts";
import { getAllWebinarRegistrations, getWebinars } from "../lib/dataProvider";

const AJAY_REG_ID = "74c5f849-9195-4fa0-964c-dc6e71a508ce";

async function main() {
  const id = process.argv[2] || AJAY_REG_ID;
  const [regs, webs] = await Promise.all([getAllWebinarRegistrations(), getWebinars()]);
  const reg = regs.find((r) => r.id === id);
  if (!reg) {
    console.error("registration_not_found", id);
    process.exit(1);
  }
  const w = webs.find((x) => x.id === reg.webinar_id);
  const count = regs.filter((r) => r.webinar_id === reg.webinar_id).length;
  const ok = await alertWebinarRegistration({
    webinarId: reg.webinar_id,
    name: reg.name || "Student",
    phone: reg.phone,
    webinarTitle: w?.title || null,
    webinarSlug: w?.slug || null,
    webinarAt: w?.datetime || null,
    price: w?.price ?? null,
    regCount: count,
    registeredAt: reg.created_at,
  });
  console.log(JSON.stringify({ ok, id: reg.id, name: reg.name, webinar: w?.title, count }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
