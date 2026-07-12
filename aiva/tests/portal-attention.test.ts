import { describe, it, expect } from "vitest";
import { studentLink, paymentsLink, webinarLink, courseLink, recordLinks, PORTAL_ORIGIN } from "../lib/portal/links";
import { rankFlags, flagScore, type AttentionFlag } from "../lib/insights/attention";
import { dailySeries } from "../lib/insights/calc";

describe("portal links", () => {
  it("builds record-level links when an id is present", () => {
    expect(studentLink("stu_1").href).toBe(`${PORTAL_ORIGIN}/admin/students/stu_1`);
    expect(studentLink("stu_1").level).toBe("record");
    expect(webinarLink("web_1").href).toBe(`${PORTAL_ORIGIN}/admin/webinars/web_1/registrations`);
    expect(courseLink("crs_1").href).toBe(`${PORTAL_ORIGIN}/admin/courses/crs_1/edit`);
  });
  it("falls back to list-level when no id", () => {
    expect(studentLink(null).level).toBe("list");
    expect(studentLink(null).href).toBe(`${PORTAL_ORIGIN}/admin/students`);
    expect(paymentsLink().level).toBe("list");
  });
  it("composes a record link set, skipping missing ids", () => {
    const links = recordLinks({ studentId: "s1", webinarId: null, courseId: "c1" });
    const keys = links.map((l) => l.key);
    expect(keys).toContain("student");
    expect(keys).toContain("payments");
    expect(keys).toContain("course");
    expect(keys).not.toContain("webinar");
  });
});

describe("attention ranking", () => {
  const mk = (id: string, sev: "high" | "medium" | "low", mag: number): AttentionFlag => ({
    id, severity: sev, score: flagScore(sev, mag), domain: "revenue", title: id, why: "", calc: "", links: [],
  });
  it("scores high above medium above low", () => {
    expect(flagScore("high", 1)).toBeGreaterThan(flagScore("medium", 1));
    expect(flagScore("medium", 1)).toBeGreaterThan(flagScore("low", 1));
  });
  it("larger magnitude raises score within a severity", () => {
    expect(flagScore("high", 100000)).toBeGreaterThan(flagScore("high", 10));
  });
  it("ranks by score desc and caps to top N", () => {
    const flags = [mk("a", "low", 10), mk("b", "high", 5000), mk("c", "medium", 200)];
    const ranked = rankFlags(flags, 2);
    expect(ranked.map((f) => f.id)).toEqual(["b", "c"]);
    expect(ranked.length).toBe(2);
  });
});

describe("dailySeries", () => {
  const now = Date.parse("2026-01-15T12:00:00Z");
  it("buckets amounts into oldest→newest days (today at the end)", () => {
    const s = dailySeries(
      [
        { date: "2026-01-15T01:00:00Z", amount: 100 }, // today
        { date: "2026-01-14T01:00:00Z", amount: 50 }, // yesterday
        { date: "2026-01-15T09:00:00Z", amount: 25 }, // today again
      ],
      3,
      now,
    );
    expect(s.length).toBe(3);
    expect(s[2]).toBe(125); // today
    expect(s[1]).toBe(50); // yesterday
  });
  it("ignores out-of-window and unparseable dates", () => {
    const s = dailySeries([{ date: "2020-01-01T00:00:00Z", amount: 999 }, { date: "nope", amount: 5 }], 3, now);
    expect(s.reduce((a, b) => a + b, 0)).toBe(0);
  });
});
