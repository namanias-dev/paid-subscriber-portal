import { describe, it, expect } from "vitest";
import { maskPhone, maskEmail, maskName } from "@/lib/mask";

describe("PII masking", () => {
  it("masks phone to last 4 digits", () => {
    expect(maskPhone("9876543210")).toBe("••••••3210");
    expect(maskPhone("+91 98765 43210")).toBe("••••••3210");
    expect(maskPhone("")).toBe("");
  });
  it("masks email local part", () => {
    expect(maskEmail("aman@namanias.com")).toBe("a•••@namanias.com");
    expect(maskEmail("bad")).toBe("•••");
  });
  it("abbreviates names", () => {
    expect(maskName("Aman Sharma")).toBe("Aman S.");
    expect(maskName("")).toBe("—");
  });
});
