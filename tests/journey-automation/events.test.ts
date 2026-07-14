/**
 * Part A — event-capture spike tests.
 *  (i)  Ingestion is IDEMPOTENT: the same dedupe_key ingests once.
 *  (ii) Ingestion is NON-BLOCKING: a persister failure is swallowed (never throws)
 *       and returns ok:false, so the host payment/webinar/cron flow is never broken.
 *  (iii) The built row carries only non-sensitive shape.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEventRow,
  ingestAutomationEvent,
  type PersistFn,
} from "../../lib/journey-automation/events";

describe("automation event ingest — idempotency", () => {
  it("dedupes on dedupe_key: first inserts, second is a duplicate", async () => {
    const seen = new Set<string>();
    const persist: PersistFn = async (row) => {
      if (row.dedupe_key && seen.has(row.dedupe_key)) return "duplicate";
      if (row.dedupe_key) seen.add(row.dedupe_key);
      return "inserted";
    };
    const key = `payment_received:test-ref-1`;
    const a = await ingestAutomationEvent({ eventType: "payment_received", dedupeKey: key }, persist);
    const b = await ingestAutomationEvent({ eventType: "payment_received", dedupeKey: key }, persist);
    assert.equal(a.ok, true);
    assert.equal(a.inserted, true);
    assert.equal(b.ok, true);
    assert.equal(b.inserted, false); // idempotent — not inserted again
  });

  it("default (no-DB) persister is idempotent across calls", async () => {
    const key = `webinar_registered:reg:${Math.random().toString(36).slice(2)}`;
    const a = await ingestAutomationEvent({ eventType: "webinar_registered", dedupeKey: key });
    const b = await ingestAutomationEvent({ eventType: "webinar_registered", dedupeKey: key });
    assert.equal(a.inserted, true);
    assert.equal(b.inserted, false);
  });
});

describe("automation event ingest — non-blocking swallow on failure", () => {
  it("never throws when the persister fails, and reports ok:false", async () => {
    const boom: PersistFn = async () => { throw new Error("db down"); };
    let threw = false;
    let result;
    try {
      result = await ingestAutomationEvent({ eventType: "installment_overdue", dedupeKey: "x" }, boom);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "ingest must never throw into the caller");
    assert.equal(result?.ok, false);
    assert.equal(result?.inserted, false);
  });
});

describe("automation event row shape", () => {
  it("builds a normalized row with defaults and no sensitive fields", () => {
    const row = buildEventRow({
      eventType: "payment_received",
      phone: "9999999999",
      paymentId: "REF123",
      payload: { amount: 100, item_type: "course" },
      dedupeKey: "payment_received:REF123",
      source: "payment",
    });
    assert.equal(row.event_type, "payment_received");
    assert.equal(row.payment_id, "REF123");
    assert.equal(row.source, "payment");
    assert.equal(row.dedupe_key, "payment_received:REF123");
    assert.deepEqual(row.payload, { amount: 100, item_type: "course" });
    // Defaults for unset subject refs.
    assert.equal(row.student_id, null);
    assert.equal(row.webinar_id, null);
    assert.ok(typeof row.occurred_at === "string");
    // No secret-ish keys ever present.
    assert.equal("login_code" in (row.payload as Record<string, unknown>), false);
  });
});
