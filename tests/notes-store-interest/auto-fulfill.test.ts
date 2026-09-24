import assert from "node:assert/strict";
import test from "node:test";
import { destinationRejected, fulfillCheapest, lockAcquired, lockEligible, rankEligibleQuotes, resolveAutoPackage } from "../../lib/store/shipping/autoFulfill";
import { parseDelhiveryPackage } from "../../lib/store/shipping/delhiveryApi";
import type { CourierQuote } from "../../lib/store/shipping/quotes";

const canonical = { city: "Panchkula", state: "Haryana", pincode: "134109" };

function quote(partial: Partial<CourierQuote> & Pick<CourierQuote, "provider" | "courier" | "ratePaise">): CourierQuote {
  return {
    service: partial.service || "Surface",
    etaDays: partial.etaDays ?? 2,
    etaText: null,
    codSupported: false,
    prepaid: true,
    courierId: partial.courierId || null,
    ...partial,
  };
}

test("cheapest eligible wins and Delhivery stays when the address matches", async () => {
  const quotes = [
    quote({ provider: "delhivery", courier: "Delhivery", service: "Surface", ratePaise: 4200, etaDays: 2 }),
    quote({ provider: "shiprocket", courier: "Xpressbees Surface", ratePaise: 9372, etaDays: 1, courierId: "51" }),
  ];
  let creates = 0;
  const result = await fulfillCheapest({
    quotes,
    canonical,
    create: async (candidate) => {
      creates += 1;
      assert.equal(candidate.provider, "delhivery");
      return {
        provider: "delhivery",
        providerOrderId: "ord",
        providerShipmentId: "awb1",
        awb: "DL111",
        courierName: "Delhivery Surface",
        labelUrl: "https://example.test/label",
        pin: "134109",
        city: "Panchkula",
        state: "Haryana",
        phoneStored: true,
        possessed: false,
        unverified: false,
      };
    },
    reconcile: async () => null,
    cancel: async () => false,
  });
  assert.equal(creates, 1);
  assert.equal(result.accepted?.awb, "DL111");
  assert.equal(result.blocked, null);
  assert.equal(result.attempts.some((row) => row.result === "address_mismatch"), false);
});

test("a material PIN mismatch cancels and books the next cheapest", async () => {
  const quotes = [
    quote({ provider: "delhivery", courier: "Delhivery", ratePaise: 4200 }),
    quote({ provider: "shiprocket", courier: "Xpressbees Surface", ratePaise: 9372, courierId: "51" }),
    quote({ provider: "shiprocket", courier: "Ekart Surface", ratePaise: 9900, courierId: "9" }),
  ];
  const created: string[] = [];
  const cancelled: string[] = [];
  const result = await fulfillCheapest({
    quotes,
    canonical,
    create: async (candidate) => {
      created.push(candidate.courier);
      const wrong = candidate.provider === "delhivery";
      return {
        provider: candidate.provider,
        providerOrderId: candidate.courier,
        providerShipmentId: candidate.courier,
        awb: wrong ? "DL-BAD" : "XB-OK",
        courierName: candidate.courier,
        labelUrl: wrong ? null : "https://example.test/label",
        pin: wrong ? "134111" : "134109",
        city: wrong ? "Zirakpur" : "Panchkula",
        state: wrong ? "Punjab" : "Haryana",
        phoneStored: true,
        possessed: false,
        unverified: false,
      };
    },
    reconcile: async () => null,
    cancel: async (row) => {
      cancelled.push(row.awb || "");
      return true;
    },
  });
  assert.deepEqual(created, ["Delhivery", "Xpressbees Surface"]);
  assert.deepEqual(cancelled, ["DL-BAD"]);
  assert.equal(result.accepted?.courier, "Xpressbees Surface");
  assert.equal(result.accepted?.awb, "XB-OK");
  assert.equal(result.attempts[0].result, "address_mismatch");
});

test("a wrong PIN on the cheapest non-Delhivery courier uses the same fallback", async () => {
  const quotes = [
    quote({ provider: "shiprocket", courier: "Xpressbees Surface", ratePaise: 5000, courierId: "51" }),
    quote({ provider: "shiprocket", courier: "Ekart Surface", ratePaise: 9900, courierId: "9" }),
  ];
  const result = await fulfillCheapest({
    quotes,
    canonical,
    create: async (candidate) => ({
      provider: "shiprocket",
      providerOrderId: candidate.courier,
      providerShipmentId: candidate.courier,
      awb: candidate.courier.startsWith("Xpress") ? "XB-BAD" : "EK-OK",
      courierName: candidate.courier,
      labelUrl: null,
      pin: candidate.courier.startsWith("Xpress") ? "134111" : "134109",
      city: "Panchkula",
      state: "Haryana",
      phoneStored: true,
      possessed: false,
      unverified: false,
    }),
    reconcile: async () => null,
    cancel: async () => true,
  });
  assert.equal(result.accepted?.courier, "Ekart Surface");
  assert.equal(result.attempts[0].candidate.courier, "Xpressbees Surface");
});

test("a timed-out create is reconciled and not repeated", async () => {
  let calls = 0;
  const result = await fulfillCheapest({
    quotes: [quote({ provider: "shiprocket", courier: "Xpressbees Surface", ratePaise: 9372, courierId: "51" })],
    canonical,
    create: async () => {
      calls += 1;
      throw new Error("timeout");
    },
    reconcile: async () => ({
      provider: "shiprocket",
      providerOrderId: "1608",
      providerShipmentId: "1604",
      awb: "1411",
      courierName: "Xpressbees Surface",
      labelUrl: null,
      pin: "134109",
      city: "Panchkula",
      state: "Haryana",
      phoneStored: true,
      possessed: false,
      unverified: false,
    }),
    cancel: async () => false,
  });
  assert.equal(calls, 1);
  assert.equal(result.creates, 0);
  assert.equal(result.accepted?.awb, "1411");
});

test("a missing phone cancels and tries the next courier", async () => {
  const result = await fulfillCheapest({
    quotes: [
      quote({ provider: "delhivery", courier: "Delhivery", ratePaise: 4200 }),
      quote({ provider: "shiprocket", courier: "Xpressbees Surface", ratePaise: 9400, courierId: "51" }),
    ],
    canonical,
    create: async (candidate) => ({
      provider: candidate.provider,
      providerOrderId: candidate.courier,
      providerShipmentId: candidate.courier,
      awb: candidate.provider === "delhivery" ? "DL-PHONE" : "XB-OK",
      courierName: candidate.courier,
      labelUrl: null,
      pin: "134109",
      city: "Panchkula",
      state: "Haryana",
      phoneStored: candidate.provider !== "delhivery",
      possessed: false,
      unverified: false,
    }),
    reconcile: async () => null,
    cancel: async () => true,
  });
  assert.equal(result.accepted?.courier, "Xpressbees Surface");
  assert.equal(result.attempts[0].result, "cancelled");
});

test("Delhivery consignee pin is read and a hub name is not the city", () => {
  const parsed = parseDelhiveryPackage({
    ShipmentData: [{
      Shipment: {
        Destination: "Zirakpur_Dhakoli_D",
        Consignee: { City: "Panchkula", State: "Haryana", PinCode: 134109, Telephone1: "9988791797" },
        Status: { Status: "Manifested" },
      },
    }],
  });
  assert.equal(parsed.pin, "134109");
  assert.equal(parsed.city, "Panchkula");
  assert.equal(parsed.state, "Haryana");
  assert.equal(parsed.phoneStored, true);
});

test("two packed triggers share one lock", () => {
  let lockAt: string | null = null;
  const now = Date.parse("2026-09-24T12:00:00.000Z");
  const first = lockEligible(lockAt, now, 15 * 60 * 1000);
  if (first) lockAt = new Date(now).toISOString();
  const second = lockEligible(lockAt, now + 1000, 15 * 60 * 1000);
  assert.equal(first, true);
  assert.equal(second, false);
});

test("possession stops the run and formatting differences are not mismatches", () => {
  assert.equal(destinationRejected(canonical, { pin: "134109", city: "PANCHKULA", state: "HARYANA" }), false);
  assert.equal(destinationRejected(canonical, { pin: "134111", city: "Panchkula", state: "Haryana" }), true);
  assert.equal(lockAcquired([{ id: "one" }]), true);
  assert.equal(lockAcquired([]), false);
  assert.equal(resolveAutoPackage([{ qty: 2, weightGrams: 500, lengthMm: 300, widthMm: 250, heightMm: 30 }]).ok, false);
  assert.equal(rankEligibleQuotes([
    quote({ provider: "delhivery", courier: "Delhivery", ratePaise: 4200 }),
  ], ["delhivery"]).length, 0);
});
