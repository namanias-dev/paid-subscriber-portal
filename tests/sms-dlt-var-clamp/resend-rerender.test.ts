import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prepareAndRenderSms } from "../../lib/sms/renderPipeline";
import { mergeSendVars } from "../../lib/sms/service";

const root = join(import.meta.dirname, "..", "..");
const FULL = "UPSC Full Masterclass By Naman Sir - 01 August 2026";
const SHORT = "UPSC Masterclass by Naman Sir - 01 Aug 2026";
const BODY =
  "Hi {first_name}, your payment for the course fee of {item_short} is pending. Login: {login_url} Code: {login_code} to complete payment. Naman Sharma IAS Academy.";

describe("resend must not replay stored 51-char bodies", () => {
  test("service.ts wires resolveResendMessage (not raw message_body to gateway)", () => {
    const src = readFileSync(join(root, "lib/sms/service.ts"), "utf8");
    assert.match(src, /resolveResendMessage/);
    // The gateway call inside resendCampaignFailed must use body.text, not l.message_body.
    const start = src.indexOf("export async function resendCampaignFailed");
    const end = src.indexOf("export async function retryLog", start);
    assert.ok(start > 0 && end > start);
    const block = src.slice(start, end);
    assert.match(block, /message:\s*body\.text/);
    assert.ok(!/message:\s*l\.message_body/.test(block), "must not send stored body");
  });

  test("retryLog also re-renders via resolveResendMessage", () => {
    const src = readFileSync(join(root, "lib/sms/service.ts"), "utf8");
    const start = src.indexOf("export async function retryLog");
    const block = src.slice(start, start + 1200);
    assert.match(block, /resolveResendMessage/);
    assert.match(block, /message:\s*body\.text/);
    assert.ok(!/message:\s*log\.message_body/.test(block));
  });

  test("preview string === send string for the Aug title (shared pipeline)", () => {
    const merged = mergeSendVars("abandoned_nudge", {}, {
      first_name: "Faika",
      item_short: FULL,
      login_url: "https://www.namanias.com/login",
      login_code: "TESTCODE",
    });
    const preview = prepareAndRenderSms(BODY, "abandoned_nudge", merged);
    const send = prepareAndRenderSms(BODY, "abandoned_nudge", merged);
    assert.equal(preview.text, send.text);
    assert.equal(String(preview.vars.item_short), SHORT);
    assert.equal([...String(preview.vars.item_short)].length, 43);
    assert.ok(!preview.text.includes(FULL));
    assert.ok(preview.text.includes(SHORT));
  });

  test("stored 51-char body would differ from fresh render (the trap)", () => {
    const stored =
      `Hi Faika, your payment for the course fee of ${FULL} is pending. Login: https://www.namanias.com/login Code: TESTCODE to complete payment. Naman Sharma IAS Academy.`;
    const merged = mergeSendVars("abandoned_nudge", {}, {
      first_name: "Faika",
      item_short: FULL,
      login_url: "https://www.namanias.com/login",
      login_code: "TESTCODE",
    });
    const fresh = prepareAndRenderSms(BODY, "abandoned_nudge", merged);
    assert.notEqual(stored, fresh.text);
    assert.ok(stored.includes(FULL));
    assert.ok(fresh.text.includes(SHORT));
  });
});
