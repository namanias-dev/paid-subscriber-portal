import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  clampDltFreeTextVar,
  DLT_FREE_TEXT_VAR_MAX,
  renderTemplate,
} from "../../lib/sms/templates";

describe("clampDltFreeTextVar", () => {
  test("passes through values at or under the max", () => {
    assert.equal(clampDltFreeTextVar("UPSC Foundation 2027"), "UPSC Foundation 2027");
    const fortySeven = "Safalta GS Foundation Batch for UPSC 2027/28/29";
    assert.equal(fortySeven.length, 47);
    assert.equal(clampDltFreeTextVar(fortySeven), fortySeven);
  });

  test("clamps the Aug 2026 webinar title that was 100% dlr:Other", () => {
    const long = "UPSC Full Masterclass By Naman Sir - 01 August 2026";
    assert.equal(long.length, 51);
    const out = clampDltFreeTextVar(long);
    assert.ok(out.length <= DLT_FREE_TEXT_VAR_MAX);
    assert.equal(out, "UPSC Full Masterclass By Naman Sir - 01 August");
  });
});

describe("renderTemplate clamps item_short only", () => {
  const body =
    "Hi {first_name}, your payment for the course fee of {item_short} is pending. Login: {login_url} Code: {login_code} to complete payment. Naman Sharma IAS Academy.";

  test("long item_short is auto-shortened (year kept) then clamped", () => {
    const { text, missing } = renderTemplate(body, {
      first_name: "Faika",
      item_short: "UPSC Full Masterclass By Naman Sir - 01 August 2026",
      login_url: "https://www.namanias.com/login",
      login_code: "43TJXM9",
    });
    assert.deepEqual(missing, []);
    assert.ok(!text.includes("01 August 2026"));
    assert.ok(text.includes("01 Aug 2026"));
    assert.ok(text.includes("https://www.namanias.com/login"));
    assert.ok(text.includes("43TJXM9"));
  });

  test("July title under the max is unchanged (historical Delivered)", () => {
    const july = "UPSC Full Masterclass By Naman Sir - July 4";
    const { text } = renderTemplate(body, {
      first_name: "Afifa",
      item_short: july,
      login_url: "https://www.namanias.com/login",
      login_code: "AP8D2DE",
    });
    assert.ok(text.includes(july));
  });
});
