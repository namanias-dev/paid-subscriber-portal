/**
 * Manual schedule IST parse + promo slot helpers (no gateway).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseIstScheduleInput,
  nextValidPromoSlot,
  isWithinPromoWindow,
  formatIstScheduleLabel,
} from "../../lib/sms/promoQuietHours";

const settings = {
  promoWindowStart: "10:00",
  promoWindowEnd: "21:00",
  promoDispatchTime: "10:30",
  windowStart: "10:00",
  windowEnd: "21:00",
};

describe("parseIstScheduleInput", () => {
  it("parses bare datetime-local as IST (+05:30)", () => {
    const future = new Date(Date.now() + 7 * 86_400_000);
    // Build IST wall-clock datetime-local for that UTC instant at 14:30 IST on that calendar day.
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(future);
    const r = parseIstScheduleInput(`${ymd}T14:30`);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.utcIso, `${ymd}T09:00:00.000Z`); // 14:30 IST = 09:00 UTC
    assert.match(r.istLabel, /IST/);
  });

  it("rejects past timestamps", () => {
    const r = parseIstScheduleInput("2020-01-01T12:00");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "past");
  });

  it("rejects malformed input", () => {
    const r = parseIstScheduleInput("not-a-date");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "malformed");
  });
});

describe("promo schedule window gate", () => {
  it("11pm IST is outside window; next valid is next day 10:00", () => {
    const d = new Date("2026-08-03T23:00:00+05:30");
    assert.equal(isWithinPromoWindow(settings, d), false);
    const next = nextValidPromoSlot(settings, d);
    assert.equal(next.toISOString(), "2026-08-04T04:30:00.000Z"); // 10:00 IST
  });

  it("2pm IST is inside window", () => {
    const d = new Date("2026-08-04T14:00:00+05:30");
    assert.equal(isWithinPromoWindow(settings, d), true);
  });

  it("formatIstScheduleLabel includes IST", () => {
    const label = formatIstScheduleLabel(new Date("2026-08-04T09:00:00.000Z"));
    assert.match(label, /IST/);
    assert.match(label, /Aug/i);
  });
});
