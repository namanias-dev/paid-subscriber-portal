import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CLIENT_ALLOWED_EVENTS } from "../../lib/analytics/events.ts";
import {
  TEACHING_VIDEOS,
  listEnabledTeachingVideos,
  teachingAspectRatio,
  teachingVideoObjectKey,
} from "../../lib/store/teachingVideos.ts";

const showcase = readFileSync(new URL("../../components/notes/NotesTeachingShowcase.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("../../components/notes/TeachingVideoCard.tsx", import.meta.url), "utf8");
const player = readFileSync(new URL("../../lib/store/teachingPlayer.ts", import.meta.url), "utf8");
const mediaRoute = readFileSync(new URL("../../app/media/[...path]/route.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const counselor = readFileSync(new URL("../../components/ai-agent/AiCounselorWidget.tsx", import.meta.url), "utf8");

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
      "notes_teaching_inline_play",
      "notes_teaching_inline_pause",
      "notes_teaching_fullscreen_entered",
      "notes_shop_after_teaching_clicked",
    ] as const) {
      assert.ok(CLIENT_ALLOWED_EVENTS.has(name), name);
    }
  });

  test("carousel stays inside its viewport and never scrollIntoViews the page", () => {
    assert.match(showcase, /ns-teach-viewport/);
    assert.match(showcase, /ns-teach-track/);
    assert.match(showcase, /centerSlide/);
    assert.doesNotMatch(showcase, /scrollIntoView/);
    assert.doesNotMatch(showcase, /TeachingVideoLightbox/);
    assert.match(css, /overflow-x:\s*clip/);
    assert.match(css, /\.ns-teach-grid\s*\{[^}]*min-width:\s*0/);
    assert.match(css, /\.ns-teach-viewport\s*\{[^}]*overflow-x:\s*auto/s);
  });

  test("active card is a true inline player with playsInline and native controls after user play", () => {
    assert.match(card, /Play teaching video/);
    assert.match(card, /playsInline/);
    assert.match(player, /webkit-playsinline/);
    assert.match(card, /controls=\{active && userPlayback\}/);
    assert.match(card, /prepareTeachingPlayback/);
    assert.match(card, /preload=\{active && near && !saveData \? "metadata" : "none"\}/);
    assert.match(card, /notes_teaching_inline_play/);
    assert.match(card, /onPlaying/);
    assert.doesNotMatch(card, /nofullscreen/);
    assert.doesNotMatch(card, /controlsList/);
    assert.match(showcase, /Naman Sir · UPSC Faculty/);
    assert.equal(showcase.split("Naman Sir · UPSC Faculty").length - 1, 1);
    assert.doesNotMatch(showcase, /Tap to watch with sound/);
  });

  test("only the active near card warms the full source and inactive cards pause", () => {
    assert.match(card, /allowFull = active && near && !saveData/);
    assert.match(card, /stopTeachingBuffering/);
    assert.match(card, /showPreview = active && near && !saveData && !reduce/);
    assert.match(card, /warmTeachingSource/);
    assert.match(showcase, /near=\{nearView\}/);
    assert.match(showcase, /data-locked=\{playing \? "true" : undefined\}/);
    assert.match(css, /data-locked="true"/);
  });

  test("media route streams Range responses and never buffers the whole object", () => {
    assert.match(mediaRoute, /transformToWebStream/);
    assert.match(mediaRoute, /req\.headers\.get\("range"\)/);
    assert.doesNotMatch(mediaRoute, /arrayBuffer\(/);
    assert.doesNotMatch(mediaRoute, /Buffer\.concat/);
    assert.match(mediaRoute, /mediaResponseHeaders/);
    assert.match(player, /webkitEnterFullscreen/);
  });

  test("counsellor launcher dodges the teaching player on /notes", () => {
    assert.match(counselor, /data-notes-dodge/);
    assert.match(counselor, /naman-sir-teaches/);
    assert.match(css, /ai-counselor-launcher\[data-notes-dodge="true"\]/);
  });
});
