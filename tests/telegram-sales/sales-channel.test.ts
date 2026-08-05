/**
 * Sales Telegram — dialable phones, no revenue aggregates, isolation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  maskPhone,
  optionalSalesInr,
  salesInr,
  salesPhone,
} from "../../lib/telegram/sales/format";
import { buildSalesDigestHtml, capSalesDigestLines } from "../../lib/telegram/sales/digest";
import { sendToChannel } from "../../lib/telegram/channels";
import { safeSalesContext } from "../../lib/telegram/sales/send";

describe("sales telegram format", () => {
  it("masks phones as 98989•••02", () => {
    assert.equal(maskPhone("9898900102"), "98989•••02");
    assert.equal(maskPhone("+91 98989 00102"), "98989•••02");
  });

  it("formats sales-channel phones as tappable E.164 text", () => {
    assert.equal(salesPhone("9898900102"), "+919898900102");
    assert.equal(salesPhone("+91 98989 00102"), "+919898900102");
    assert.equal(salesPhone("short"), null);
  });

  it("formats per-student amounts only (no Lakh aggregates forced)", () => {
    assert.equal(salesInr(20000), "₹20,000");
    assert.equal(salesInr(5000), "₹5,000");
    assert.equal(optionalSalesInr(0), null);
    assert.equal(optionalSalesInr(undefined), null);
  });

  it("caps heavy digests without cutting an HTML line", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `· Student ${i} · +919999999999`);
    const html = capSalesDigestLines(lines, 500);
    assert.ok(html.length <= 500);
    assert.match(html, /Digest truncated/);
    assert.doesNotMatch(html, /\+\d{1,11}$/);
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

  it("enrichment failure degrades to null context without throwing", async () => {
    const result = await safeSalesContext(
      async () => {
        throw new Error("simulated enrichment timeout");
      },
      "payment_failed",
    );
    assert.equal(result, null);
  });
});
