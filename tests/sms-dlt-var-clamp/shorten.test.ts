import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isGsm7Text,
  resolveSmsItemShort,
  shortenSmsTitle,
  toGsm7Ascii,
} from "../../lib/sms/smsTitle";
import { DLT_FREE_TEXT_VAR_MAX, renderTemplate } from "../../lib/sms/templates";

describe("shortenSmsTitle", () => {
  test("keeps year and shortens the Aug 2026 webinar title under the max", () => {
    const full = "UPSC Full Masterclass By Naman Sir - 01 August 2026";
    assert.equal(full.length, 51);
    const out = shortenSmsTitle(full);
    assert.ok(out.length <= DLT_FREE_TEXT_VAR_MAX, `len=${out.length} out=${out}`);
    assert.ok(out.includes("2026"), "must keep the year");
    assert.ok(!out.includes("August"), "August should abbreviate to Aug");
    assert.equal(out, "UPSC Masterclass by Naman Sir - 01 Aug 2026");
    assert.equal(out.length, 43);
    assert.ok(isGsm7Text(out));
  });

  test("idempotent on already-short and already-shortened input", () => {
    const short = "UPSC Foundation 2027";
    assert.equal(shortenSmsTitle(short), short);
    const once = shortenSmsTitle("UPSC Full Masterclass By Naman Sir - 01 August 2026");
    assert.equal(shortenSmsTitle(once), once);
  });

  test("passes through titles already under the max (July)", () => {
    const july = "UPSC Full Masterclass By Naman Sir - July 4";
    assert.ok(july.length <= DLT_FREE_TEXT_VAR_MAX);
    assert.equal(shortenSmsTitle(july), july);
  });

  test("missing year still shortens without inventing one", () => {
    const out = shortenSmsTitle("UPSC Full Masterclass By Naman Sir Extra Long Filler Words Here");
    assert.ok(out.length <= DLT_FREE_TEXT_VAR_MAX);
    assert.ok(!/\b20\d{2}\b/.test(out));
  });

  test("unusual punctuation and unicode become GSM-7 ASCII", () => {
    const raw = "Prelims 2026 — 90 Day Strategy";
    assert.ok(!isGsm7Text(raw));
    const out = shortenSmsTitle(raw);
    assert.equal(toGsm7Ascii(raw), "Prelims 2026 - 90 Day Strategy");
    assert.ok(isGsm7Text(out));
    assert.ok(out.includes("2026"));
    assert.ok(!out.includes("—"));
  });

  test("curly quotes and rupee are normalized", () => {
    const out = toGsm7Ascii("Fee “special” ₹500");
    assert.equal(out, 'Fee "special" Rs500');
    assert.ok(isGsm7Text(out));
  });
});

describe("resolveSmsItemShort", () => {
  test("manual sms_short_title wins", () => {
    assert.equal(
      resolveSmsItemShort({
        smsShortTitle: "Custom SMS Title 2026",
        fullTitle: "UPSC Full Masterclass By Naman Sir - 01 August 2026",
      }),
      "Custom SMS Title 2026",
    );
  });

  test("falls back to auto-shorten of full title", () => {
    const out = resolveSmsItemShort({
      fullTitle: "UPSC Full Masterclass By Naman Sir - 01 August 2026",
    });
    assert.equal(out, "UPSC Masterclass by Naman Sir - 01 Aug 2026");
  });

  test("renderTemplate applies the shortener to long payment.item leftovers", () => {
    const body =
      "Hi {first_name}, your registration for the course {item_short} is confirmed. Login: {login_url} Code: {login_code}. Naman Sharma IAS Academy";
    const { text } = renderTemplate(body, {
      first_name: "Priyanshu",
      item_short: "UPSC Full Masterclass By Naman Sir - 01 August 2026",
      login_url: "https://www.namanias.com/login",
      login_code: "ABC1234",
    });
    assert.ok(text.includes("01 Aug 2026"));
    assert.ok(!text.includes("01 August 2026"));
    assert.ok(isGsm7Text(text));
  });
});
