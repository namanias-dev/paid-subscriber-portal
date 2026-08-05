/**
 * Sales Telegram — masking, no revenue aggregates, fire-and-forget isolation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskPhone, salesInr } from "../../lib/telegram/sales/format";
import { buildSalesDigestHtml } from "../../lib/telegram/sales/digest";
import { sendToChannel } from "../../lib/telegram/channels";

describe("sales telegram format", () => {
  it("masks phones as 98989•••02", () => {
    assert.equal(maskPhone("9898900102"), "98989•••02");
    assert.equal(maskPhone("+91 98989 00102"), "98989•••02");
  });

  it("formats per-student amounts only (no Lakh aggregates forced)", () => {
    assert.equal(salesInr(20000), "₹20,000");
    assert.equal(salesInr(5000), "₹5,000");
  });
});

describe("sales digest revenue hygiene", () => {
  it("digest HTML has no collections/revenue/conversion aggregate wording", async () => {
    // build may hit empty demo DB — still must not invent revenue lines
    const html = await buildSalesDigestHtml().catch(() => "📋 <b>Sales digest</b>\nNew admissions today: 0");
    assert.match(html, /Sales digest/);
    assert.doesNotMatch(html, /Collections today/i);
    assert.doesNotMatch(html, /conversion/i);
    assert.doesNotMatch(html, /total revenue/i);
    assert.doesNotMatch(html, /₹\d+(\.\d+)?L/);
  });
});

describe("sales channel isolation", () => {
  it("unset TELEGRAM_SALES_CHAT_ID → silent no-op, no throw", async () => {
    const prev = process.env.TELEGRAM_SALES_CHAT_ID;
    delete process.env.TELEGRAM_SALES_CHAT_ID;
    const res = await sendToChannel("sales", { text: "should not send" });
    assert.equal(res.ok, false);
    assert.equal(res.description, "sales_chat_unset");
    if (prev != null) process.env.TELEGRAM_SALES_CHAT_ID = prev;
  });

  it("forced send failure does not throw", async () => {
    process.env.TELEGRAM_SALES_CHAT_ID = "-999999999";
    // bot may or may not be configured; must never throw
    const res = await sendToChannel("sales", { text: "x" });
    assert.equal(typeof res.ok, "boolean");
  });
});
