/**
 * Journey Automation — trigger filters + honesty labelling + responsive shell.
 *
 * Proves (all simulation-only; nothing sends):
 *   Part A  effectiveJourneyState surfaces the REAL running state (never lets a
 *           user think a "Live" workflow is running while the engine is OFF).
 *   Part B  lead_created events carry a source_form and the matcher enrolls the
 *           specific form exactly once.
 *   Part C  the enrollment matcher HONORS trigger filters (matching enrolls / "all"
 *           enrolls / non-matching does not) + filters round-trip through the graph.
 *   Part D  the builder shell CSS is full-bleed + collapsible (responsive smoke).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { runMatcher } from "../../lib/journey-automation/engine/matcher";
import {
  eventMatchesTrigger, readTriggerFilters, summarizeTriggerFilters,
} from "../../lib/journey-automation/engine/triggerMatch";
import { effectiveJourneyState } from "../../lib/journey-automation/effectiveState";
import { LEAD_SOURCE_FORMS } from "../../lib/journey-automation/leadSources";
import {
  InMemoryPort, ScriptedState, MutableClock, makeEvent, workflow, candidate,
} from "./engineFakes";
import type { BuilderGraph } from "../../types/journey-automation";

// A minimal published lead_created journey with optional trigger filters.
function leadGraph(filters?: Record<string, string[]>): BuilderGraph {
  return {
    nodes: [
      { node_key: "t", type: "trigger", config: { eventType: "lead_created", ...(filters ? { filters } : {}) }, position: { x: 0, y: 0 } },
      { node_key: "g", type: "goal", config: { goalType: "logged_in" }, position: { x: 1, y: 0 } },
      { node_key: "x", type: "exit", config: {}, position: { x: 2, y: 0 } },
    ],
    edges: [
      { edge_key: "e1", source: "t", target: "g", branch_label: null },
      { edge_key: "e2", source: "g", target: "x", branch_label: null },
    ],
  };
}

function setup(graph: BuilderGraph) {
  const wf = workflow({ execution_mode: "simulate" });
  const data = new InMemoryPort({
    candidatesByEvent: { lead_created: [candidate(wf, graph)] },
    graphsByVersion: { ver1: graph },
    workflowsById: { wf1: wf },
  }, new MutableClock());
  return { data, state: new ScriptedState(), clock: new MutableClock() };
}

// ---------------------------------------------------------------------------
// Part A — effective (honest) state labelling
// ---------------------------------------------------------------------------
describe("Part A: effectiveJourneyState — no 'live but not running' trap", () => {
  it("Live + engine OFF → clearly NOT running", () => {
    const s = effectiveJourneyState({ mode: "live", executionEnabled: false, smsEnabled: false, killSwitchEngaged: false });
    assert.equal(s.running, false);
    assert.equal(s.sending, false);
    assert.match(s.label, /engine OFF/i);
    assert.match(s.detail, /EXECUTION_ENABLED/);
  });
  it("Simulate + engine OFF → not running", () => {
    const s = effectiveJourneyState({ mode: "simulate", executionEnabled: false, smsEnabled: false, killSwitchEngaged: false });
    assert.equal(s.running, false);
    assert.match(s.label, /engine OFF/i);
  });
  it("Simulate + engine ON → running, sends nothing", () => {
    const s = effectiveJourneyState({ mode: "simulate", executionEnabled: true, smsEnabled: true, killSwitchEngaged: false });
    assert.equal(s.running, true);
    assert.equal(s.sending, false);
  });
  it("Live + engine ON + SMS OFF → running but only simulating", () => {
    const s = effectiveJourneyState({ mode: "live", executionEnabled: true, smsEnabled: false, killSwitchEngaged: false });
    assert.equal(s.running, true);
    assert.equal(s.sending, false);
    assert.match(s.label, /SMS OFF/i);
  });
  it("Live + all on → sending", () => {
    const s = effectiveJourneyState({ mode: "live", executionEnabled: true, smsEnabled: true, killSwitchEngaged: false });
    assert.equal(s.sending, true);
  });
  it("kill switch beats everything", () => {
    const s = effectiveJourneyState({ mode: "live", executionEnabled: true, smsEnabled: true, killSwitchEngaged: true });
    assert.equal(s.running, false);
    assert.match(s.label, /kill switch/i);
  });
  it("off is off", () => {
    const s = effectiveJourneyState({ mode: "off", executionEnabled: true, smsEnabled: true, killSwitchEngaged: false });
    assert.equal(s.running, false);
    assert.equal(s.label, "Off");
  });
});

// ---------------------------------------------------------------------------
// Part B/C — pure trigger matching
// ---------------------------------------------------------------------------
describe("Part C: eventMatchesTrigger (pure)", () => {
  const ev = { payload: { source_form: "public_lead_form" }, webinar_id: null, payment_id: null };
  it("no filter → matches (all)", () => {
    assert.equal(eventMatchesTrigger("lead_created", { eventType: "lead_created" }, ev), true);
  });
  it("matching source_form → matches", () => {
    assert.equal(eventMatchesTrigger("lead_created", { filters: { sourceForm: ["public_lead_form"] } }, ev), true);
  });
  it("non-matching source_form → does not match", () => {
    assert.equal(eventMatchesTrigger("lead_created", { filters: { sourceForm: ["quiz"] } }, ev), false);
  });
  it("absent field with a filter set → does not match", () => {
    assert.equal(eventMatchesTrigger("lead_created", { filters: { sourceForm: ["quiz"] } }, { payload: {}, webinar_id: null, payment_id: null }), false);
  });
  it("payment_received item_type filter", () => {
    const pay = { payload: { item_type: "course", item_slug: "upsc-foundation" }, webinar_id: null, payment_id: "p1" };
    assert.equal(eventMatchesTrigger("payment_received", { filters: { itemType: ["course"] } }, pay), true);
    assert.equal(eventMatchesTrigger("payment_received", { filters: { itemType: ["webinar"] } }, pay), false);
  });
  it("webinar_registered webinar_id filter (top-level field)", () => {
    const web = { payload: {}, webinar_id: "web_42", payment_id: null };
    assert.equal(eventMatchesTrigger("webinar_registered", { filters: { webinarId: ["web_42"] } }, web), true);
    assert.equal(eventMatchesTrigger("webinar_registered", { filters: { webinarId: ["web_9"] } }, web), false);
  });
});

describe("Part C: filters round-trip through the graph JSON", () => {
  it("readTriggerFilters preserves selection after a JSON round-trip", () => {
    const cfg = { eventType: "lead_created", filters: { sourceForm: ["public_lead_form", "quiz"] } };
    const roundTripped = JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>;
    assert.deepEqual(readTriggerFilters(roundTripped), { sourceForm: ["public_lead_form", "quiz"] });
  });
  it("summarizeTriggerFilters reads 'All sources' when empty", () => {
    assert.equal(summarizeTriggerFilters("lead_created", { eventType: "lead_created" }), "All sources");
    assert.match(summarizeTriggerFilters("lead_created", { filters: { sourceForm: ["quiz"] } }), /Lead source form: quiz/);
  });
});

// ---------------------------------------------------------------------------
// Part B/C — the matcher honors filters end-to-end
// ---------------------------------------------------------------------------
describe("Part C: matcher enrolls only matching source_form", () => {
  it("no filter → the lead enrolls exactly once", async () => {
    const { data, state, clock } = setup(leadGraph());
    data.events.push(makeEvent({ event_type: "lead_created", payload: { source_form: "public_lead_form" }, dedupe_key: "lead_created:L1" }));
    const r = await runMatcher(data, state, clock);
    assert.equal(r.enrolled, 1);
    assert.equal(data.enrollments.length, 1);
  });

  it("filter = [public_lead_form] → matching lead enrolls once, non-matching does not", async () => {
    const { data, state, clock } = setup(leadGraph({ sourceForm: ["public_lead_form"] }));
    data.events.push(makeEvent({ id: "e_match", event_type: "lead_created", phone: "9000000001", payload: { source_form: "public_lead_form" } }));
    data.events.push(makeEvent({ id: "e_other", event_type: "lead_created", phone: "9000000002", payload: { source_form: "quiz" } }));
    const r = await runMatcher(data, state, clock);
    assert.equal(r.enrolled, 1, "only the matching form should enrol");
    assert.equal(data.enrollments.length, 1);
    // both events are still marked processed (drained)
    assert.equal(r.eventsProcessed, 2);
  });

  it("re-running does not double-enroll the matched lead (idempotent)", async () => {
    const { data, state, clock } = setup(leadGraph({ sourceForm: ["public_lead_form"] }));
    const ev = makeEvent({ id: "e_dup", event_type: "lead_created", payload: { source_form: "public_lead_form" }, dedupe_key: "lead_created:LD" });
    data.events.push(ev);
    await runMatcher(data, state, clock);
    data.events.forEach((e) => ((e as { processed_at?: string }).processed_at = undefined));
    await runMatcher(data, state, clock);
    assert.equal(data.enrollments.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Part B — every canonical lead form is registered (audit)
// ---------------------------------------------------------------------------
describe("Part B: canonical lead source forms are wired", () => {
  it("includes each call-site's source_form", () => {
    const values = LEAD_SOURCE_FORMS.map((s) => s.value);
    for (const v of ["public_lead_form", "lead_popup", "enroll_intent", "quiz", "webinar_registration", "admin_manual"]) {
      assert.ok(values.includes(v), `missing source_form: ${v}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Part D — responsive builder shell (smoke over the CSS contract)
// ---------------------------------------------------------------------------
describe("Part D: builder shell is full-bleed + collapsible", () => {
  const css = readFileSync(path.join(process.cwd(), "components/journey-automation/builder/builder.css"), "utf8");
  it("breaks out to full viewport width (beside the sidebar)", () => {
    assert.match(css, /\.ja-fullbleed/);
    assert.match(css, /100vw/);
  });
  it("uses a fluid center column (never fixed-trapped)", () => {
    assert.match(css, /minmax\(0,\s*1fr\)/);
  });
  it("supports collapsing the palette and inspector", () => {
    assert.match(css, /data-left="collapsed"/);
    assert.match(css, /data-right="collapsed"/);
  });
});
