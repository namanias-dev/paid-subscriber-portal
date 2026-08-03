/**
 * One-off debug validation of the Measurement Protocol payment_success shape.
 * Does NOT send a live event. Usage:
 *   npx tsx --env-file=.env.local scripts/debug-ga4-mp.ts
 * Or with Vercel env: npx vercel env run --environment production -- npx tsx scripts/debug-ga4-mp.ts
 */
import { debugGa4MpPayload } from "../lib/analytics/ga4mp";

async function main() {
  const payload = {
    client_id: "1234567890.0987654321",
    events: [
      {
        name: "payment_success",
        params: {
          value: 50,
          currency: "INR",
          transaction_id: "NAMAN-WEBINAR-DEBUG-SHAPE",
          product_type: "webinar",
          engagement_time_msec: 1,
        },
      },
    ],
  };
  const res = await debugGa4MpPayload(payload);
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
