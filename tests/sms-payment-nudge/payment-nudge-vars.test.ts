import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSmsItemShort } from "../../lib/sms/smsTitle";

describe("payment abandoned nudge vars", () => {
  it("shortens long webinar titles under the DLT 50-char free-text cap", () => {
    const short = resolveSmsItemShort({
      fullTitle: "UPSC Full Masterclass By Naman Sir - 01 August 2026",
    });
    assert.ok(short.length <= 50, `len=${short.length} value=${short}`);
    assert.ok(short.length > 0);
  });
});
