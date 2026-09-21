import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isNotesReservedSlug,
  notesProductPath,
  notesProductRedirect,
  resolveNotesProductSlug,
} from "../../lib/store/paths.ts";
import { getNotesCurriculum, NOTES_CURRICULUM } from "../../lib/store/notesCurriculum.ts";
import { splitOfferRemaining } from "../../lib/store/offerTime.ts";

test("canonical PDP paths are short subject slugs", () => {
  assert.equal(notesProductPath("polity"), "/notes/polity");
  assert.equal(notesProductPath("modern-history"), "/notes/modern-history");
  assert.equal(notesProductPath("economy"), "/notes/economy");
});

test("legacy TEST product slugs resolve to launch PDPs", () => {
  assert.equal(resolveNotesProductSlug("test-polity-notes"), "polity");
  assert.equal(notesProductRedirect("test-economy-notes"), "/notes/economy");
  assert.equal(resolveNotesProductSlug("polity"), "polity");
});

test("reserved notes routes are not treated as products", () => {
  assert.equal(isNotesReservedSlug("cart"), true);
  assert.equal(isNotesReservedSlug("polity"), false);
});

test("launch curriculum covers the three subjects only", () => {
  assert.deepEqual(Object.keys(NOTES_CURRICULUM).sort(), ["economy", "modern-history", "polity"]);
  assert.equal(getNotesCurriculum("polity")?.title, "Indian Polity Notes");
  assert.equal(getNotesCurriculum("ethics"), null);
});

test("countdown uses fixed cells and seconds only under 24h", () => {
  const week = splitOfferRemaining(6 * 86400_000 + 23 * 3600_000 + 38 * 60_000);
  assert.equal(week.showSeconds, false);
  assert.equal(week.days, 6);
  assert.equal(week.hours, 23);
  assert.equal(week.minutes, 38);
  const soon = splitOfferRemaining(2 * 3600_000 + 15 * 60_000);
  assert.equal(soon.showSeconds, true);
  assert.equal(soon.ended, false);
  assert.equal(splitOfferRemaining(0).ended, true);
});
