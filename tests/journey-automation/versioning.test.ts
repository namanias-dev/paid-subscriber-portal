/**
 * (i) Versioning — proves PUBLISHED VERSIONS ARE IMMUTABLE and the workflow state
 * machine only permits explicit transitions.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyDraftEdit,
  assertTransition,
  assertVersionEditable,
  canTransition,
  freezeToPublished,
  ImmutableVersionError,
  isVersionImmutable,
  newDraftVersion,
  nextVersionNumber,
  WorkflowTransitionError,
} from "../../lib/journey-automation/versioning";
import type { AutomationWorkflowVersion } from "../../types/journey-automation";

function draft(version = 1): AutomationWorkflowVersion {
  return {
    id: `v${version}`,
    workflow_id: "wf1",
    version,
    status: "draft",
    definition: { nodes: [] },
    change_summary: null,
    created_by: "alice",
    published_by: null,
    published_at: null,
    is_immutable: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("journey versioning — immutability", () => {
  it("a freshly published version is immutable", () => {
    const published = freezeToPublished(draft(1), "boss");
    assert.equal(published.status, "published");
    assert.equal(published.is_immutable, true);
    assert.equal(isVersionImmutable(published), true);
    assert.ok(published.published_at);
    assert.equal(published.published_by, "boss");
  });

  it("editing a published version throws ImmutableVersionError", () => {
    const published = freezeToPublished(draft(1), "boss");
    assert.throws(
      () => applyDraftEdit(published, { change_summary: "sneaky edit" }, "mallory"),
      ImmutableVersionError,
    );
    assert.throws(() => assertVersionEditable(published), ImmutableVersionError);
    assert.throws(() => freezeToPublished(published, "boss"), ImmutableVersionError);
  });

  it("draft versions remain editable", () => {
    const d = draft(2);
    assert.equal(isVersionImmutable(d), false);
    const edited = applyDraftEdit(d, { change_summary: "wip" }, "alice");
    assert.equal(edited.change_summary, "wip");
    // The original object is not mutated (pure).
    assert.equal(d.change_summary, null);
  });

  it("new entrants get a new version; existing published stays frozen", () => {
    const existing = [freezeToPublished(draft(1), "boss")];
    assert.equal(nextVersionNumber(existing), 2);
    const next = newDraftVersion("wf1", existing, "alice");
    assert.equal(next.version, 2);
    assert.equal(next.status, "draft");
    assert.equal(next.is_immutable, false);
    // The published v1 is untouched by creating v2.
    assert.equal(existing[0].version, 1);
    assert.equal(existing[0].is_immutable, true);
  });

  it("nextVersionNumber starts at 1 with no versions", () => {
    assert.equal(nextVersionNumber([]), 1);
  });
});

describe("journey versioning — state machine", () => {
  it("permits only declared transitions", () => {
    assert.equal(canTransition("draft", "ready"), true);
    assert.equal(canTransition("ready", "active"), true);
    assert.equal(canTransition("active", "paused"), true);
    assert.equal(canTransition("paused", "active"), true);
    assert.equal(canTransition("active", "disabled_by_killswitch"), true);
    assert.equal(canTransition("disabled_by_killswitch", "paused"), true);
  });

  it("rejects illegal transitions", () => {
    assert.equal(canTransition("draft", "active"), false);
    assert.equal(canTransition("archived", "active"), false);
    assert.equal(canTransition("disabled_by_killswitch", "active"), false);
    assert.throws(() => assertTransition("draft", "active"), WorkflowTransitionError);
  });
});
