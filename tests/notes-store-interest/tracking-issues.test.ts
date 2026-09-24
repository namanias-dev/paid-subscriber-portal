import assert from "node:assert/strict";
import test from "node:test";
import {
  categoriesForStage,
  clampIssueText,
  issueCategoryAllowed,
  issueIsOpen,
  mintIssueReference,
  toPublicIssue,
} from "../../lib/store/issues";
import { buildTrackingTimeline, safeCourierTrackUrl, trackingNarrative } from "../../lib/store/trackingView";

test("issue reference and category checks", () => {
  const ref = mintIssueReference();
  assert.match(ref, /^NIAS-I-[0-9A-F]{8}$/);
  assert.equal(issueCategoryAllowed("PICKUP_ISSUE"), true);
  assert.equal(issueCategoryAllowed("damaged"), false);
  assert.equal(issueIsOpen("IN_REVIEW"), true);
  assert.equal(issueIsOpen("RESOLVED"), false);
  assert.equal(clampIssueText("  hello   world  "), "hello world");
});

test("public issue hides internal fields and explains the next step", () => {
  const issue = toPublicIssue({
    reference: "NIAS-I-AABBCCDD",
    category: "PICKUP_ISSUE",
    description: "Courier did not come.",
    status: "OPEN",
    created_at: "2026-09-24T12:00:00.000Z",
    updated_at: "2026-09-24T12:00:00.000Z",
    customer_note: null,
    callback_requested: true,
  });
  assert.equal(issue.status_label, "Issue received");
  assert.equal(issue.category_label, "Pickup not done");
  assert.equal(issue.open, true);
  assert.match(issue.next_step, /received/i);
  assert.equal("admin_note" in issue, false);
});

test("pickup scheduled stays before shipped and a delay is an exception", () => {
  const scheduled = buildTrackingTimeline({ stage: "packed", orderStatus: "PICKUP_SCHEDULED" });
  const pickup = scheduled.find((step) => step.id === "pickup");
  const shipped = scheduled.find((step) => step.id === "shipped");
  assert.equal(pickup?.state, "current");
  assert.equal(shipped?.state, "upcoming");
  const delayed = buildTrackingTimeline({ stage: "packed", orderStatus: "PICKUP_SCHEDULED", pickupDelayed: true });
  assert.equal(delayed.find((step) => step.id === "pickup")?.state, "exception");
  assert.equal(delayed.find((step) => step.id === "pickup")?.label, "Pickup delayed");
});

test("queued pickup copy stays pre-shipment", () => {
  const copy = trackingNarrative({
    stage: "packed",
    orderStatus: "PICKUP_SCHEDULED",
    pickupQueued: true,
  });
  assert.equal(copy.headline, "Pickup scheduled");
  assert.match(copy.explanation, /waiting for courier collection/i);
  assert.doesNotMatch(copy.explanation, /handed to the courier/i);
});

test("delivered still offers a damage category and courier links stay allowlisted", () => {
  assert.ok(categoriesForStage("delivered").includes("DAMAGE_ISSUE"));
  assert.ok(categoriesForStage("packed").includes("PICKUP_ISSUE"));
  assert.equal(categoriesForStage("packed").includes("DAMAGE_ISSUE"), false);
  assert.equal(safeCourierTrackUrl("https://www.xpressbees.com/track"), "https://www.xpressbees.com/track");
  assert.equal(safeCourierTrackUrl("http://xpressbees.com/track"), null);
  assert.equal(safeCourierTrackUrl("https://example.com/track"), null);
});
