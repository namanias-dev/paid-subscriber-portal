/**
 * AI Counselor Agent — DETERMINISTIC lead scoring.
 *
 * Pure functions, NO side effects, NO I/O. Given a set of observed signals it
 * returns an integer score and a temperature bucket. The same input ALWAYS
 * produces the same output (important for auditability and testability).
 *
 * Temperature buckets:
 *    0 – 29  -> 'cold'
 *   30 – 59  -> 'warm'
 *   60+      -> 'hot'
 *
 * HARD RULE: a single pageview can NEVER produce 'hot'. The weights below are
 * tuned so that low-intent browsing stays 'cold', a prospect who engages with
 * offers / shares details becomes 'warm', and only strong buying signals
 * (payment intent, webinar interest + contact details, repeat sessions) reach
 * 'hot'. All weights are documented inline so they can be tuned intentionally.
 */

export type Temperature = "cold" | "warm" | "hot";

export interface LeadSignals {
  /** Distinct marketing/site pageviews observed in this journey. */
  pageviews?: number;
  /** Times the prospect opened a specific course/webinar offer. */
  offerViews?: number;
  /** Count of profile fields provided (name, city, target_year, email, ...). */
  formFieldsProvided?: number;
  /** Prospect shared a phone number (strong contactability signal). */
  hasPhone?: boolean;
  /** Prospect shared an email. */
  hasEmail?: boolean;
  /** Expressed interest in a specific webinar (asked about / clicked register). */
  webinarInterest?: boolean;
  /** Reached a payment/checkout step or explicitly asked to pay/enroll. */
  paymentIntent?: boolean;
  /** Distinct sessions seen for this lead (repeat visitor). */
  repeatSessions?: number;
  /** Number of agent conversation turns from the user (engagement depth). */
  conversationTurns?: number;
  /** Granted marketing consent (willing to be contacted). */
  marketingConsent?: boolean;
}

/** Documented weights (points). Keep intentional and conservative. */
export const SCORE_WEIGHTS = {
  /** Each pageview after the first, capped — browsing is weak intent. */
  perPageview: 3,
  pageviewCap: 12,
  /** Each opened offer — meaningful interest. */
  perOfferView: 8,
  offerViewCap: 24,
  /** Each profile field shared. */
  perFormField: 5,
  formFieldCap: 20,
  /** Contactability. */
  hasPhone: 15,
  hasEmail: 8,
  /** Specific webinar interest. */
  webinarInterest: 15,
  /** Strong buying signal. */
  paymentIntent: 30,
  /** Each additional session (returning prospect), capped. */
  perRepeatSession: 8,
  repeatSessionCap: 24,
  /** Conversation engagement depth, capped. */
  perConversationTurn: 2,
  conversationTurnCap: 12,
  /** Willing to be marketed to. */
  marketingConsent: 5,
} as const;

function clampNonNeg(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export interface ScoreResult {
  score: number;
  temperature: Temperature;
  /** Per-signal contribution breakdown (for audit/debug; safe, non-PII). */
  breakdown: Record<string, number>;
}

export function temperatureFor(score: number): Temperature {
  if (score >= 60) return "hot";
  if (score >= 30) return "warm";
  return "cold";
}

/** Compute a deterministic score + temperature from signals. */
export function scoreLead(signals: LeadSignals): ScoreResult {
  const w = SCORE_WEIGHTS;
  const breakdown: Record<string, number> = {};

  const pageviews = clampNonNeg(signals.pageviews);
  // First pageview contributes nothing; extras contribute up to the cap.
  breakdown.pageviews = Math.min(Math.max(pageviews - 1, 0) * w.perPageview, w.pageviewCap);

  breakdown.offerViews = Math.min(clampNonNeg(signals.offerViews) * w.perOfferView, w.offerViewCap);

  breakdown.formFields = Math.min(clampNonNeg(signals.formFieldsProvided) * w.perFormField, w.formFieldCap);

  breakdown.phone = signals.hasPhone ? w.hasPhone : 0;
  breakdown.email = signals.hasEmail ? w.hasEmail : 0;
  breakdown.webinarInterest = signals.webinarInterest ? w.webinarInterest : 0;
  breakdown.paymentIntent = signals.paymentIntent ? w.paymentIntent : 0;

  const repeats = clampNonNeg(signals.repeatSessions);
  breakdown.repeatSessions = Math.min(Math.max(repeats - 1, 0) * w.perRepeatSession, w.repeatSessionCap);

  breakdown.conversationTurns = Math.min(
    clampNonNeg(signals.conversationTurns) * w.perConversationTurn,
    w.conversationTurnCap,
  );

  breakdown.marketingConsent = signals.marketingConsent ? w.marketingConsent : 0;

  let score = Object.values(breakdown).reduce((a, b) => a + b, 0);

  // HARD RULE: a single pageview (and nothing else) can never be hot/warm.
  // With only 1 pageview every other term is 0, so score is already 0 — but we
  // defend the invariant explicitly in case weights change later.
  const onlyOnePageview =
    pageviews <= 1 &&
    !signals.hasPhone &&
    !signals.hasEmail &&
    !signals.webinarInterest &&
    !signals.paymentIntent &&
    clampNonNeg(signals.offerViews) === 0 &&
    clampNonNeg(signals.formFieldsProvided) === 0 &&
    repeats <= 1;
  if (onlyOnePageview) score = Math.min(score, 5);

  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, temperature: temperatureFor(score), breakdown };
}
