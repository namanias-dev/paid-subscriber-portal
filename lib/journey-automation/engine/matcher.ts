/**
 * TRIGGER MATCHER (pure orchestrator over ports). Drains new automation_events,
 * matches each to ACTIVE (simulate/live) published workflow versions whose trigger
 * fires on the event type, applies eligibility (+ canary), and enrolls eligible
 * contacts idempotently: one event → at most one enrollment per workflow.
 *
 * Sends NOTHING. Enrolling is safe: enrollment/job rows are journey-owned runtime,
 * never business truth. With every workflow at execution_mode='off' (the default),
 * listCandidateWorkflows returns nothing and this is a no-op.
 */
import type { EngineDataPort, StatePort, Clock } from "./ports";
import { systemClock } from "./ports";
import { checkEligibility, canaryAllows } from "./eligibility";
import { enrollmentModeFor, shouldProcess } from "./mode";
import { enrollmentDedupeKey, jobDedupeKey } from "./keys";
import { entryNodeKey } from "./graph";

export interface MatcherResult {
  halted?: string;
  eventsProcessed: number;
  enrolled: number;
  suppressed: number;
  skipped: number;
}

export interface MatcherOptions { batchSize?: number }

export async function runMatcher(
  data: EngineDataPort,
  state: StatePort,
  clock: Clock = systemClock,
  opts: MatcherOptions = {},
): Promise<MatcherResult> {
  const res: MatcherResult = { eventsProcessed: 0, enrolled: 0, suppressed: 0, skipped: 0 };

  const settings = await data.getSettings();
  if (settings.killSwitchEngaged) return { ...res, halted: "kill_switch" };

  const events = await data.getUnprocessedEvents(opts.batchSize ?? 100);
  const nowISO = new Date(clock.now()).toISOString();

  for (const ev of events) {
    const candidates = await data.listCandidateWorkflows(ev.event_type);
    for (const cand of candidates) {
      const wf = cand.workflow;
      if (shouldProcess(wf.execution_mode, settings.killSwitchEngaged) === "off") { res.skipped++; continue; }
      if (wf.killswitch_disabled) { res.skipped++; continue; }

      const facts = await state.getEligibilityFacts(wf, ev);
      const activeCount = await data.countActiveEnrollments(wf.id);
      const canaryAllowed = canaryAllows(facts.normalizedPhone, activeCount, wf.canary_max_enrollments, wf.canary_test_phones);
      const elig = checkEligibility({ ...facts, canaryAllowed });
      if (!elig.eligible) {
        await data.recordSuppression({
          enrollment_id: null, workflow_id: wf.id, node_key: null,
          normalized_phone: facts.normalizedPhone, reason: `enroll:${elig.reason}`,
          detail: { event_id: ev.id, event_type: ev.event_type },
        });
        res.suppressed++;
        continue;
      }

      const entry = entryNodeKey(cand.graph);
      if (!entry) { res.skipped++; continue; }

      const mode = enrollmentModeFor(wf.execution_mode);
      const dedupe = enrollmentDedupeKey(cand.version_id, facts.normalizedPhone, ev.id);
      const { enrollment, created } = await data.createEnrollment({
        workflow_id: wf.id,
        version_id: cand.version_id,
        event_id: ev.id,
        normalized_phone: facts.normalizedPhone,
        student_id: ev.student_id,
        lead_id: ev.lead_id,
        enrollment_ref: ev.enrollment_id,
        mode,
        current_node_key: entry,
        context: {
          event_type: ev.event_type,
          payload: ev.payload ?? {},
          webinar_id: ev.webinar_id ?? null,
          payment_id: ev.payment_id ?? null,
        },
        dedupe_key: dedupe,
      });
      if (!created) { res.skipped++; continue; }

      await data.scheduleJob({
        enrollment_id: enrollment.id,
        workflow_id: wf.id,
        node_key: entry,
        scheduled_for: nowISO,
        dedupe_key: jobDedupeKey(enrollment.id, entry),
      });
      res.enrolled++;
    }
    await data.markEventProcessed(ev.id);
    res.eventsProcessed++;
  }

  return res;
}
