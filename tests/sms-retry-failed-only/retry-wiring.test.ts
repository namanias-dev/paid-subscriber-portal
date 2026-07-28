/**
 * Structural guards on the retry wiring.
 *
 * The original bug was not a wrong comparison, it was a wrong SHAPE: the retry
 * request carried a recipient list, so the client got to decide who a retry
 * reached. These tests read the route and the component as text and fail if that
 * shape comes back — a unit test on the resolver alone would still pass while the
 * client happily posted 86 ids to a different branch.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const routeSrc = readFileSync(join(root, "app/api/admin/sms/installment-reminder/bulk/route.ts"), "utf8");
const clientSrc = readFileSync(join(root, "components/admin/sms/BulkInstallmentReminder.tsx"), "utf8");

/**
 * The object literal the client posts when retrying. Anchored on `retryOf:` and
 * closed by counting braces, so neither a `${}` inside a template literal nor an
 * anchor that also occurs elsewhere in the file can mislocate it.
 */
function retryPayloadLiteral(): string {
  const at = clientSrc.indexOf("retryOf:");
  assert.ok(at > 0, "the client no longer sends retryOf — the retry has to name a campaign");
  const open = clientSrc.lastIndexOf("{", at);
  let depth = 0;
  for (let i = open; i < clientSrc.length; i++) {
    if (clientSrc[i] === "{") depth++;
    else if (clientSrc[i] === "}") {
      depth--;
      if (depth === 0) return clientSrc.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced braces while reading the retry payload");
}

describe("the retry request carries no recipient list", () => {
  test("the client's retry payload names a campaign and nothing else", () => {
    const payload = retryPayloadLiteral();
    assert.ok(payload.includes("retryOf:"), "the retry must name the campaign it is repairing");
    assert.ok(
      !payload.includes("enrollmentIds"),
      `the retry payload must not contain a recipient list — that is the bug. Got: ${payload}`,
    );
  });

  test("the client's retry payload does not send allowRepeat", () => {
    assert.ok(
      !retryPayloadLiteral().includes("allowRepeat"),
      "a blanket allowRepeat on a retry is what disabled the 30-minute guard",
    );
  });

  test("the route refuses a request carrying both retryOf and enrollmentIds", () => {
    assert.match(routeSrc, /retryOf && clientIds\.length/, "an ambiguous retry must be refused, not resolved");
    assert.match(routeSrc, /never both/i);
  });
});

describe("the 30-minute guard is not weakened for retries", () => {
  test("a retry passes allowRecentOverride false, unconditionally", () => {
    assert.match(
      routeSrc,
      /allowRecentOverride:\s*retryOf\s*\?\s*false\s*:/,
      "a retry must never override the same-template window",
    );
  });

  test("nothing in the route raises or bypasses SAME_TRIGGER_WINDOW_MIN", () => {
    assert.ok(!/SAME_TRIGGER_WINDOW_MIN/.test(routeSrc), "the window belongs to the service and is not tuned per call site");
  });
});

describe("the route enforces disjointness at the point of use", () => {
  test("it calls retryTargetsAreDisjoint and refuses when false", () => {
    assert.match(routeSrc, /retryTargetsAreDisjoint/);
    const at = routeSrc.indexOf("retryTargetsAreDisjoint(targets)");
    assert.ok(at > 0, "the assertion must run against the resolved targets");
    assert.match(routeSrc.slice(at, at + 400), /status:\s*500|ok:\s*false/, "a failed assertion must refuse the send");
  });

  test("the retry target set is derived from the log, not from the request", () => {
    const start = routeSrc.indexOf("if (retryOf) {");
    const end = routeSrc.indexOf("retrySummary = {", start);
    assert.ok(start > 0 && end > start, "could not locate the retry branch");
    const retryBlock = routeSrc.slice(start, end);
    assert.ok(retryBlock.includes("listLogsByCampaign(retryOf)"), "targets come from the send log");
    assert.ok(
      !retryBlock.includes("clientIds"),
      "the retry branch must not consult the client's list at all",
    );
    assert.ok(retryBlock.includes("resolveRetryTargets"));
  });
});

describe("the misleading comment is gone", () => {
  test("no comment claims successes are excluded by id", () => {
    assert.ok(
      !/Successes are excluded by id/.test(clientSrc),
      "that comment asserted a filter that never existed and is how this survived review",
    );
  });

  test("the retry comment states where the target set actually comes from", () => {
    const idx = clientSrc.indexOf("async function send(");
    const comment = clientSrc.slice(idx, clientSrc.indexOf("const res = await fetch", idx));
    assert.match(comment, /campaign/i);
    assert.match(comment, /server/i);
  });
});
