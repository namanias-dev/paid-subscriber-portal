import { describe, it, expect } from "vitest";
import { routeIntent, isActionRequest, followupsFor, SEED_QUESTIONS } from "@/lib/assistant/router";

/**
 * Tool-routing contract: every pre-listed CEO question maps to the right whitelisted tool
 * deterministically (no LLM needed), and action/mutation requests are detected for refusal.
 */
describe("routeIntent — seed CEO questions", () => {
  const expected: Record<string, string> = {
    "How are collections this week vs last?": "getCollectionsSummary",
    "Who's overdue 15+ days, and how much?": "getOverdueStudents",
    "Which webinar converted best and worst?": "getWebinarPerformance",
    "Which batch is filling slowest?": "getBatchFill",
    "Enrollments this month vs last month?": "getEnrollmentsTrend",
    "Which enrolled students have never been contacted?": "getZeroContactStudents",
    "What needs my attention today?": "getAttentionItems",
  };

  for (const q of SEED_QUESTIONS) {
    it(`routes: ${q}`, () => {
      const intent = routeIntent(q);
      expect(intent).not.toBeNull();
      expect(intent!.tool).toBe(expected[q]);
    });
  }

  it("overdue 15+ passes minDaysOverdue=15", () => {
    expect(routeIntent("Who's overdue 15+ days, and how much?")!.args).toMatchObject({ minDaysOverdue: 15 });
  });

  it("collections this week uses the week window", () => {
    expect(routeIntent("How are collections this week vs last?")!.args).toMatchObject({ period: "week" });
  });

  it("routes a named student to Student 360", () => {
    const i = routeIntent("show me Rahul Kumar's payments");
    expect(i?.tool).toBe("getStudent360");
    expect(String(i?.args.query)).toMatch(/rahul/i);
  });

  it("routes a phone number to Student 360", () => {
    const i = routeIntent("look up 9876543210");
    expect(i?.tool).toBe("getStudent360");
    expect(i?.args.query).toBe("9876543210");
  });

  it("returns null for an unsupported question", () => {
    expect(routeIntent("what is the meaning of life?")).toBeNull();
  });
});

describe("isActionRequest — refuses mutations", () => {
  it.each([
    "Send an SMS to everyone overdue",
    "remind them to pay their installment",
    "mark Rahul as paid",
    "please enroll this student",
    "refund the abandoned checkout",
    "delete that record",
  ])("flags as action: %s", (m) => {
    expect(isActionRequest(m)).toBe(true);
  });

  it.each([
    "Who's overdue 15+ days, and how much?",
    "How are collections this week vs last?",
    "Which webinar converted best?",
    "What needs my attention today?",
  ])("does NOT flag a question: %s", (m) => {
    expect(isActionRequest(m)).toBe(false);
  });
});

describe("followupsFor", () => {
  it("returns 2-3 suggestions for every tool and the default", () => {
    for (const tool of [null, "getCollectionsSummary", "getOverdueStudents", "getStudent360"]) {
      const f = followupsFor(tool);
      expect(f.length).toBeGreaterThanOrEqual(2);
      expect(f.length).toBeLessThanOrEqual(3);
    }
  });
});
