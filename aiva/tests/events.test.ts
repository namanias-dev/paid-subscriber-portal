import { describe, it, expect } from "vitest";
import { colorForEvent, domainForEvent, isBusinessEvent, BUSINESS_EVENTS } from "@/lib/events/catalog";

describe("business event catalog", () => {
  it("maps payment/installment/enrollment events to the revenue domain", () => {
    expect(domainForEvent("payment.paid")).toBe("revenue");
    expect(domainForEvent("installment.overdue")).toBe("revenue");
    expect(domainForEvent("enrollment.created")).toBe("revenue");
  });

  it("uses spec pulse colours", () => {
    expect(colorForEvent("payment.paid")).toBe("green");
    expect(colorForEvent("installment.overdue")).toBe("red");
    expect(colorForEvent("campaign.drafted")).toBe("purple");
    expect(colorForEvent("lead.created")).toBe("gold");
  });

  it("recognises canonical events", () => {
    expect(isBusinessEvent("payment.paid")).toBe(true);
    expect(isBusinessEvent("not.a.real.event")).toBe(false);
    expect(BUSINESS_EVENTS.length).toBeGreaterThan(40);
  });
});
