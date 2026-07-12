import { describe, it, expect } from "vitest";
import { composeAnswer, refusalAnswer, noToolAnswer, numericTokens, isGrounded, REFUSAL_TEXT } from "@/lib/assistant/format";
import type { ToolResult } from "@/lib/assistant/types";

function fixture(): ToolResult {
  return {
    tool: "getCollectionsSummary",
    ok: true,
    headline: "₹5,691 collected this week — up 20% vs last week.",
    figures: [
      { label: "Collected (this week)", value: "₹5,691" },
      { label: "Change", value: "+20%", hint: "up" },
    ],
    rows: [],
    rowsTotal: 3,
    drill: { domain: "revenue", metric: "revenue:recentpaid", label: "Payments" },
    links: [],
    provenance: "dedupePaidRows(isPaidStatus) — same rows as the Payments tab.",
    notes: ["Windows are rolling."],
  };
}

describe("composeAnswer — grounded, sourced", () => {
  it("includes the headline, each figure, the source, and evidence count", () => {
    const out = composeAnswer(fixture());
    expect(out).toContain("₹5,691 collected this week");
    expect(out).toContain("**Collected (this week):** ₹5,691");
    expect(out).toContain("+20%");
    expect(out).toContain("Source:");
    expect(out).toContain("dedupePaidRows");
    expect(out).toContain("3 records");
    expect(out).toContain("Note: Windows are rolling.");
  });

  it("never prints a number that isn't in the tool result", () => {
    const out = composeAnswer(fixture());
    const allowed = "₹5,691 collected this week — up 20% vs last week. ₹5,691 +20% 3 records";
    expect(isGrounded(out, allowed)).toBe(true);
  });
});

describe("refusal + no-tool", () => {
  it("refusal is read-only and cannot be mistaken for an action", () => {
    expect(refusalAnswer()).toBe(REFUSAL_TEXT);
    expect(refusalAnswer().toLowerCase()).toContain("read-only");
    expect(refusalAnswer().toLowerCase()).toContain("can't");
  });
  it("no-tool answer is honest about the gap", () => {
    expect(noToolAnswer().toLowerCase()).toContain("don't have a data tool");
  });
});

describe("grounding validator", () => {
  it("extracts numeric tokens ignoring currency/commas", () => {
    expect(numericTokens("₹5,691 collected, +20% over 3 items")).toEqual(["5691", "20", "3"]);
  });
  it("rejects an invented figure", () => {
    expect(isGrounded("We collected ₹99,999 this week.", "collected ₹5,691 this week")).toBe(false);
  });
  it("allows small connective integers not in the source", () => {
    expect(isGrounded("Here are 2 things to note.", "collected ₹5,691")).toBe(true);
  });
});
