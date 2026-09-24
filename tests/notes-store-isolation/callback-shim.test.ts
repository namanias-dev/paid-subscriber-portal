import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  maybeDispatchNotesStoreCallback,
  readCallbackParams,
} from "../../lib/store/payments/callbackDispatch";

/**
 * Proof for the one authorised boundary edit: the dispatcher shim at the top of
 * app/api/v1/bank/payment/route.ts.
 *
 * The risk being tested is the only one that matters — that reading the callback
 * body to find the reference leaves the course handler with an empty body. That
 * is precisely what killed the middleware option, and it is what req.clone()
 * avoids. These tests read the ORIGINAL request after the shim has run and
 * compare every field.
 */

/**
 * Copied verbatim from app/api/v1/bank/payment/route.ts:28-41 so this test
 * exercises the course handler's own body reading, not an approximation.
 */
async function courseReadParams(req: Request): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const url = new URL(req.url);
  url.searchParams.forEach((v, k) => map.set(k, v));
  if (req.method === "POST") {
    try {
      const form = await req.formData();
      form.forEach((v, k) => map.set(k, String(v)));
    } catch {
      /* may be GET-style */
    }
  }
  return map;
}

/** A realistic ICICI course callback: the full signed field set, plus RS. */
const COURSE_CALLBACK: Record<string, string> = {
  ID: "343526",
  "Response Code": "E000",
  "Unique Ref Number": "1128374651",
  "Service Tax Amount": "0.00",
  "Processing Fee Amount": "0.00",
  "Total Amount": "17500.00",
  "Transaction Amount": "17500.00",
  "Transaction Date": "18-09-2026 11:42:07",
  "Interchange Value": "0.00",
  TDR: "0.00",
  "Payment Mode": "NET_BANKING",
  SubMerchantId: "11",
  ReferenceNo: "NAMAN-KL7X9Q-4821",
  TPS: "Y",
  RS: "b4d1f0c8e29a7d5641bb0f2c8a9e7d3f1c0b8a6e5d4c3b2a1908f7e6d5c4b3a29",
  "Mandatory Fields": "NAMAN-KL7X9Q-4821|11|17500.00",
};

function buildCallback(fields: Record<string, string>, method: "POST" | "GET" = "POST"): Request {
  const body = new URLSearchParams(fields);
  if (method === "GET") {
    return new Request(`https://namanias.com/api/v1/bank/payment?${body.toString()}`, { method: "GET" });
  }
  return new Request("https://namanias.com/api/v1/bank/payment", {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

describe("course callback is untouched by the store dispatcher shim", () => {
  test("the shim does not claim a course callback", async () => {
    for (const ref of ["NAMAN-KL7X9Q-4821", "OFF-2X8K1-9931", "LEGACY-88213", "SAARTHI-4471-AB", ""]) {
      const req = buildCallback({ ...COURSE_CALLBACK, ReferenceNo: ref });
      assert.equal(await maybeDispatchNotesStoreCallback(req), null, ref);
    }
  });

  test("every field is still readable by the course handler AFTER the shim ran", async () => {
    // Control: what the course handler sees with no shim in front of it.
    const before = await courseReadParams(buildCallback(COURSE_CALLBACK));

    // With the shim: dispatcher runs first, declines, then the handler reads.
    const req = buildCallback(COURSE_CALLBACK);
    const claimed = await maybeDispatchNotesStoreCallback(req);
    assert.equal(claimed, null);
    const after = await courseReadParams(req);

    const rows: string[] = [];
    let identical = true;
    for (const key of Object.keys(COURSE_CALLBACK)) {
      const b = before.get(key);
      const a = after.get(key);
      if (b !== a) identical = false;
      rows.push(
        `  ${key.padEnd(21)} before=${JSON.stringify(b ?? null).padEnd(26)} after=${JSON.stringify(a ?? null).padEnd(26)} ${b === a ? "same" : "DIFFERENT"}`,
      );
    }
    console.log("\nCourse callback payload, field by field:\n" + rows.join("\n"));
    console.log(`  fields before=${before.size} after=${after.size} identical=${identical}\n`);

    assert.equal(after.size, before.size);
    assert.deepEqual([...after.entries()].sort(), [...before.entries()].sort());
    assert.equal(identical, true);
    assert.equal(after.get("ReferenceNo"), "NAMAN-KL7X9Q-4821");
    assert.equal(after.get("RS"), COURSE_CALLBACK.RS);
  });

  test("GET-style course callbacks are equally unaffected", async () => {
    const before = await courseReadParams(buildCallback(COURSE_CALLBACK, "GET"));
    const req = buildCallback(COURSE_CALLBACK, "GET");
    assert.equal(await maybeDispatchNotesStoreCallback(req), null);
    const after = await courseReadParams(req);
    assert.deepEqual([...after.entries()].sort(), [...before.entries()].sort());
  });

  test("a malformed body cannot make the shim claim a callback", async () => {
    const req = new Request("https://namanias.com/api/v1/bank/payment", {
      method: "POST",
      body: "%%%not-form-encoded%%%",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    assert.equal(await maybeDispatchNotesStoreCallback(req), null);
  });
});

describe("store callback is claimed by the shim", () => {
  test("a store reference is claimed and never falls through to course code", async () => {
    const req = buildCallback({ ...COURSE_CALLBACK, ReferenceNo: "NIASN-N-M2K4P1-7QRXAB" });
    const res = await maybeDispatchNotesStoreCallback(req);
    assert.ok(res, "store callback must be claimed");
    // No database in the test environment, so the honest response is to send the
    // customer to tracking rather than to the course status page.
    assert.equal(res!.status, 302);
    const location = res!.headers.get("Location") || "";
    console.log(`\nStore callback claimed → ${res!.status} ${location}\n`);
    assert.match(location, /^https:\/\/(www\.)?namanias\.com\/notes\//);
    assert.doesNotMatch(location, /payment\/status/);
  });

  test("the dispatcher's own reader sees the same fields as the course reader", async () => {
    const mine = await readCallbackParams(buildCallback(COURSE_CALLBACK));
    const theirs = await courseReadParams(buildCallback(COURSE_CALLBACK));
    assert.deepEqual([...mine.entries()].sort(), [...theirs.entries()].sort());
  });
});
