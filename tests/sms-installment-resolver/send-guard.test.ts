/**
 * THE REGRESSION TEST THAT MATTERS: an unresolved body must not be able to
 * reach the gateway.
 *
 * The parser fix stops the "Installment Reminder" template from producing a
 * half-rendered body. This suite protects against the NEXT one — a new
 * template, a new spelling, a stale body replayed by a retry — by asserting at
 * the only place that actually matters: the outbound HTTP call.
 *
 * Every test here stubs global fetch and asserts the call count. Zero outbound
 * calls is the pass condition, so the suite cannot itself send an SMS.
 */
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { checkRenderedBody, leftoverPlaceholders } from "../../lib/sms/sendGuard";
import { sendViaGateway, sendBulkViaGateway } from "../../lib/sms/gateway";

const RENDERED_OK =
  "Hi Priya, your course fee installment no. 2 of Rs.8000 is due. " +
  "Login: namanias.com/login Code: ABCD1234 to complete payment. Naman Sharma IAS Academy.";

/** What the student actually received. */
const RENDERED_BROKEN =
  "Hi Priya, your course fee installment no. {No_of_Installment} of Rs.{Fee_in_Rs} is due. " +
  "Login: namanias.com/login Code: ABCD1234 to complete payment. Naman Sharma IAS Academy.";

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };
let fetchCalls: string[] = [];

beforeEach(() => {
  fetchCalls = [];
  // Credentials are deliberately PRESENT: without them the gateway short-circuits
  // on "not configured" and every test below would pass for the wrong reason.
  process.env.SMS_API_AUTH_KEY = "test-key";
  process.env.SMS_API_USERNAME = "test-user";
  process.env.SMS_API_PASSWORD = "test-pass";
  globalThis.fetch = (async (url: unknown) => {
    fetchCalls.push(String(url));
    return new Response("Submitted Successfully | 123456789", { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...realEnv };
});

describe("checkRenderedBody", () => {
  test("passes a fully rendered body", () => {
    assert.equal(checkRenderedBody(RENDERED_OK).ok, true);
  });

  test("blocks the exact body the student received", () => {
    const r = checkRenderedBody(RENDERED_BROKEN);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unresolved_placeholder");
    assert.deepEqual(r.offenders, ["No_of_Installment", "Fee_in_Rs"]);
  });

  test("blocks a stray brace even with no token inside", () => {
    assert.equal(checkRenderedBody("Hi Priya, your fee is due }").ok, false);
  });

  test("blocks an empty body", () => {
    assert.equal(checkRenderedBody("   ").reason, "empty_body");
  });

  test("blocks when a variable resolved to a dud value", () => {
    // No braces survive — the token rendered, just to garbage. Length and
    // charset validation would wave this through.
    const r = checkRenderedBody("Hi Priya, installment no. undefined of Rs.NaN is due.", {
      no_of_installment: "undefined",
      fee_in_rs: NaN,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unresolved_variable");
    assert.deepEqual(r.offenders.sort(), ["fee_in_rs", "no_of_installment"]);
  });

  test("leftoverPlaceholders names each token once, in order", () => {
    assert.deepEqual(leftoverPlaceholders("{a} {b} {a}"), ["a", "b"]);
  });
});

describe("the gateway refuses to transmit an unrendered body", () => {
  test("sendViaGateway makes ZERO outbound calls for a braced body", async () => {
    const res = await sendViaGateway({
      digits10: "9876543210",
      message: RENDERED_BROKEN,
      templateId: "1777178513223214410",
    });
    assert.equal(fetchCalls.length, 0, "an unresolved body reached the SMS gateway");
    assert.equal(res.ok, false);
    assert.equal(res.status, "FAILED");
    assert.equal(res.response.error, "blocked:unresolved_placeholder");
  });

  test("sendBulkViaGateway makes ZERO outbound calls for a braced body", async () => {
    const res = await sendBulkViaGateway({
      digits10List: ["9876543210", "9876543211"],
      message: RENDERED_BROKEN,
      templateId: "1777178513223214410",
    });
    assert.equal(fetchCalls.length, 0, "an unresolved body reached the bulk SMS gateway");
    assert.equal(res.ok, false);
    assert.equal(res.response.error, "blocked:unresolved_placeholder");
  });

  test("a correctly rendered body DOES reach the gateway", () => {
    // The counterweight: proving the guard blocks is worthless if it blocks
    // everything. Without this, deleting the fetch call would pass the suite.
    return sendViaGateway({
      digits10: "9876543210",
      message: RENDERED_OK,
      templateId: "1777178513223214410",
    }).then((res) => {
      assert.equal(fetchCalls.length, 1);
      assert.equal(res.ok, true);
    });
  });

  test("the guard runs BEFORE the credential check, so it cannot be skipped", async () => {
    delete process.env.SMS_API_AUTH_KEY;
    const res = await sendViaGateway({ digits10: "9876543210", message: RENDERED_BROKEN, templateId: "x" });
    assert.equal(fetchCalls.length, 0);
    assert.equal(
      res.response.error,
      "blocked:unresolved_placeholder",
      "An unconfigured gateway must still report the render failure, not mask it as a config problem.",
    );
  });
});

describe("an ABSENT variable is still caught at the gateway", () => {
  // Found during QA of this very change. renderTemplate used to replace an
  // unresolved token with an empty string, so a body rendered without
  // No_of_Installment/Fee_in_Rs came out as "installment no.  of Rs. is due" —
  // brace-free, and therefore invisible to a guard that looks for braces. The
  // service layer caught it via `missing`, but the gateway-level guarantee —
  // the whole point of the last-mile check — did not. renderTemplate now leaves
  // the token in place so the failure travels with the text.
  test("renderTemplate leaves an unresolved token visible instead of blanking it", async () => {
    const { renderTemplate } = await import("../../lib/sms/templates");
    const { text, missing } = renderTemplate(
      "Hi {first_name}, installment no. {No_of_Installment} of Rs.{Fee_in_Rs} is due.",
      { first_name: "Priya" },
    );
    assert.deepEqual(missing, ["No_of_Installment", "Fee_in_Rs"]);
    assert.match(text, /no\. \{No_of_Installment\} of Rs\.\{Fee_in_Rs\}/);
    assert.ok(
      !/no\.\s{2,}of Rs\.\s/.test(text),
      "A blanked-out token renders as an innocuous gap that no downstream check can detect.",
    );
  });

  test("that body makes ZERO outbound calls", async () => {
    const { renderTemplate } = await import("../../lib/sms/templates");
    const { text } = renderTemplate(
      "Hi {first_name}, installment no. {No_of_Installment} of Rs.{Fee_in_Rs} is due.",
      { first_name: "Priya" },
    );
    const res = await sendViaGateway({ digits10: "9876543210", message: text, templateId: "1777178513223214410" });
    assert.equal(fetchCalls.length, 0, "a body with absent variables reached the SMS gateway");
    assert.equal(res.response.error, "blocked:unresolved_placeholder");
  });
});

describe("the guard is structurally present at every outbound call", () => {
  test("no fetch in gateway.ts sends a message without passing guardOutboundBody", async () => {
    // A behavioural test only covers the paths it calls. This one fails if
    // someone adds a THIRD send function and forgets the guard.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname, "..", "..", "lib", "sms", "gateway.ts"), "utf8");

    const senders = [...src.matchAll(/export async function (send\w*ViaGateway)\s*\([\s\S]*?\n}/g)];
    assert.ok(senders.length >= 2, "expected to find the single + bulk send functions");
    for (const [fnSrc, name] of senders.map((m) => [m[0], m[1]] as const)) {
      assert.ok(
        fnSrc.includes("guardOutboundBody("),
        `${name} calls the SMS gateway without running the hard send guard first.`,
      );
      assert.ok(
        fnSrc.indexOf("guardOutboundBody(") < fnSrc.indexOf("fetch("),
        `${name} runs the send guard AFTER its fetch — the message would already be gone.`,
      );
    }
  });

  test("the service layer also guards, so blocks carry a named skip reason", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname, "..", "..", "lib", "sms", "service.ts"), "utf8");
    // sendSms + sendBatch (+ previewSms) must go through the shared pipeline,
    // which runs checkRenderedBody / prepareDltFreeTextVars internally.
    const hits = src.match(/prepareAndRenderSms\(/g) || [];
    assert.ok(
      hits.length >= 2,
      "Both sendSms and the sendBatch screening loop must run prepareAndRenderSms so a " +
        "blocked recipient is reported to the UI instead of failing silently at the gateway.",
    );
  });
});
