/**
 * LATEST-STATE REVALIDATION — the safety heart of the engine. PURE decisions over
 * the CURRENT business state (fetched read-only right before executing a node).
 *
 * Invariant: the engine NEVER acts on state captured at enrollment. Before every
 * node it re-derives truth and asks: has the goal been met? is the contact
 * disqualified? should this specific reminder be suppressed? "Please pay" must
 * stop the instant the student pays.
 */

export interface LatestState {
  /** The relevant payment has arrived (installment/seat/goal payment). */
  paid: boolean;
  /** Still has an outstanding overdue installment. */
  hasOverdue: boolean;
  optedOut: boolean;
  /** Enrolled/active in the target course. */
  enrolledInCourse: boolean;
  /** Registered for the target webinar. */
  registeredForWebinar: boolean;
  /** Plan paused / proof-of-payment uploaded / fee waived => suppress dunning. */
  planPausedOrWaived: boolean;
  /**
   * Has ever signed into the student/buyer portal (real signal:
   * students.last_active_date is stamped on login). Optional for backward
   * compatibility with older state fixtures (treated as false when absent).
   */
  loggedIn?: boolean;
}

/** Does the workflow's goal count as met given latest state? */
export function evaluateGoal(goalType: string | null | undefined, s: LatestState): boolean {
  switch ((goalType ?? "").toLowerCase()) {
    case "payment_completed":
    case "payment_received":
    case "installment_paid":
    case "fully_paid":
      return s.paid;
    case "course_enrolled":
    case "enrolled":
      return s.enrolledInCourse;
    case "webinar_registered":
    case "registered":
      return s.registeredForWebinar;
    case "logged_in":
    case "portal_login":
      return !!s.loggedIn;
    default:
      return false;
  }
}

/**
 * Disqualifiers cancel the whole enrollment regardless of node. Opt-out always
 * disqualifies; a met goal disqualifies (handled as goal_met upstream).
 */
export function isDisqualified(s: LatestState): { disqualified: boolean; reason: string | null } {
  if (s.optedOut) return { disqualified: true, reason: "opted_out" };
  return { disqualified: false, reason: null };
}

/** Pure condition-node evaluation over latest state. Shared by worker + dry-run. */
export function evaluateCondition(config: Record<string, unknown>, s: LatestState): boolean {
  const check = String(config?.["check"] ?? config?.["field"] ?? "").toLowerCase();
  switch (check) {
    case "is_paid":
    case "paid":
      return s.paid;
    case "has_overdue":
    case "overdue":
      return s.hasOverdue;
    case "opted_out":
      return s.optedOut;
    case "enrolled":
    case "enrolled_in_course":
      return s.enrolledInCourse;
    case "registered":
    case "registered_for_webinar":
      return s.registeredForWebinar;
    case "plan_paused_or_waived":
      return s.planPausedOrWaived;
    case "has_logged_in":
    case "logged_in":
      return !!s.loggedIn;
    default:
      return false;
  }
}

export type ReminderCategory = "payment_reminder" | "promotional" | "transactional" | string;

/**
 * Per-send suppression on latest state. A payment/overdue reminder must NOT go out
 * if the student already paid, has no overdue, paused the plan, uploaded proof, got
 * a waiver, or opted out.
 */
export function shouldSuppressReminder(
  category: ReminderCategory,
  s: LatestState,
): { suppress: boolean; reason: string | null } {
  if (s.optedOut) return { suppress: true, reason: "opted_out" };
  if (category === "payment_reminder") {
    if (s.paid) return { suppress: true, reason: "already_paid" };
    if (!s.hasOverdue) return { suppress: true, reason: "no_overdue" };
    if (s.planPausedOrWaived) return { suppress: true, reason: "plan_paused_or_waived" };
  }
  return { suppress: false, reason: null };
}
