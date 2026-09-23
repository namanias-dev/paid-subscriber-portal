import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  cancelProviderShipment,
  createProviderShipment,
  fetchExistingLabel,
  parseDelhiveryCreate,
  parseShiprocketCreate,
  requestProviderPickup,
  requestReverseShipment,
} from "../../lib/store/shipping/book";
import { compareCourierRates } from "../../lib/store/shipping/compare";
import { delhiveryPickupLocation, pickupPostcode, shippingWritesAuthorized, shiprocketPickupLocation } from "../../lib/store/shipping/config";
import { delhiveryPackingSlipPath, parseDelhiveryCharge, parseDelhiveryPincode } from "../../lib/store/shipping/delhiveryApi";
import { canRequestSupport, delhiveryCreateBody, dispatchBlocked, fulfilmentAttention, operationalActions, refundRequestPaise, shipmentAlreadyActive } from "../../lib/store/shipping/dispatch";
import { customerStageLabel, projectCustomerStage } from "../../lib/store/projection";
import { rupeesToPaise } from "../../lib/store/shipping/quotes";
import { classifyTrackingGap, shouldPollShipment } from "../../lib/store/shipping/reconcile";
import { parseShiprocketQuotes, shiprocketAdhocDraft } from "../../lib/store/shipping/shiprocketApi";
import { canAdvanceOrder, canAdvanceShipment, normalizeCourierStatus } from "../../lib/store/shipping/status";
import { parseCourierWebhook, scanAlreadyRecorded, webhookAuthorized } from "../../lib/store/shipping/webhook";

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

describe("dispatch and support gates", () => {
  test("booking stays off and an existing AWB blocks a second shipment", () => {
    assert.equal(dispatchBlocked({}), "Live shipping is not enabled yet. No label, AWB, or pickup is sent to a courier. Enter the AWB manually after the parcel is handed over.");
    assert.equal(
      dispatchBlocked({
        NOTES_STORE_SHIPPING_WRITES: "1",
        NOTES_STORE_SHIPPING_WRITE_CONFIRM: "I_AUTHORIZE_BILLABLE_SHIPMENT",
      }),
      null,
    );
    assert.equal(shipmentAlreadyActive("in_transit", "AWB1"), true);
    assert.equal(shipmentAlreadyActive("pending", null), false);
    assert.equal(canRequestSupport("DELIVERED"), true);
    assert.equal(canRequestSupport("PACKED"), false);
    assert.deepEqual(refundRequestPaise(1000, 200, 900), { error: "Refund is larger than the amount still available." });
    assert.deepEqual(refundRequestPaise(1000, 200, 800), { amount: 800 });
    const body = delhiveryCreateBody({
      pickupName: "NAMAN SHARMA IAS ACADEMY",
      orderNo: "NIASN-N-1",
      name: "A",
      address: "Line",
      pin: "110001",
      city: "Delhi",
      state: "Delhi",
      phone: "9999999999",
      product: "Polity",
      amountRupees: 100,
      weightGrams: 800,
      lengthCm: 30,
      widthCm: 22,
      heightCm: 3,
    });
    assert.match(body, /^format=json&data=/);
    assert.match(decodeURIComponent(body), /"name":"NAMAN SHARMA IAS ACADEMY"/);
    assert.equal(body.includes("cmu/create"), false);
    assert.equal(delhiveryPackingSlipPath("AWB1").includes("cmu/create"), false);
    assert.match(delhiveryPackingSlipPath("AWB1"), /packing_slip/);
    assert.equal(delhiveryPickupLocation({ DELHIVERY_PICKUP_LOCATION: "NAMAN SHARMA IAS ACADEMY" }), "NAMAN SHARMA IAS ACADEMY");
    assert.equal(shiprocketPickupLocation({ SHIPROCKET_PICKUP_LOCATION: "work" }), "work");
    const draft = shiprocketAdhocDraft({
      pickupLocation: "work",
      orderNumber: "NIASN-N-1",
      name: "A",
      address: "Line",
      pin: "110001",
      city: "Delhi",
      state: "Delhi",
      phone: "9999999999",
      product: "Polity",
      amountRupees: 100,
      weightKg: 0.8,
      lengthCm: 30,
      widthCm: 22,
      heightCm: 3,
    });
    assert.equal(draft.pickup_location, "work");
    assert.throws(() =>
      shiprocketAdhocDraft({
        pickupLocation: "117035417",
        orderNumber: "NIASN-N-1",
        name: "A",
        address: "Line",
        pin: "110001",
        city: "Delhi",
        state: "Delhi",
        phone: "9999999999",
        product: "Polity",
        amountRupees: 100,
        weightKg: 0.8,
        lengthCm: 30,
        widthCm: 22,
        heightCm: 3,
      }),
    );
    assert.deepEqual(fulfilmentAttention({ orderStatus: "READY_FOR_PICKUP", awb: "AWB1", hasLabel: false }), ["label_missing"]);
    assert.deepEqual(fulfilmentAttention({ orderStatus: "PICKED_UP", awb: "AWB1", hasLabel: true }), []);
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
    assert.equal(normalizeCourierStatus("Manifested"), "manifested");
    assert.equal(normalizeCourierStatus("Ready To Ship"), "manifested");
    assert.equal(normalizeCourierStatus("Out for Delivery"), "out_for_delivery");
    assert.equal(normalizeCourierStatus("Dispatched"), "out_for_delivery");
    assert.equal(normalizeCourierStatus("Delivered"), "delivered");
    assert.equal(normalizeCourierStatus("Failed Delivery"), "delivery_failed");
    assert.equal(normalizeCourierStatus("RTO"), "rto");
    assert.equal(normalizeCourierStatus("Lost"), "lost");
    assert.equal(projectCustomerStage("PICKED_UP", true), "shipped");
    assert.equal(projectCustomerStage("IN_TRANSIT", true), "in_transit");
    assert.equal(projectCustomerStage("OUT_FOR_DELIVERY", true), "out_for_delivery");
    assert.equal(projectCustomerStage("DELIVERED", true), "delivered");
    assert.equal(projectCustomerStage("READY_FOR_PICKUP", true), "packed");
    assert.deepEqual(
      ["ORDER_CONFIRMED", "PROCESSING", "PACKED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"].map((status) =>
        customerStageLabel(projectCustomerStage(status, status === "PICKED_UP")),
      ),
      ["Order Confirmed", "Preparing Your Notes", "Packed", "Shipped", "In Transit", "Out for Delivery", "Delivered"],
    );
    const track = readFileSync(new URL("../../app/api/notes/track/route.ts", import.meta.url), "utf8");
    assert.match(track, /phone_key !== phone/);
    assert.equal(track.includes("line1"), false);
    const publicOrder = readFileSync(new URL("../../lib/store/orders.ts", import.meta.url), "utf8");
    assert.match(publicOrder, /if \(!token\) return null/);
    assert.match(publicOrder, /verifyRawTokenAgainstHash/);
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
    const dispatch = readFileSync(new URL("../../app/api/admin/notes/orders/[id]/dispatch/route.ts", import.meta.url), "utf8");
    assert.match(dispatch, /dispatchBlocked/);
    assert.match(dispatch, /createProviderShipment/);
    assert.equal(dispatch.includes("cmu/create"), false);
    assert.equal(dispatch.includes("shipped_at"), false);
    const label = readFileSync(new URL("../../app/api/admin/notes/orders/[id]/label/route.ts", import.meta.url), "utf8");
    assert.equal(label.includes("orders/create"), false);
    assert.equal(label.includes("cmu/create"), false);
    const pickup = readFileSync(new URL("../../app/api/admin/notes/orders/[id]/pickup/route.ts", import.meta.url), "utf8");
    assert.match(pickup, /dispatchBlocked/);
    assert.equal(pickup.includes("PICKED_UP"), false);
    assert.equal(pickup.includes("shipped_at"), false);
    const refund = readFileSync(new URL("../../app/api/admin/notes/orders/[id]/refund/route.ts", import.meta.url), "utf8");
    assert.equal(refund.includes("fetch("), false);
    assert.match(refund, /gateway: "not_called"/);
    assert.match(refund, /duplicate: true/);
    assert.match(refund, /RECORD_MANUAL_REFUND/);
    assert.match(refund, /gateway: "manual"/);
    const eazypay = readFileSync(new URL("../../lib/store/payments/eazypay.ts", import.meta.url), "utf8");
    assert.match(eazypay, /EazyPGVerify/);
    assert.equal(eazypay.toLowerCase().includes("refund"), false);
    const support = readFileSync(new URL("../../app/api/admin/notes/orders/[id]/support-decision/route.ts", import.meta.url), "utf8");
    assert.match(support, /dispatchBlocked/);
    assert.match(support, /shipment: "not_created"/);
    assert.equal(support.includes("EazyPG"), false);
    const tracking = readFileSync(new URL("../../app/api/cron/notes-store-tracking/route.ts", import.meta.url), "utf8");
    assert.match(tracking, /shouldPollShipment/);
    assert.match(tracking, /CRON_SECRET/);
    assert.equal(tracking.includes("orders/create"), false);
    assert.equal(tracking.includes("cmu/create"), false);
    assert.equal(tracking.includes("delivered"), true);
    assert.match(tracking, /errors \+= 1/);
    assert.equal(canAdvanceShipment("out_for_delivery", "in_transit"), false);
    assert.equal(normalizeCourierStatus("NDR"), "delivery_failed");
    assert.equal(normalizeCourierStatus("RTO Initiated"), "rto");
    assert.equal(canAdvanceShipment("delivered", "rto"), false);
    assert.equal(scanAlreadyRecorded(["shiprocket:1:IN TRANSIT:"], "shiprocket:1:IN TRANSIT:"), true);
    assert.equal(scanAlreadyRecorded([], "shiprocket:1:IN TRANSIT:"), false);
  });

  test("reconciliation polls open shipments and leaves delivered alone", () => {
    const base = {
      provider: "shiprocket",
      awb: "SR1",
      createdAt: "2026-09-20T00:00:00.000Z",
      now: "2026-09-23T00:00:00.000Z",
    };
    assert.deepEqual(classifyTrackingGap({ ...base, status: "delivered", lastSyncedAt: "2026-09-01T00:00:00.000Z" }), []);
    assert.equal(shouldPollShipment({ ...base, status: "delivered", lastSyncedAt: "2026-09-01T00:00:00.000Z" }), false);
    assert.equal(shouldPollShipment({ ...base, status: "in_transit", lastSyncedAt: "2026-09-22T20:00:00.000Z" }), false);
    assert.equal(shouldPollShipment({ ...base, status: "in_transit", lastSyncedAt: "2026-09-21T00:00:00.000Z" }), true);
    assert.ok(classifyTrackingGap({ ...base, status: "delivery_failed", lastSyncedAt: "2026-09-22T23:00:00.000Z" }).includes("ndr"));
    assert.equal(shouldPollShipment({ ...base, status: "delivery_failed", lastSyncedAt: "2026-09-22T23:00:00.000Z" }), false);
    assert.ok(classifyTrackingGap({ ...base, status: "rto", lastSyncedAt: "2026-09-22T23:00:00.000Z" }).includes("rto"));
    assert.ok(
      classifyTrackingGap({
        ...base,
        status: "manifested",
        pickupScheduledAt: "2026-09-21T00:00:00.000Z",
        lastSyncedAt: null,
      }).includes("pickup_overdue"),
    );
    assert.ok(classifyTrackingGap({ ...base, status: "manifested", lastSyncedAt: null }).includes("no_first_scan"));
    assert.ok(
      classifyTrackingGap({
        ...base,
        status: "in_transit",
        lastSyncedAt: "2026-09-22T12:00:00.000Z",
        expectedDeliveryDate: "2026-09-22",
      }).includes("eta_exceeded"),
    );
    assert.equal(shouldPollShipment({ ...base, provider: "manual", status: "in_transit", lastSyncedAt: "2026-09-01T00:00:00.000Z" }), false);
    assert.equal(shouldPollShipment({ ...base, awb: "", status: "in_transit", lastSyncedAt: null }), false);
    const events = ["PICKED UP", "IN TRANSIT", "OUT FOR DELIVERY", "Delivered", "Failed Delivery", "NDR", "RTO"];
    for (const raw of events) {
      const parsed = parseCourierWebhook({ awb: "SR9", current_status: raw, shipment_status: raw, current_timestamp: "2026-09-23 10:00:00" });
      assert.ok(parsed?.mappedStatus, raw);
      assert.equal(scanAlreadyRecorded([parsed!.dedupeKey], parsed!.dedupeKey), true);
    }
    assert.equal(canAdvanceShipment("delivered", "rto"), false);
    assert.equal(canAdvanceOrder("DELIVERED", "IN_TRANSIT"), false);
  });

  test("overview actions stay inside the existing order queue", () => {
    const now = "2026-09-23T00:00:00.000Z";
    assert.deepEqual(operationalActions({ orderStatus: "PACKED", now }), ["awb_missing"]);
    assert.deepEqual(operationalActions({ orderStatus: "REFUND_PENDING", now }), ["refund_manual"]);
    assert.deepEqual(operationalActions({ orderStatus: "RETURN_REQUESTED", now }), ["return_waiting"]);
    assert.ok(operationalActions({ orderStatus: "DELIVERY_FAILED", now, shipmentStatus: "delivery_failed" }).includes("ndr"));
    assert.ok(
      operationalActions({
        orderStatus: "PICKUP_SCHEDULED",
        now,
        awb: "AWB1",
        provider: "delhivery",
        shipmentStatus: "manifested",
        shipmentCreatedAt: "2026-09-20T00:00:00.000Z",
        pickupScheduledAt: "2026-09-21T00:00:00.000Z",
      }).includes("pickup_overdue"),
    );
    assert.deepEqual(operationalActions({ orderStatus: "DELIVERED", now, shipmentStatus: "delivered", awb: "AWB1" }), []);
  });
});

const party = {
  orderNumber: "NIASN-N-1",
  name: "A",
  address: "Line",
  pin: "110001",
  city: "Delhi",
  state: "Delhi",
  phone: "9999999999",
  product: "Polity",
  amountRupees: 100,
  weightGrams: 800,
  lengthCm: 30,
  widthCm: 22,
  heightCm: 3,
};

const openEnv = {
  ...env,
  NOTES_STORE_SHIPPING_WRITES: "1",
  NOTES_STORE_SHIPPING_WRITE_CONFIRM: "I_AUTHORIZE_BILLABLE_SHIPMENT",
  DELHIVERY_PICKUP_LOCATION: "NAMAN SHARMA IAS ACADEMY",
  SHIPROCKET_PICKUP_LOCATION: "work",
} as NodeJS.ProcessEnv;

describe("gated courier writes", () => {
  test("a closed gate never calls a courier", async () => {
    let called = false;
    const fetchImpl = (() => {
      called = true;
      throw new Error("should not fetch");
    }) as typeof fetch;
    await assert.rejects(() => createProviderShipment({ ...party, provider: "delhivery" }, { env, fetchImpl }));
    await assert.rejects(() => requestProviderPickup({ provider: "delhivery", date: "2026-09-24" }, { env, fetchImpl }));
    await assert.rejects(() => cancelProviderShipment({ provider: "delhivery", awb: "AWB1" }, { env, fetchImpl }));
    await assert.rejects(() => requestReverseShipment({ ...party, provider: "delhivery" }, { env, fetchImpl }));
    assert.equal(called, false);
  });

  test("shiprocket create posts the nickname and skips pickup", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push(`${init?.method || "GET"} ${href}`);
      if (href.endsWith("/auth/login")) return jsonResponse({ token: "jwt" });
      if (href.endsWith("/orders/create/adhoc")) {
        const posted = JSON.parse(String(init?.body));
        assert.equal(posted.pickup_location, "work");
        return jsonResponse({ shipment_id: 55, order_id: 9, awb_code: "", courier_name: "" });
      }
      if (href.endsWith("/courier/assign/awb")) return jsonResponse({ response: { data: { awb_code: "SR1", courier_name: "Xpressbees" } } });
      if (href.endsWith("/courier/generate/label")) return jsonResponse({ label_url: "https://labels.example/sr1.pdf" });
      throw new Error(`unexpected ${href}`);
    }) as typeof fetch;
    const created = await createProviderShipment({ ...party, provider: "shiprocket", courierId: "12" }, { env: openEnv, fetchImpl });
    assert.equal(created.awb, "SR1");
    assert.equal(created.orderStatus, "READY_FOR_PICKUP");
    assert.equal(created.labelUrl, "https://labels.example/sr1.pdf");
    assert.equal(calls.some((u) => u.includes("generate/pickup") || u.includes("cmu/create")), false);
    assert.equal(parseShiprocketCreate({ shipment_id: 1, awb_code: "" }).awb, null);
  });

  test("delhivery create sends the facility name and does not invent an AWB", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      const raw = String(init?.body);
      assert.match(decodeURIComponent(raw), /"name":"NAMAN SHARMA IAS ACADEMY"/);
      assert.match(decodeURIComponent(raw), /"payment_mode":"Prepaid"/);
      return jsonResponse({ packages: [{ waybill: "", remarks: ["ClientWarehouse matching query doesn't exist"] }] });
    }) as typeof fetch;
    await assert.rejects(() => createProviderShipment({ ...party, provider: "delhivery" }, { env: openEnv, fetchImpl }));
    assert.equal(parseDelhiveryCreate({ packages: [] }).awb, null);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/api\/cmu\/create\.json$/);
  });

  test("label reprint reads a stored slip and does not create a shipment", async () => {
    let called = false;
    const stored = await fetchExistingLabel(
      { provider: "delhivery", awb: "AWB1", storedLabelUrl: "https://labels.example/a.pdf" },
      {
        env: openEnv,
        fetchImpl: (() => {
          called = true;
          throw new Error("should not fetch");
        }) as typeof fetch,
      },
    );
    assert.equal(stored.url, "https://labels.example/a.pdf");
    assert.equal(called, false);
    const fetched = await fetchExistingLabel(
      { provider: "delhivery", awb: "AWB1" },
      {
        env: openEnv,
        fetchImpl: (async (url: string | URL | Request) => {
          assert.match(String(url), /packing_slip/);
          assert.equal(String(url).includes("cmu/create"), false);
          return jsonResponse({ packages: [{ pdf_download_link: "https://labels.example/b.pdf" }] });
        }) as typeof fetch,
      },
    );
    assert.equal(fetched.url, "https://labels.example/b.pdf");
  });

  test("reverse pickup is gated and uses Delhivery Pickup mode", async () => {
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      assert.match(decodeURIComponent(String(init?.body)), /"payment_mode":"Pickup"/);
      return jsonResponse({ packages: [{ waybill: "R1" }] });
    }) as typeof fetch;
    const reverse = await requestReverseShipment({ ...party, provider: "delhivery" }, { env: openEnv, fetchImpl });
    assert.equal(reverse.awb, "R1");
    await assert.rejects(() => requestReverseShipment({ ...party, provider: "shiprocket" }, { env: openEnv, fetchImpl: fetchImpl }));
  });
});
