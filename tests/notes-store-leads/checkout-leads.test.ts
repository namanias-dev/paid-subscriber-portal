/**
 * Checkout lead rules. No database and no payment.
 * Run: npx tsx tests/notes-store-leads/checkout-leads.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHECKOUT_ABANDON_MS,
  PAYMENT_ABANDON_MS,
  completeAddress,
  leadAllowsPromo,
  leadAnalyticsProps,
  maskPhone,
  nextAbandonedStage,
  normalizeIndianMobile,
  shouldCreateLead,
  shouldRetainForPurge,
  stageForDraft,
  summarizeCheckoutLeads,
} from "../../lib/store/checkoutLeadLogic";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok ${name}`);
}

check("cart without a phone does not create a lead", () => {
  assert.equal(shouldCreateLead(null, 2), false);
  assert.equal(shouldCreateLead("9876543210", 0), false);
});

check("a valid checkout phone creates one lead key", () => {
  assert.equal(normalizeIndianMobile("+91 98765 43210"), "9876543210");
  assert.equal(normalizeIndianMobile("09876543210"), "9876543210");
  assert.equal(shouldCreateLead("9876543210", 1), true);
});

check("continuing checkout stays on the same phone key", () => {
  assert.equal(normalizeIndianMobile("9876543210"), normalizeIndianMobile("+91-9876543210"));
  assert.equal(stageForDraft({ name: "Aman", address: null }), "DETAILS_IN_PROGRESS");
});

check("refresh and a second tab share the normalized phone", () => {
  assert.equal(normalizeIndianMobile("98765-43210"), "9876543210");
});

check("payment initiated is not abandoned inside six hours", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const recent = new Date(now.getTime() - 30_000).toISOString();
  assert.equal(nextAbandonedStage("PAYMENT_INITIATED", recent, now), null);
  const stale = new Date(now.getTime() - PAYMENT_ABANDON_MS - 1000).toISOString();
  assert.equal(nextAbandonedStage("PAYMENT_INITIATED", stale, now), "PAYMENT_ABANDONED");
});

check("converted leads stay converted", () => {
  assert.equal(nextAbandonedStage("CONVERTED", "2026-01-01T00:00:00Z", new Date()), null);
});

check("lead analytics carry no phone or address", () => {
  const props = leadAnalyticsProps({
    leadId: "lead-1",
    stage: "CONTACT_CAPTURED",
    cartValuePaise: 299900,
    itemCount: 1,
    channel: "Instagram",
    isTest: true,
  });
  assert.equal("phone" in props, false);
  assert.equal("email" in props, false);
  assert.equal("address" in props, false);
});

check("marketing consent is stored as given", () => {
  assert.equal(leadAllowsPromo({ marketingConsent: false, salesStatus: "NEW", stage: "CONTACT_CAPTURED" }), false);
  assert.equal(leadAllowsPromo({ marketingConsent: true, salesStatus: "NEW", stage: "CHECKOUT_ABANDONED" }), true);
});

check("do not contact blocks promotion even with consent", () => {
  assert.equal(leadAllowsPromo({ marketingConsent: true, salesStatus: "DO_NOT_CONTACT", stage: "CHECKOUT_ABANDONED" }), false);
});

check("incomplete address is not stored", () => {
  assert.equal(completeAddress({ line1: "12 MG Road", pincode: "1600" }), null);
  assert.ok(completeAddress({ line1: "12 MG Road", city: "Chandigarh", state: "Chandigarh", pincode: "160036" }));
});

check("phone list mask hides the prefix", () => {
  assert.equal(maskPhone("9876543210"), "••••3210");
});

check("checkout inactivity uses two hours, not thirty seconds", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  assert.equal(nextAbandonedStage("CONTACT_CAPTURED", new Date(now.getTime() - 30_000).toISOString(), now), null);
  assert.equal(nextAbandonedStage("CONTACT_CAPTURED", new Date(now.getTime() - CHECKOUT_ABANDON_MS - 1).toISOString(), now), "CHECKOUT_ABANDONED");
});

check("paid recovered revenue is separate from ordinary leads", () => {
  const start = new Date("2026-09-01T00:00:00Z");
  const end = new Date("2026-10-01T00:00:00Z");
  const report = summarizeCheckoutLeads([
    { created_at: "2026-09-02T00:00:00Z", converted_at: "2026-09-03T00:00:00Z", checkout_stage: "CONVERTED", was_abandoned: true, is_test: false, converted_value_paise: 299900, attribution_source: "Instagram" },
    { created_at: "2026-09-02T00:00:00Z", converted_at: null, checkout_stage: "CHECKOUT_ABANDONED", was_abandoned: true, is_test: false, converted_value_paise: null, attribution_source: "Instagram" },
    { created_at: "2026-09-02T00:00:00Z", converted_at: null, checkout_stage: "CONTACT_CAPTURED", was_abandoned: false, is_test: true, converted_value_paise: null, attribution_source: "QA" },
  ], start, end);
  assert.equal(report.leads, 2);
  assert.equal(report.abandoned, 2);
  assert.equal(report.recovered, 1);
  assert.equal(report.recoveredRevenuePaise, 299900);
  assert.equal(report.paid, 1);
});

check("old orders and payment code do not wait on the lead", () => {
  const checkout = readFileSync(new URL("../../lib/store/checkout.ts", import.meta.url), "utf8");
  const verify = readFileSync(new URL("../../lib/store/payments/verify.ts", import.meta.url), "utf8");
  assert.match(checkout, /void import\("@\/lib\/store\/checkoutLeads"\)/);
  assert.match(verify, /void import\("@\/lib\/store\/checkoutLeads"\)/);
  assert.doesNotMatch(checkout, /await import\("@\/lib\/store\/checkoutLeads"\)/);
});

check("converted order contact is not purged", () => {
  assert.equal(shouldRetainForPurge({
    stage: "CONVERTED",
    salesStatus: "CONVERTED",
    lastActivityAt: "2020-01-01T00:00:00Z",
    now: new Date("2026-09-27T00:00:00Z"),
    hasOrder: true,
  }), false);
});

console.log(`\n${passed} passed`);
