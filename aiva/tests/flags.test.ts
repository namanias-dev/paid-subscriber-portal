import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { canExecute, flagSnapshot } from "@/lib/flags";

describe("AIVA feature flags (read-only safety)", () => {
  const orig = { ...process.env };
  beforeEach(() => {
    process.env = { ...orig };
  });
  afterEach(() => {
    process.env = { ...orig };
  });

  it("green actions are always allowed", () => {
    expect(canExecute("green").allowed).toBe(true);
  });

  it("blocks amber and red actions while read-only (default)", () => {
    delete process.env.AIVA_READ_ONLY; // default true
    expect(canExecute("amber").allowed).toBe(false);
    expect(canExecute("red").allowed).toBe(false);
  });

  it("still blocks amber without auto-green even when not read-only", () => {
    process.env.AIVA_READ_ONLY = "false";
    process.env.AIVA_AUTO_GREEN_ACTIONS_ENABLED = "false";
    const r = canExecute("amber");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("defaults are safe: read-only true, campaigns/reminders false", () => {
    const snap = flagSnapshot();
    expect(snap.AIVA_READ_ONLY).toBe(true);
    expect(snap.AIVA_CAMPAIGNS_ENABLED).toBe(false);
    expect(snap.AIVA_INSTALLMENT_REMINDERS_ENABLED).toBe(false);
    expect(snap.AIVA_AUTO_GREEN_ACTIONS_ENABLED).toBe(false);
  });
});
