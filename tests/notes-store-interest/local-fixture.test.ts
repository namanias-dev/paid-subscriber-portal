import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { storeDb } from "../../lib/store/db";
import {
  LOCAL_FIXTURE_AWB,
  LOCAL_FIXTURE_ORDER_NO,
  applyLocalFixtureScene,
  localFixtureClient,
  localFixtureEnabled,
  resetLocalFixture,
} from "../../lib/store/localFixture";
import { staffPaymentLabel } from "../../lib/store/orders";
import { customerStageLabel, projectCustomerStage } from "../../lib/store/projection";

describe("local notes fixture isolation", () => {
  test("stays off on Vercel even when the flag is set", () => {
    assert.equal(localFixtureEnabled({ NOTES_STORE_LOCAL_FIXTURE: "1", VERCEL: "1" }), false);
    assert.equal(localFixtureEnabled({ NOTES_STORE_LOCAL_FIXTURE: "1", VERCEL_ENV: "production" }), false);
    assert.equal(localFixtureEnabled({ NOTES_STORE_LOCAL_FIXTURE: "0" }), false);
    assert.equal(localFixtureEnabled({ NOTES_STORE_LOCAL_FIXTURE: "1" }), true);
  });

  test("storeDb does not open the fixture while VERCEL is set", () => {
    const prev = process.env.NOTES_STORE_LOCAL_FIXTURE;
    const vercel = process.env.VERCEL;
    process.env.NOTES_STORE_LOCAL_FIXTURE = "1";
    process.env.VERCEL = "1";
    try {
      assert.equal(localFixtureEnabled(), false);
      const db = storeDb();
      if (db) {
        const bag = db as unknown as { from?: unknown; rpc?: unknown };
        assert.equal(typeof bag.rpc, "function");
      }
    } finally {
      if (prev === undefined) delete process.env.NOTES_STORE_LOCAL_FIXTURE;
      else process.env.NOTES_STORE_LOCAL_FIXTURE = prev;
      if (vercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = vercel;
    }
  });

  test("seeds one test order and never a live charge", async () => {
    resetLocalFixture();
    const db = localFixtureClient();
    const { data: orders, count } = await db.from("store_orders").select("id,order_no,customer_name,phone,total_paise", { count: "exact" });
    assert.equal(count, 1);
    assert.equal(orders[0].order_no, LOCAL_FIXTURE_ORDER_NO);
    assert.equal(orders[0].customer_name, "Naman IAS Shipping Test");
    const { data: addr } = await db.from("store_addresses").select("pincode,city").eq("id", "22222222-2222-4222-8222-222222222222").maybeSingle();
    assert.equal(addr.pincode, "110001");
    assert.equal(addr.city, "New Delhi");
    const { data: item } = await db.from("store_order_items").select("name_snapshot,sku_snapshot,qty,unit_price_paise").eq("order_id", orders[0].id).maybeSingle();
    assert.equal(item.name_snapshot, "Indian Polity Notes");
    assert.equal(item.sku_snapshot, "POLITY");
    assert.equal(item.qty, 1);
    assert.equal(item.unit_price_paise, 239920);
    const { data: pay } = await db.from("store_order_payments").select("provider,status,gateway_ref").eq("order_id", orders[0].id).maybeSingle();
    assert.equal(pay.provider, "TEST_FIXTURE");
    assert.equal(pay.gateway_ref, "TEST-NO-CHARGE");
    assert.equal(staffPaymentLabel(pay.provider, pay.status), "TEST — simulated, no gateway charge");
    const { data: byPhone } = await db.from("store_orders").select("order_no").eq("phone_key", "9000000001").maybeSingle();
    assert.equal(byPhone.order_no, LOCAL_FIXTURE_ORDER_NO);
  });

  test("a label scene does not mark the order shipped", () => {
    const result = applyLocalFixtureScene("awb_label");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.status, "READY_FOR_PICKUP");
    const db = localFixtureClient();
    return db
      .from("store_shipments")
      .select("awb,status,provider_payload")
      .eq("awb", LOCAL_FIXTURE_AWB)
      .maybeSingle()
      .then(({ data }) => {
        assert.equal(data.awb, LOCAL_FIXTURE_AWB);
        assert.equal(data.status, "manifested");
        assert.equal(data.provider_payload.label_url, "fixture:test-label");
        assert.equal(projectCustomerStage("READY_FOR_PICKUP", true), "packed");
        assert.equal(projectCustomerStage("PICKUP_SCHEDULED", true), "packed");
        assert.equal(projectCustomerStage("PICKED_UP", true), "shipped");
      });
  });

  test("exception wording stays in plain language", () => {
    assert.equal(customerStageLabel(projectCustomerStage("DELIVERY_FAILED", true)), "Delivery needs another attempt");
    assert.equal(customerStageLabel(projectCustomerStage("RTO_INITIATED", true)), "On the way back to Naman IAS");
    assert.equal(customerStageLabel(projectCustomerStage("RETURN_REQUESTED", true)), "Return request received");
    assert.equal(customerStageLabel(projectCustomerStage("REFUND_PENDING", true)), "Refund pending");
    assert.equal(projectCustomerStage("DELIVERED", true), "delivered");
  });

  test("carrier choice route does not book a courier", () => {
    const src = readFileSync(join(process.cwd(), "app/api/admin/notes/orders/[id]/carrier/route.ts"), "utf8");
    assert.equal(src.includes("createProviderShipment"), false);
    assert.equal(src.includes("requestProviderPickup"), false);
    assert.match(src, /booked: false/);
    const fixture = readFileSync(join(process.cwd(), "app/api/admin/notes/fixture/route.ts"), "utf8");
    assert.match(fixture, /localFixtureEnabled/);
    assert.equal(fixture.includes("createProviderShipment"), false);
  });
});
