/**
 * Unit tests for behaviour-driven lead status.
 * Pure functions only — no DB I/O.
 */

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  BEHAVIOUR_LADDER,
  BEHAVIOUR_STAGE_RANK,
  buildBehaviourPatch,
  buildStaffStatusPatch,
  formatStaffVerdictLabel,
  formatSystemVerifiedLabel,
  furthestBehaviourStage,
  isBehaviourStage,
  behaviourStageRank,
} from "../../lib/leadBehaviourStatus";

describe("behaviour ladder ordering", () => {
  test("ladder is Webinar Registered → Seat Booked → Admission Done", () => {
    assert.deepEqual([...BEHAVIOUR_LADDER], [
      "Webinar Registered",
      "Seat Booked",
      "Admission Done",
    ]);
    assert.equal(BEHAVIOUR_STAGE_RANK["Webinar Registered"], 1);
    assert.equal(BEHAVIOUR_STAGE_RANK["Seat Booked"], 2);
    assert.equal(BEHAVIOUR_STAGE_RANK["Admission Done"], 3);
  });

  test("furthestBehaviourStage never moves backwards", () => {
    assert.equal(furthestBehaviourStage(null, "Webinar Registered"), "Webinar Registered");
    assert.equal(furthestBehaviourStage("Webinar Registered", "Seat Booked"), "Seat Booked");
    assert.equal(furthestBehaviourStage("Seat Booked", "Webinar Registered"), "Seat Booked");
    assert.equal(furthestBehaviourStage("Admission Done", "Seat Booked"), "Admission Done");
    assert.equal(furthestBehaviourStage("Interested", "Webinar Registered"), "Webinar Registered");
    assert.equal(furthestBehaviourStage("Admission Done", null), "Admission Done");
    assert.equal(furthestBehaviourStage("Not Called", null), null);
  });

  test("behaviourStageRank is 0 for non-ladder values", () => {
    assert.equal(behaviourStageRank("Not Interested"), 0);
    assert.equal(behaviourStageRank(null), 0);
    assert.ok(isBehaviourStage("Seat Booked"));
    assert.equal(isBehaviourStage("Interested"), false);
  });
});

describe("buildBehaviourPatch preserves manual on flip", () => {
  test("flipping from staff verdict preserves manual_status", () => {
    const { patch, changed, preservedManual } = buildBehaviourPatch({
      currentStatus: "Not Interested",
      statusOrigin: "staff",
      manualStatus: null,
      derived: "Webinar Registered",
      nowIso: "2026-07-30T12:00:00.000Z",
    });
    assert.equal(changed, true);
    assert.equal(preservedManual, true);
    assert.equal(patch.status, "Webinar Registered");
    assert.equal(patch.status_origin, "system");
    assert.equal(patch.manual_status, "Not Interested");
    assert.equal(patch.manual_status_at, "2026-07-30T12:00:00.000Z");
  });

  test("does not overwrite an existing manual_status", () => {
    const { patch, preservedManual } = buildBehaviourPatch({
      currentStatus: "Not Interested",
      statusOrigin: "staff",
      manualStatus: "Not Interested",
      derived: "Seat Booked",
      nowIso: "2026-07-30T12:00:00.000Z",
    });
    assert.equal(preservedManual, false);
    assert.equal(patch.manual_status, undefined);
    assert.equal(patch.status, "Seat Booked");
  });

  test("refuses to demote on the ladder", () => {
    const { changed, skippedReason } = buildBehaviourPatch({
      currentStatus: "Admission Done",
      statusOrigin: "system",
      manualStatus: null,
      derived: "Webinar Registered",
    });
    assert.equal(changed, false);
    assert.equal(skippedReason, "would_demote");
  });

  test("already system at same stage is a no-op", () => {
    const { changed, skippedReason } = buildBehaviourPatch({
      currentStatus: "Seat Booked",
      statusOrigin: "system",
      manualStatus: "Interested",
      derived: "Seat Booked",
    });
    assert.equal(changed, false);
    assert.equal(skippedReason, "already_system");
  });
});

describe("format labels", () => {
  test("formatSystemVerifiedLabel", () => {
    assert.equal(formatSystemVerifiedLabel("Seat Booked"), "System verified — Seat Booked");
    assert.ok(formatSystemVerifiedLabel(null).includes("—"));
  });

  test("formatStaffVerdictLabel", () => {
    assert.equal(formatStaffVerdictLabel(null), null);
    assert.equal(
      formatStaffVerdictLabel({
        status: "Not Interested",
        at: null,
        by: "asha",
        byRole: "counsellor",
        note: null,
      }),
      "Staff: asha (counsellor) — Not Interested",
    );
  });
});

describe("buildStaffStatusPatch", () => {
  test("stamps staff origin and manual verdict", () => {
    const patch = buildStaffStatusPatch({
      status: "Call Back",
      actorName: "riya",
      actorRole: "sales",
      nowIso: "2026-07-30T10:00:00.000Z",
    });
    assert.equal(patch.status, "Call Back");
    assert.equal(patch.status_origin, "staff");
    assert.equal(patch.manual_status, "Call Back");
    assert.equal(patch.manual_status_by, "riya");
    assert.equal(patch.manual_status_by_role, "sales");
    assert.equal(patch.admitted, false);
  });
});
