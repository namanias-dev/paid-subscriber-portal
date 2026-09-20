import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CLIENT_ALLOWED_EVENTS } from "../../lib/analytics/events.ts";
import {
  TEACHING_VIDEOS,
  listEnabledTeachingVideos,
  teachingAspectRatio,
  teachingVideoObjectKey,
} from "../../lib/store/teachingVideos.ts";

describe("teaching video catalogue", () => {
  test("enabled clips render as a three-video carousel", () => {
    const enabled = listEnabledTeachingVideos();
    assert.equal(enabled.length, 3);
    assert.deepEqual(enabled.map((video) => video.id), [
      "naman-sir-teaches-01",
      "naman-sir-teaches-02",
      "naman-sir-teaches-03",
    ]);
    assert.ok(TEACHING_VIDEOS.every((video) => video.posterSrc && video.previewSrc && video.fullSrc && video.enabled));
    assert.ok(TEACHING_VIDEOS.every((video) => video.height > video.width));
  });

  test("keeps native portrait ratio and does not invent extra view counts", () => {
    const first = TEACHING_VIDEOS[0];
    assert.ok(first);
    assert.equal(teachingAspectRatio(first), `${first.width} / ${first.height}`);
    assert.ok(first.height > first.width);
    assert.equal(first.viewLabel, "1.6M+ VIEWS");
    assert.equal(
      TEACHING_VIDEOS.filter((video) => video.viewLabel).length,
      1,
      "do not copy the 1.6M claim onto later clips",
    );
  });

  test("public objects stay on the existing media/ prefix", () => {
    assert.equal(teachingVideoObjectKey("naman-sir-teaches-01", "preview.mp4"), "media/store/videos/naman-sir-teaches-01/preview.mp4");
  });

  test("teaching funnel events are first-party client beacons", () => {
    for (const name of [
      "notes_teaching_section_viewed",
      "notes_teaching_preview_started",
      "notes_teaching_video_opened",
      "notes_teaching_sound_enabled",
      "notes_teaching_video_25",
      "notes_teaching_video_50",
      "notes_teaching_video_75",
      "notes_teaching_video_completed",
      "notes_teaching_video_changed",
      "notes_shop_after_teaching_clicked",
    ] as const) {
      assert.ok(CLIENT_ALLOWED_EVENTS.has(name), name);
    }
  });
});
