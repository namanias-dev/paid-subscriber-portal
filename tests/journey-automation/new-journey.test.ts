/**
 * Regression: "New Journey" must create a fresh DRAFT and open it in the builder.
 *
 * The prod 404 was caused by inconsistent gating: the dashboard, nav, create API and
 * every workflow API are gated on the `journey_view` PERMISSION only, but the builder
 * (and operate) PAGES additionally hard-404'd on `journeyAutomationEnabled()` — the
 * EXECUTION master flag. With that flag off in prod, create succeeded and redirected
 * to /[id], which then 404'd. These tests lock in:
 *   (1) createWorkflow returns a real draft id (so the redirect target is valid), and
 *   (2) the builder + operate pages are NOT gated on journeyAutomationEnabled().
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createWorkflow } from "../../lib/journey-automation/builderStore";
import type { KillSwitchActor } from "../../lib/journey-automation/store";

const actor: KillSwitchActor = { id: "tester", name: "Tester", role: "super_admin", isSuper: true };

describe("New Journey — create produces a valid draft to open in the builder", () => {
  it("returns a workflow with a non-empty id, draft status, and a current version", async () => {
    const wf = await createWorkflow("My first journey", actor);
    assert.ok(wf.id && wf.id.length > 0, "id must be present for the /[id] redirect");
    assert.equal(wf.status, "draft");
    assert.ok(wf.current_version_id, "a draft version must exist so the builder can load");
    assert.equal(wf.name, "My first journey");
  });

  it("falls back to a default name and still yields a valid id", async () => {
    const wf = await createWorkflow("", actor);
    assert.ok(wf.id && wf.id.length > 0);
    assert.equal(wf.status, "draft");
  });
});

describe("New Journey — builder/operate pages gate consistently (no execution-flag 404)", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("the builder page is NOT gated on journeyAutomationEnabled()", () => {
    const src = read("app/admin/communications/journey-automation/[id]/page.tsx");
    assert.ok(!src.includes("journeyAutomationEnabled"), "builder must not hard-404 on the execution flag");
    assert.ok(src.includes('requirePermission("journey_view")'), "builder must gate on journey_view");
  });

  it("the operate page is NOT gated on journeyAutomationEnabled()", () => {
    const src = read("app/admin/communications/journey-automation/[id]/operate/page.tsx");
    assert.ok(!src.includes("journeyAutomationEnabled"), "operate must not hard-404 on the execution flag");
    assert.ok(src.includes('requirePermission("journey_view")'), "operate must gate on journey_view");
  });

  it("the create API redirect target route file exists", () => {
    // Dashboard redirects to /admin/communications/journey-automation/${id}
    const builder = read("app/admin/communications/journey-automation/[id]/page.tsx");
    assert.ok(builder.includes("BuilderClient"), "the /[id] builder route must be present + render the builder");
  });
});
