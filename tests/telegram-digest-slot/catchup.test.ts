import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveDueDigestSlot } from "../../lib/telegram/reports/settings";

describe("resolveDueDigestSlot", () => {
  test("10:05 IST is the 10:00 slot", () => {
    const due = resolveDueDigestSlot("2h", new Date("2026-08-03T04:35:00.000Z"));
    assert.equal(due?.slotKey, "2026-08-03T10:00+05:30");
  });

  test("catch-up: 10:45 IST still owes the 10:00 slot", () => {
    const due = resolveDueDigestSlot("2h", new Date("2026-08-03T05:15:00.000Z"));
    assert.equal(due?.slotKey, "2026-08-03T10:00+05:30");
  });

  test("catch-up: 11:05 IST (odd hour) still owes 10:00", () => {
    const due = resolveDueDigestSlot("2h", new Date("2026-08-03T05:35:00.000Z"));
    assert.equal(due?.slotKey, "2026-08-03T10:00+05:30");
  });

  test("12:05 IST advances to 12:00", () => {
    const due = resolveDueDigestSlot("2h", new Date("2026-08-03T06:35:00.000Z"));
    assert.equal(due?.slotKey, "2026-08-03T12:00+05:30");
  });

  test("daily freq before 6am uses yesterday 6am slot", () => {
    const due = resolveDueDigestSlot("daily", new Date("2026-08-02T23:35:00.000Z"));
    assert.equal(due?.slotKey, "2026-08-02T06:00+05:30");
  });
});
