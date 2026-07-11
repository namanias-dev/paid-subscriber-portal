import { describe, it, expect } from "vitest";
import {
  normPhone,
  pct,
  ratePerDay,
  etaDays,
  trend,
  groupCount,
  sumInWindow,
  daysAgo,
  funnelStages,
} from "../lib/insights/calc";

describe("normPhone", () => {
  it("keeps the last 10 digits and strips non-digits", () => {
    expect(normPhone("+91 98765-43210")).toBe("9876543210");
    expect(normPhone("098765 43210")).toBe("9876543210");
  });
  it("is empty-safe", () => {
    expect(normPhone(null)).toBe("");
    expect(normPhone(undefined)).toBe("");
  });
});

describe("pct", () => {
  it("is divide-by-zero safe", () => {
    expect(pct(5, 0)).toBe(0);
    expect(pct(0, 0)).toBe(0);
  });
  it("computes one-decimal percentages", () => {
    expect(pct(6, 410)).toBe(1.5);
    expect(pct(80, 160)).toBe(50);
    expect(pct(1, 3)).toBe(33.3);
  });
});

describe("ratePerDay", () => {
  it("returns per-day rate rounded to 2dp", () => {
    expect(ratePerDay(14, 14)).toBe(1);
    expect(ratePerDay(20, 14)).toBe(1.43);
  });
  it("is zero-window safe", () => {
    expect(ratePerDay(5, 0)).toBe(0);
  });
});

describe("etaDays", () => {
  it("returns 0 when nothing remains", () => {
    expect(etaDays(0, 3)).toBe(0);
    expect(etaDays(-5, 3)).toBe(0);
  });
  it("returns null (never fills) when pace is zero", () => {
    expect(etaDays(50, 0)).toBeNull();
  });
  it("rounds up remaining/pace", () => {
    expect(etaDays(50, 5)).toBe(10);
    expect(etaDays(51, 5)).toBe(11);
  });
});

describe("trend", () => {
  it("computes up/down/flat with one-decimal delta", () => {
    expect(trend(120, 100)).toEqual({ current: 120, previous: 100, deltaPct: 20, direction: "up" });
    expect(trend(80, 100)).toEqual({ current: 80, previous: 100, deltaPct: -20, direction: "down" });
    expect(trend(100, 100)).toEqual({ current: 100, previous: 100, deltaPct: 0, direction: "flat" });
  });
  it("reports +100% from a zero base and 0% when both are zero", () => {
    expect(trend(50, 0)).toEqual({ current: 50, previous: 0, deltaPct: 100, direction: "up" });
    expect(trend(0, 0)).toEqual({ current: 0, previous: 0, deltaPct: 0, direction: "flat" });
  });
});

describe("groupCount", () => {
  it("counts rows per derived key", () => {
    const rows = [{ b: "A" }, { b: "A" }, { b: "B" }];
    expect(groupCount(rows, (r) => r.b)).toEqual({ A: 2, B: 1 });
  });
});

describe("sumInWindow", () => {
  const rows = [
    { t: 100, a: 10 },
    { t: 200, a: 20 },
    { t: 300, a: 30 },
  ];
  it("sums amounts within [from, to)", () => {
    expect(sumInWindow(rows, (r) => r.t, (r) => r.a, 100, 300)).toBe(30); // 100 and 200, not 300
    expect(sumInWindow(rows, (r) => r.t, (r) => r.a, 0, 400)).toBe(60);
  });
});

describe("daysAgo", () => {
  it("subtracts whole days in ms", () => {
    const now = 30 * 86_400_000;
    expect(daysAgo(now, 30)).toBe(0);
    expect(now - daysAgo(now, 1)).toBe(86_400_000);
  });
});

describe("funnelStages", () => {
  it("computes conversion off the previous stage and off the top", () => {
    const stages = funnelStages([
      { label: "Registrants", value: 410 },
      { label: "Converted", value: 6 },
      { label: "Paid", value: 5 },
    ]);
    expect(stages[0]).toEqual({ label: "Registrants", value: 410, ofPrev: 100, ofTop: 100 });
    expect(stages[1].ofTop).toBe(1.5);
    expect(stages[2].ofPrev).toBe(83.3); // 5 of 6
    expect(stages[2].ofTop).toBe(1.2); // 5 of 410
  });
  it("is empty-safe", () => {
    expect(funnelStages([])).toEqual([]);
  });
});
