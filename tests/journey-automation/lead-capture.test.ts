/**
 * Lead CRM capture-path audit + Kanban helpers (all simulation-only; nothing sends).
 *
 * Part A/B  Every public lead-capture entry point maps to a REGISTERED source_form
 *           and is documented in the capture-path registry (so the /resources
 *           download gate and the home pop-up can't silently drift out of the CRM).
 * Part B    The lead_created trigger matcher honours the free_download source_form
 *           filter (matching enrols / "all" enrols / non-matching does not).
 * Part C    The Kanban sort comparator (newest / oldest / name) is correct + pure.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LEAD_CAPTURE_PATHS, unregisteredCaptureSourceForms,
} from "../../lib/journey-automation/leadCapturePaths";
import { LEAD_SOURCE_FORMS } from "../../lib/journey-automation/leadSources";
import { eventMatchesTrigger } from "../../lib/journey-automation/engine/triggerMatch";
import { sortLeads } from "../../lib/leadsSort";
import type { AutomationEvent } from "../../types/journey-automation";

function leadEvent(sourceForm: string): Pick<AutomationEvent, "payload" | "webinar_id" | "payment_id"> {
  return { payload: { source_form: sourceForm }, webinar_id: null, payment_id: null };
}

describe("Lead capture-path audit (Part A/B)", () => {
  it("every capture path uses a REGISTERED source_form", () => {
    assert.deepEqual(unregisteredCaptureSourceForms(), []);
  });

  it("free_download is a registered lead source form", () => {
    assert.ok(LEAD_SOURCE_FORMS.some((s) => s.value === "free_download"));
  });

  it("the home pop-up creates a CRM lead via /api/public/lead (lead_popup)", () => {
    const p = LEAD_CAPTURE_PATHS.find((x) => x.form === "Home page pop-up");
    assert.ok(p, "home pop-up path present");
    assert.equal(p!.endpoint, "/api/public/lead");
    assert.equal(p!.sourceForm, "lead_popup");
    assert.equal(p!.createsCrmLead, true);
  });

  it("the /resources Open Downloads gate creates a CRM lead (free_download)", () => {
    const p = LEAD_CAPTURE_PATHS.find((x) => x.form.includes("Open Downloads"));
    assert.ok(p, "downloads gate path present");
    assert.equal(p!.endpoint, "/api/public/downloads/lead");
    assert.equal(p!.sourceForm, "free_download");
    assert.equal(p!.createsCrmLead, true);
  });

  it("all seven known capture paths create a CRM lead", () => {
    assert.equal(LEAD_CAPTURE_PATHS.length, 7);
    assert.ok(LEAD_CAPTURE_PATHS.every((p) => p.createsCrmLead === true));
  });
});

describe("Lead trigger filter honours free_download (Part B)", () => {
  const filterFreeDownload = { filters: { sourceForm: ["free_download"] } };

  it("matching source_form enrols", () => {
    assert.equal(eventMatchesTrigger("lead_created", filterFreeDownload, leadEvent("free_download")), true);
  });

  it("no filter (all) enrols any source_form", () => {
    assert.equal(eventMatchesTrigger("lead_created", {}, leadEvent("lead_popup")), true);
    assert.equal(eventMatchesTrigger("lead_created", {}, leadEvent("free_download")), true);
  });

  it("non-matching source_form does not enrol", () => {
    assert.equal(eventMatchesTrigger("lead_created", filterFreeDownload, leadEvent("lead_popup")), false);
  });
});

describe("Kanban sort comparator (Part C)", () => {
  const leads = [
    { name: "Charlie", created_at: "2026-07-10T10:00:00Z" },
    { name: "alice", created_at: "2026-07-15T09:00:00Z" },
    { name: "Bob", created_at: "2026-07-12T08:00:00Z" },
  ];

  it("newest first orders by created_at desc", () => {
    const out = sortLeads(leads, "newest").map((l) => l.name);
    assert.deepEqual(out, ["alice", "Bob", "Charlie"]);
  });

  it("oldest first orders by created_at asc", () => {
    const out = sortLeads(leads, "oldest").map((l) => l.name);
    assert.deepEqual(out, ["Charlie", "Bob", "alice"]);
  });

  it("name sorts case-insensitively A→Z", () => {
    const out = sortLeads(leads, "name").map((l) => l.name);
    assert.deepEqual(out, ["alice", "Bob", "Charlie"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...leads];
    sortLeads(leads, "oldest");
    assert.deepEqual(leads, copy);
  });
});
