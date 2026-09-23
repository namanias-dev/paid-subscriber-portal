import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { compareCourierRates } from "../../lib/store/shipping/compare";
import { pickupPostcode, shippingWritesAuthorized } from "../../lib/store/shipping/config";
import { parseDelhiveryCharge, parseDelhiveryPincode } from "../../lib/store/shipping/delhiveryApi";
import { rupeesToPaise } from "../../lib/store/shipping/quotes";
import { parseShiprocketQuotes } from "../../lib/store/shipping/shiprocketApi";
import { canAdvanceOrder, canAdvanceShipment, normalizeCourierStatus } from "../../lib/store/shipping/status";
import { parseCourierWebhook, webhookAuthorized } from "../../lib/store/shipping/webhook";

const env = {
  SHIPROCKET_EMAIL: "api-user@example.com",
  SHIPROCKET_PASSWORD: "not-a-real-password",
  SHIPROCKET_API_BASE_URL: "https://ship.example/v1/external",
  DELHIVERY_API_TOKEN: "test-token",
  DELHIVERY_API_BASE_URL: "https://dl.example",
  NOTES_STORE_PICKUP_POSTCODE: "160017",
} as NodeJS.ProcessEnv;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("courier quotes", () => {
  test("rupees convert to integer paise", () => {
    assert.equal(rupeesToPaise(87.8), 8780);
    assert.equal(rupeesToPaise(65), 6500);
  });

  test("parsers keep only returned rates", () => {
    const ship = parseShiprocketQuotes({
      data: {
        available_courier_companies: [
          { courier_name: "Xpressbees", rate: 80, estimated_delivery_days: "4", etd: "Sep 27", cod: 0, is_surface: true },
        ],
      },
    });
    assert.equal(ship[0].ratePaise, 8000);
    assert.equal(ship[0].service, "Surface");
    assert.equal(ship[0].codSupported, false);

    const pin = parseDelhiveryPincode({
      delivery_codes: [{ postal_code: { pin: 110001, city: "Delhi", pre_paid: "Y", cod: "N", pickup: "Y" } }],
    });
    assert.equal(pin?.prepaid, true);
    assert.equal(pin?.cod, false);
    const charge = parseDelhiveryCharge([{ total_amount: 87.8, zone: "B", status: "Delivered" }], "Surface", false);
    assert.equal(charge?.ratePaise, 8780);
    assert.equal(charge?.service, "Surface · zone B");
  });

  test("compare calls read endpoints only", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const href = String(url);
      calls.push(href);
      if (href.includes("/auth/login")) return jsonResponse({ token: "jwt" });
      if (href.includes("/courier/serviceability/")) {
        return jsonResponse({
          data: { available_courier_companies: [{ courier_name: "Xpressbees", rate: 90, estimated_delivery_days: 4, cod: 0 }] },
        });
      }
      if (href.includes("/c/api/pin-codes/")) {
        return jsonResponse({ delivery_codes: [{ postal_code: { pre_paid: "Y", cod: "Y", pickup: "Y", city: "Delhi" } }] });
      }
      if (href.includes("md=S")) return jsonResponse([{ total_amount: 87.8, zone: "B" }]);
      if (href.includes("md=E")) return jsonResponse([{ total_amount: 110, zone: "B" }]);
      throw new Error(`unexpected ${href}`);
    }) as typeof fetch;

    const result = await compareCourierRates(
      { deliveryPostcode: "110001", weightGrams: 800, lengthCm: 30, widthCm: 22, heightCm: 3, declaredValuePaise: 239920 },
      { env, fetchImpl },
    );
    assert.equal(result.ok, true);
    assert.equal(result.writesAuthorized, false);
    assert.equal(result.lowest?.provider, "delhivery");
    assert.equal(result.lowest?.ratePaise, 8780);
    assert.equal(calls.some((u) => u.includes("orders/create") || u.includes("cmu/create") || u.includes("generate/pickup")), false);
    assert.equal(calls.filter((u) => u.includes("/auth/login")).length, 1);
  });

  test("missing pickup PIN does not call a courier", async () => {
    let called = false;
    const result = await compareCourierRates(
      { deliveryPostcode: "110001", weightGrams: 800, lengthCm: 30, widthCm: 22, heightCm: 3, declaredValuePaise: 100 },
      {
        env: {},
        fetchImpl: (() => {
          called = true;
          throw new Error("should not fetch");
        }) as typeof fetch,
      },
    );
    assert.equal(result.ok, false);
    assert.equal(called, false);
    assert.match(result.error || "", /PICKUP_POSTCODE/);
  });

  test("write gate stays closed unless both values are set", () => {
    assert.equal(shippingWritesAuthorized({}), false);
    assert.equal(shippingWritesAuthorized({ NOTES_STORE_SHIPPING_WRITES: "1" }), false);
    assert.equal(
      shippingWritesAuthorized({
        NOTES_STORE_SHIPPING_WRITES: "1",
        NOTES_STORE_SHIPPING_WRITE_CONFIRM: "I_AUTHORIZE_BILLABLE_SHIPMENT",
      }),
      true,
    );
    assert.equal(pickupPostcode({ NOTES_STORE_PICKUP_POSTCODE: "160017" }), "160017");
    assert.equal(pickupPostcode({ NOTES_STORE_PICKUP_POSTCODE: "016001" }), null);
  });
});

describe("courier tracking events", () => {
  test("delivered does not regress", () => {
    assert.equal(canAdvanceShipment("delivered", "in_transit"), false);
    assert.equal(canAdvanceShipment("in_transit", "out_for_delivery"), true);
    assert.equal(canAdvanceShipment("out_for_delivery", "delivery_failed"), true);
    assert.equal(canAdvanceOrder("DELIVERED", "IN_TRANSIT"), false);
    assert.equal(canAdvanceOrder("PACKED", "IN_TRANSIT"), true);
    assert.equal(canAdvanceOrder("PAYMENT_PENDING", "IN_TRANSIT"), false);
    assert.equal(normalizeCourierStatus("IN TRANSIT"), "in_transit");
    assert.equal(normalizeCourierStatus("PICKED UP"), "picked_up");
  });

  test("webhook shapes and the shared secret", () => {
    const ship = parseCourierWebhook({
      awb: "19041424751540",
      current_status: "IN TRANSIT",
      shipment_status: "IN TRANSIT",
      current_timestamp: "23 05 2023 11:43:52",
      activity: "In Transit - Shipment picked up",
    });
    assert.equal(ship?.provider, "shiprocket");
    assert.equal(ship?.mappedStatus, "in_transit");
    const dl = parseCourierWebhook({
      Shipment: { AWB: "DL123", Status: { Status: "Delivered", StatusDateTime: "2026-09-23 10:00:00", Instructions: "Delivered" } },
    });
    assert.equal(dl?.mappedStatus, "delivered");
    assert.equal(parseCourierWebhook({ hello: true }), null);
    assert.equal(webhookAuthorized(null, null), false);
    assert.equal(webhookAuthorized("abc", "abcd"), false);
    assert.equal(webhookAuthorized("same-key", "same-key"), true);
  });

  test("mark-shipped route does not call a courier API", () => {
    const src = readFileSync(new URL("../../app/api/admin/notes/orders/[id]/ship/route.ts", import.meta.url), "utf8");
    assert.match(src, /manualShippingProvider/);
    assert.equal(src.includes("orders/create"), false);
    assert.equal(src.includes("selectShippingProvider"), false);
  });
});
