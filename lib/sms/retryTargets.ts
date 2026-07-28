/**
 * Who a "retry failed only" is allowed to reach.
 *
 * THIS EXISTS BECAUSE THE CLIENT GOT IT WRONG. The retry button used to post the
 * review session's own list of sendable rows, which after a send still contains
 * everyone — so a retry re-sent to recipients whose message had already arrived.
 * The target set therefore has to come from the send log, which records what
 * actually happened, rather than from session state, which records what was
 * intended before anything happened.
 *
 * The rule is deliberately stricter than "the last attempt failed": a recipient
 * is a target only if NO attempt in the campaign ever reached them. An earlier
 * success followed by a later failure means they have the message, and a retry
 * would be a duplicate. Expressing it as a set difference is what makes reaching
 * a delivered recipient impossible rather than merely guarded against — there is
 * no ordering of logs, and no bug in "latest attempt" reasoning, that can put an
 * enrollment in both sets at once.
 */
import { isRemindedStatus } from "./installmentAttribution";

export interface RetryCandidateLog {
  status: string;
  template_id?: string | null;
  course_enrollment_id?: string | null;
  installment_no?: number | null;
  created_at: string;
  sent_at?: string | null;
}

export interface RetryTargets {
  /** Enrollments to retry: every attempt for them failed. */
  enrollmentIds: string[];
  /**
   * Enrollments that reached, or may have reached, a handset. Returned so the
   * caller can assert the two sets are disjoint instead of trusting this module.
   */
  reachedEnrollmentIds: string[];
  /** Why a log in the campaign did not produce a target. */
  skipped: Record<string, number>;
}

/**
 * Split a campaign's logs into "safe to retry" and "already reached".
 *
 * Pure and synchronous: no clock, no DB, no template lookups. Everything it
 * decides is a function of the rows handed to it, so a test can reconstruct any
 * campaign shape exactly.
 */
export function resolveRetryTargets(
  logs: RetryCandidateLog[],
  opts: { templateId?: string } = {},
): RetryTargets {
  const skipped: Record<string, number> = {};
  const bump = (k: string) => { skipped[k] = (skipped[k] ?? 0) + 1; };

  const reached = new Set<string>();
  const failed = new Set<string>();

  for (const log of logs) {
    if (opts.templateId && log.template_id && log.template_id !== opts.templateId) {
      bump("other_template");
      continue;
    }
    // Without an attribution key there is no way to say which student and which
    // installment this was about, so it cannot be re-sent safely.
    if (!log.course_enrollment_id) {
      bump("no_attribution_key");
      continue;
    }
    // QUEUED counts as reached: the row exists because the send was handed on,
    // and the honest assumption for an unresolved send is that it may arrive.
    if (isRemindedStatus(log.status)) reached.add(log.course_enrollment_id);
    else if (String(log.status).toUpperCase() === "FAILED") failed.add(log.course_enrollment_id);
    else bump(`status_${String(log.status).toLowerCase()}`);
  }

  // THE INVARIANT: a single success anywhere in the campaign removes a recipient
  // from the retry set for good.
  const targets: string[] = [];
  for (const id of failed) {
    if (reached.has(id)) bump("delivered_elsewhere_in_campaign");
    else targets.push(id);
  }

  return { enrollmentIds: targets, reachedEnrollmentIds: [...reached], skipped };
}

/**
 * True when a retry target set is safe to send.
 *
 * The route calls this immediately before sending so the guarantee is enforced at
 * the point of use, not just at the point of derivation — if a future refactor
 * ever lets a reached recipient into the list, the send refuses rather than
 * quietly delivering a duplicate.
 */
export function retryTargetsAreDisjoint(t: RetryTargets): boolean {
  const reached = new Set(t.reachedEnrollmentIds);
  return t.enrollmentIds.every((id) => !reached.has(id));
}
