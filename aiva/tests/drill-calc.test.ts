import { describe, it, expect } from "vitest";
import { isReminderTrigger, summarizeSms, matchesQuery, paginate } from "../lib/insights/drill";
import { attendeeConversion } from "../lib/insights/calc";

describe("isReminderTrigger", () => {
  it("flags payment/installment reminders", () => {
    expect(isReminderTrigger("installment_reminder")).toBe(true);
    expect(isReminderTrigger("Overdue Fee")).toBe(true);
    expect(isReminderTrigger("payment_due")).toBe(true);
  });
  it("ignores unrelated triggers and empties", () => {
    expect(isReminderTrigger("welcome")).toBe(false);
    expect(isReminderTrigger(null)).toBe(false);
    expect(isReminderTrigger("")).toBe(false);
  });
});

describe("summarizeSms", () => {
  it("returns empty summary for no rows", () => {
    const s = summarizeSms([]);
    expect(s.count).toBe(0);
    expect(s.lastType).toBeNull();
    expect(s.hasReminder).toBe(false);
  });
  it("picks the latest by sent_at and detects reminders", () => {
    const s = summarizeSms([
      { normalized_mobile: "9990001111", mobile: null, template_name: "welcome", trigger_event: "registration_created", status: "DELIVERED", sent_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
      { normalized_mobile: "9990001111", mobile: null, template_name: "installment_reminder", trigger_event: "reminder", status: "SENT", sent_at: "2026-02-01T00:00:00Z", created_at: "2026-02-01T00:00:00Z" },
    ]);
    expect(s.count).toBe(2);
    expect(s.lastType).toBe("installment_reminder");
    expect(s.lastStatus).toBe("SENT");
    expect(s.hasReminder).toBe(true);
  });
  it("falls back to created_at when sent_at is null", () => {
    const s = summarizeSms([
      { normalized_mobile: "1", mobile: null, template_name: "a", trigger_event: null, status: "X", sent_at: null, created_at: "2026-03-01T00:00:00Z" },
    ]);
    expect(s.lastSent).toBe("2026-03-01T00:00:00Z");
  });
});

describe("matchesQuery", () => {
  it("matches on name (case-insensitive)", () => {
    expect(matchesQuery("Rahul Kumar", "9876543210", "rahul")).toBe(true);
    expect(matchesQuery("Rahul Kumar", "9876543210", "AMIT")).toBe(false);
  });
  it("matches on last-4 phone and empty query matches all", () => {
    expect(matchesQuery("Rahul", "9876543210", "3210")).toBe(true);
    expect(matchesQuery("Rahul", "9876543210", "")).toBe(true);
  });
});

describe("paginate", () => {
  const rows = Array.from({ length: 25 }, (_, i) => i);
  it("slices 1-based pages", () => {
    expect(paginate(rows, 1, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(paginate(rows, 3, 10)).toEqual([20, 21, 22, 23, 24]);
  });
  it("clamps bad page numbers to page 1", () => {
    expect(paginate(rows, 0, 10)[0]).toBe(0);
    expect(paginate(rows, -5, 10)[0]).toBe(0);
  });
});

describe("attendeeConversion", () => {
  it("is unknown when no attendance is recorded", () => {
    const r = attendeeConversion([
      { attended: false, converted: true },
      { attended: false, converted: false },
    ]);
    expect(r.known).toBe(false);
  });
  it("computes attendee vs no-show conversion rates", () => {
    const r = attendeeConversion([
      { attended: true, converted: true },
      { attended: true, converted: false },
      { attended: false, converted: false },
      { attended: false, converted: false },
    ]);
    expect(r.known).toBe(true);
    expect(r.attendees).toBe(2);
    expect(r.noShows).toBe(2);
    expect(r.attendeeConvPct).toBe(50);
    expect(r.noShowConvPct).toBe(0);
  });
});
