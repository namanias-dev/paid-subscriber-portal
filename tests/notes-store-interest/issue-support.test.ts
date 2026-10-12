import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMilestoneNote,
  clampSupportNote,
  customerFollowUpPatch,
  isShipmentException,
  issueAnswered,
  issueNeedsAttention,
  milestoneIssuePatch,
  newIssueAttentionPatch,
  normalizeStatusToken,
  shouldReplaceMilestone,
  staffReplyPatch,
  supportPriorityRank,
} from "../../lib/store/issueSupport";
import { toPublicIssue } from "../../lib/store/issues";

test("customer follow-up patch never includes customer_note", () => {
  const patch = customerFollowUpPatch("2026-10-12T12:00:00.000Z");
  assert.equal("customer_note" in patch, false);
  assert.equal(patch.awaiting_staff_reply, true);
  assert.equal(patch.last_customer_message_at, "2026-10-12T12:00:00.000Z");
});

test("new complaints require staff attention until a staff reply", () => {
  const created = newIssueAttentionPatch("2026-10-12T12:00:00.000Z");
  assert.equal(created.awaiting_staff_reply, true);
  assert.equal(created.last_customer_message_at, "2026-10-12T12:00:00.000Z");
  const statusOnly = staffReplyPatch("2026-10-12T13:00:00.000Z", false);
  assert.equal(statusOnly.awaiting_staff_reply, undefined);
  const withNote = staffReplyPatch("2026-10-12T13:00:00.000Z", true);
  assert.equal(withNote.awaiting_staff_reply, false);
  assert.equal(withNote.last_staff_reply_at, "2026-10-12T13:00:00.000Z");
});

test("exception status normalization catches upper/lower/NDR variants", () => {
  assert.equal(normalizeStatusToken("DELIVERY_FAILED"), "delivery_failed");
  assert.equal(isShipmentException("DELIVERY_FAILED"), true);
  assert.equal(isShipmentException("delivery_failed"), true);
  assert.equal(isShipmentException("NDR"), true);
  assert.equal(isShipmentException("rto_in_transit"), true);
  assert.equal(isShipmentException("IN_TRANSIT"), false);
  assert.equal(
    issueNeedsAttention({
      status: "IN_REVIEW",
      awaiting_staff_reply: false,
      last_staff_reply_at: "2026-10-12T12:00:00.000Z",
      shipment_status: "DELIVERY_FAILED",
    }),
    true,
  );
});

test("milestone patch never writes customer_note and can raise exception attention", () => {
  const patch = milestoneIssuePatch("Your notes are in transit.", "2026-10-12T12:00:00.000Z", { exception: true });
  assert.equal("customer_note" in patch, false);
  assert.equal(patch.milestone_note, "Your notes are in transit.");
  assert.equal(patch.priority, "high");
  assert.equal(patch.awaiting_staff_reply, true);
});

test("milestone copy stays short and status-accurate", () => {
  const picked = buildMilestoneNote({
    mappedStatus: "picked_up",
    courier: "Delhivery Air",
    awb: "1091405298035",
  });
  assert.match(picked || "", /picked up/i);
  assert.match(picked || "", /1091405298035/);
  assert.doesNotMatch(picked || "", /in transit/i);

  const transit = buildMilestoneNote({
    mappedStatus: "IN_TRANSIT",
    courier: "Xpressbees Surface",
    awb: "14112365769578",
    location: "Chandigarh",
  });
  assert.match(transit || "", /in transit/i);
  assert.match(transit || "", /Chandigarh/);
  assert.equal(buildMilestoneNote({ mappedStatus: "unknown" }), null);
});

test("stale milestones are rejected while identical notes are idempotent", () => {
  const current = "Your notes are in transit via Xpressbees. Tracking ID: 1.";
  assert.equal(shouldReplaceMilestone(current, "in_transit", "picked_up", "Your notes have been picked up."), false);
  assert.equal(shouldReplaceMilestone(current, "in_transit", "in_transit", current), false);
  assert.equal(
    shouldReplaceMilestone(current, "in_transit", "out_for_delivery", "Your notes are out for delivery."),
    true,
  );
});

test("answered and needs-attention helpers", () => {
  assert.equal(
    issueAnswered({
      last_staff_reply_at: "2026-10-12T16:00:00.000Z",
      last_customer_message_at: "2026-10-09T16:00:00.000Z",
      awaiting_staff_reply: false,
    }),
    true,
  );
  assert.equal(
    issueAnswered({
      last_staff_reply_at: "2026-10-09T11:00:00.000Z",
      last_customer_message_at: "2026-10-09T16:00:00.000Z",
      awaiting_staff_reply: true,
    }),
    false,
  );
  assert.equal(
    issueNeedsAttention({
      status: "IN_REVIEW",
      awaiting_staff_reply: true,
    }),
    true,
  );
  assert.equal(
    issueNeedsAttention({
      status: "IN_REVIEW",
      awaiting_staff_reply: false,
      last_staff_reply_at: "2026-10-12T16:00:00.000Z",
      order_status: "PAYMENT_FAILED",
    }),
    true,
  );
  assert.ok(
    supportPriorityRank({ priority: "high", awaiting_staff_reply: true, order_status: "PAYMENT_FAILED" }) >
      supportPriorityRank({ status: "OPEN" }),
  );
});

test("support notes preserve line breaks while public issue exposes milestone separately", () => {
  const note = clampSupportNote("Hi Akshita,\n\nTracking ID: 123\n— Team");
  assert.match(note, /\n/);
  const issue = toPublicIssue({
    reference: "NIAS-I-TEST0001",
    category: "PICKUP_ISSUE",
    description: "Pickup delayed",
    status: "IN_REVIEW",
    created_at: "2026-10-12T12:00:00.000Z",
    updated_at: "2026-10-12T12:00:00.000Z",
    customer_note: "Staff reply stays here.",
    milestone_note: "Your notes are in transit.",
  });
  assert.equal(issue.customer_note, "Staff reply stays here.");
  assert.equal(issue.milestone_note, "Your notes are in transit.");
  assert.equal(issue.status_label, "In review");
});
