import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CLIENT_ALLOWED_EVENTS } from "../../lib/analytics/events.ts";
import {
  NOTES_SAMPLE_ASSETS,
  PHYSICAL_NOTES_VIDEO,
  defaultNotesSample,
  isNotesProofProduct,
  samplePageObjectKey,
  samplePageSrc,
} from "../../lib/store/notesProof.ts";

const reader = readFileSync(new URL("../../components/notes/NotesSampleReader.tsx", import.meta.url), "utf8");
const section = readFileSync(new URL("../../components/notes/NotesProofSection.tsx", import.meta.url), "utf8");
const video = readFileSync(new URL("../../components/notes/PhysicalNotesVideo.tsx", import.meta.url), "utf8");
const dock = readFileSync(new URL("../../components/notes/PurchaseDock.tsx", import.meta.url), "utf8");
const landing = readFileSync(new URL("../../app/(site)/notes/page.tsx", import.meta.url), "utf8");
const pdp = readFileSync(new URL("../../components/notes/NotesPdp.tsx", import.meta.url), "utf8");

describe("see before you buy", () => {
  test("sample pages are public media derivatives, not a PDF embed", () => {
    const sample = defaultNotesSample();
    assert.equal(sample.id, "anti-defection-law");
    assert.equal(sample.pageCount, 23);
    assert.equal(sample.productSlug, "polity");
    assert.equal(
      samplePageObjectKey(sample.id, 1),
      "media/store/samples/anti-defection-law/page-01.webp",
    );
    assert.equal(
      samplePageObjectKey(sample.id, 23),
      "media/store/samples/anti-defection-law/page-23.webp",
    );
    assert.match(samplePageSrc(sample.id, 2), /\/media\/store\/samples\/anti-defection-law\/page-02\.webp$/);
    assert.equal(NOTES_SAMPLE_ASSETS.length, 1);
    assert.doesNotMatch(reader, /<iframe/);
    assert.doesNotMatch(section, /application\/pdf/);
  });

  test("physical copy video reuses the public teaching-video prefix", () => {
    assert.equal(PHYSICAL_NOTES_VIDEO.id, "physical-notes");
    assert.equal(PHYSICAL_NOTES_VIDEO.enabled, true);
    assert.ok(PHYSICAL_NOTES_VIDEO.height > PHYSICAL_NOTES_VIDEO.width);
    assert.match(PHYSICAL_NOTES_VIDEO.fullSrc, /\/media\/store\/videos\/physical-notes\/full\.mp4$/);
    assert.match(PHYSICAL_NOTES_VIDEO.posterSrc, /\/media\/store\/videos\/physical-notes\/poster\.webp$/);
    assert.match(video, /preload="none"/);
    assert.match(video, /prepareTeachingPlayback/);
    assert.doesNotMatch(video, /autoPlay|autoplay/);
  });

  test("proof events are client-allowlisted and sample open keeps the existing name", () => {
    for (const name of [
      "notes_sample_opened",
      "notes_sample_impression",
      "notes_sample_page_view",
      "notes_sample_completed",
      "notes_sample_buy_clicked",
      "notes_physical_video_impression",
      "notes_physical_video_play",
      "notes_physical_video_25",
      "notes_physical_video_50",
      "notes_physical_video_75",
      "notes_physical_video_completed",
      "notes_physical_video_buy_clicked",
    ] as const) {
      assert.ok(CLIENT_ALLOWED_EVENTS.has(name), name);
    }
    assert.match(reader, /notes_sample_opened/);
    assert.match(reader, /Buy complete notes/);
  });

  test("buy now stays ahead of the sample action, and the reader is code-split", () => {
    const buyAt = dock.indexOf("Buy now");
    const previewAt = dock.indexOf("Preview sample notes");
    assert.ok(buyAt > -1 && previewAt > buyAt);
    assert.match(section, /dynamic\(\(\) => import\("@\/components\/notes\/NotesSampleReader"\)/);
    assert.match(landing, /See before you buy|NotesProofSection/);
    const catalogueAt = landing.indexOf('id="catalogue"');
    const proofAt = landing.indexOf("<NotesProofSection");
    assert.ok(catalogueAt > -1 && proofAt > catalogueAt);
    assert.match(pdp, /showProofPreview/);
    assert.match(pdp, /NotesProofSection/);
    assert.equal(isNotesProofProduct({ slug: "polity", name: "Indian Polity Notes" }), true);
    assert.equal(isNotesProofProduct({ slug: "economy", name: "Economy", subject: "Economy" }), false);
  });
});
