import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { classHubHardLocked, pickEntitledRecordingCourseId } from "../../lib/coursePlaybackAccess";

const LIVE = "61425007-6662-4864-88cf-12ca96db8b82";
const GS = "52457ce7-ddac-4417-a694-56d85b8a70ad";

describe("Class Hub back href + hard lock", () => {
  test("picks the entitled UUID over co-safalta first in course_ids", () => {
    const rec = { course_ids: ["co-safalta", GS, LIVE], course_id: "co-safalta" };
    assert.equal(pickEntitledRecordingCourseId(rec, [LIVE]), LIVE);
    assert.equal(pickEntitledRecordingCourseId(rec, [GS]), GS);
  });

  test("falls back to first assigned id when none entitled", () => {
    const rec = { course_ids: ["co-safalta", GS], course_id: GS };
    assert.equal(pickEntitledRecordingCourseId(rec, []), "co-safalta");
  });

  test("hard-locks only with zero entitlements and playback denied", () => {
    assert.equal(classHubHardLocked({ entitledCourseIds: [], playbackAllowed: false }), true);
    assert.equal(classHubHardLocked({ entitledCourseIds: [LIVE], playbackAllowed: false }), false);
    assert.equal(classHubHardLocked({ entitledCourseIds: [], playbackAllowed: true }), false);
  });
});
