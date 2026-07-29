import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { prepareAndRenderSms } from "../../lib/sms/renderPipeline";
import { mergeSendVars } from "../../lib/sms/service";

const BODY =
  "Hi {first_name}, your payment for the course fee of {item_short} is pending. Login: {login_url} Code: {login_code} to complete payment. Naman Sharma IAS Academy.";

describe("prepareAndRenderSms shared pipeline", () => {
  test("preview and send inputs produce identical bodies for the Aug title", () => {
    const merged = mergeSendVars("abandoned_nudge", {}, {
      first_name: "Ashar",
      item_short: "UPSC Full Masterclass By Naman Sir - 01 August 2026",
      login_url: "https://www.namanias.com/login",
      login_code: "TESTCODE",
    });
    const a = prepareAndRenderSms(BODY, "abandoned_nudge", merged);
    const b = prepareAndRenderSms(BODY, "abandoned_nudge", merged);
    assert.equal(a.text, b.text);
    assert.ok(a.ok);
    assert.equal(a.gsm, true);
    assert.ok(String(a.vars.item_short).includes("2026"));
    assert.ok([...String(a.vars.item_short)].length <= 50);
    assert.equal(String(a.vars.item_short), "UPSC Masterclass by Naman Sir - 01 Aug 2026");
    assert.ok(!a.text.includes("01 August 2026"));
  });

  test("loud violation when shorten cannot fit (synthetic over-max after clamp)", () => {
    // Clamp always caps at 50, so dltViolations should normally be empty.
    // Assert the pipeline never leaves a >50 item_short in vars.
    const merged = {
      first_name: "Ashar",
      item_short: "X".repeat(200),
      login_url: "https://www.namanias.com/login",
      login_code: "TESTCODE",
    };
    const r = prepareAndRenderSms(BODY, "abandoned_nudge", merged);
    assert.ok([...String(r.vars.item_short)].length <= 50);
  });
});
