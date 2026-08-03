/**
 * Unit tests for promo quiet-hours IST math + category resolution.
 * No gateway / no real SMS.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isWithinPromoWindow,
  nextPromoDispatchAt,
  resolveTemplateCategory,
  promoWindowStatus,
} from "../../lib/sms/promoQuietHours";

const settings = {
  promoWindowStart: "10:00",
  promoWindowEnd: "21:00",
  promoDispatchTime: "10:30",
  windowStart: "10:00",
  windowEnd: "21:00",
};

/** Build a Date whose Asia/Kolkata wall-clock is y-m-d H:M. */
function istWall(y: number, m: number, d: number, h: number, min: number): Date {
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00+05:30`;
  return new Date(iso);
}

describe("promo quiet hours — IST window", () => {
  it("8:45pm IST → inside window (send now)", () => {
    const d = istWall(2026, 8, 3, 20, 45);
    assert.equal(isWithinPromoWindow(settings, d), true);
    assert.equal(nextPromoDispatchAt(settings, d, { jitterMinutes: 0 }), null);
  });

  it("9:20pm IST → next day 10:30 IST", () => {
    const d = istWall(2026, 8, 3, 21, 20);
    assert.equal(isWithinPromoWindow(settings, d), false);
    const next = nextPromoDispatchAt(settings, d, { jitterMinutes: 0 });
    assert.ok(next);
    // 2026-08-04 10:30 IST = 05:00 UTC
    assert.equal(next!.toISOString(), "2026-08-04T05:00:00.000Z");
  });

  it("7:10am IST → same day 10:30 IST", () => {
    const d = istWall(2026, 8, 4, 7, 10);
    assert.equal(isWithinPromoWindow(settings, d), false);
    const next = nextPromoDispatchAt(settings, d, { jitterMinutes: 0 });
    assert.ok(next);
    assert.equal(next!.toISOString(), "2026-08-04T05:00:00.000Z");
  });

  it("11:00am IST → send now", () => {
    const d = istWall(2026, 8, 4, 11, 0);
    assert.equal(isWithinPromoWindow(settings, d), true);
    assert.equal(nextPromoDispatchAt(settings, d, { jitterMinutes: 0 }), null);
  });

  it("exactly 21:00 IST is still open (inclusive end)", () => {
    const d = istWall(2026, 8, 3, 21, 0);
    assert.equal(isWithinPromoWindow(settings, d), true);
  });

  it("21:01 IST defers to next day", () => {
    const d = istWall(2026, 8, 3, 21, 1);
    assert.equal(isWithinPromoWindow(settings, d), false);
    const next = nextPromoDispatchAt(settings, d, { jitterMinutes: 0 });
    assert.equal(next!.toISOString(), "2026-08-04T05:00:00.000Z");
  });
});

describe("promo category resolution", () => {
  it("explicit category wins", () => {
    assert.equal(resolveTemplateCategory({ category: "promo", message_type: "service" }), "promo");
    assert.equal(resolveTemplateCategory({ category: "transactional", message_type: "promotional" }), "transactional");
  });

  it("null category falls back to message_type, else promo", () => {
    assert.equal(resolveTemplateCategory({ category: null, message_type: "promotional" }), "promo");
    assert.equal(resolveTemplateCategory({ category: null, message_type: "service" }), "transactional");
    assert.equal(resolveTemplateCategory({ category: null, message_type: "service" as "service" }), "transactional");
  });

  it("unclassified defaults to promo (fail-safe)", () => {
    assert.equal(resolveTemplateCategory({ category: null, message_type: undefined as unknown as "service" }), "promo");
  });
});

describe("promoWindowStatus", () => {
  it("reports open/closed with IST now", () => {
    const open = promoWindowStatus(settings, istWall(2026, 8, 3, 15, 0));
    assert.equal(open.open, true);
    assert.match(open.istNow, /15:00 IST/);
    const closed = promoWindowStatus(settings, istWall(2026, 8, 3, 22, 0));
    assert.equal(closed.open, false);
    assert.ok(closed.nextDispatchAt);
  });
});
