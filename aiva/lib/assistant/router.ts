/**
 * Deterministic intent router — pure, unit-tested, no I/O. It maps a user message to a single
 * whitelisted tool + params, WITHOUT an LLM. It powers two things:
 *   1) every pre-listed CEO question (so the product is fully useful and verifiable with zero
 *      LLM cost or key), and
 *   2) a guaranteed fallback when no LLM provider is configured or the planner errors.
 * When an LLM IS configured, it plans instead (see llm.ts) but is still constrained to this
 * same whitelist, so numbers are always grounded and never hallucinated.
 */

export type Intent = { tool: string; args: Record<string, unknown> };

const ACTION_PATTERNS: RegExp[] = [
  /\b(send|deliver|blast|fire off|shoot|dispatch)\b.*\b(sms|text|message|reminder|remind|email|whatsapp|notification|notice)\b/i,
  /\bremind\s+(them|him|her|these|the|all|everyone|students?)\b/i,
  /\b(mark|set|update|edit|change|modify|delete|remove|drop|enrol|enroll|un-?enrol|refund|charge|collect|waive|disable|enable|publish|unpublish|cancel|approve|reject|reset|assign|move|merge|import|export|download)\b/i,
  /\b(pay|charge)\s+(them|him|her|the|this)\b/i,
];

/** True when the message asks AIVA to DO something (a mutation) rather than SEE/ANALYZE. */
export function isActionRequest(message: string): boolean {
  const m = String(message || "").trim();
  if (!m) return false;
  return ACTION_PATTERNS.some((re) => re.test(m));
}

function has(m: string, ...words: string[]): boolean {
  return words.some((w) => m.includes(w));
}

/** Extract a student query from a lookup-style message ("student X", "X's payments", a phone). */
function extractStudentQuery(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-10);
  const m = raw.trim();
  const patterns = [
    /(?:student|profile of|look ?up|show me|find|360 (?:for|on)?|about|history of|timeline of)\s+([a-z][a-z .'-]{1,40})/i,
    /([a-z][a-z .'-]{1,40})'s\s+(?:payments?|profile|history|timeline|status|enrol)/i,
  ];
  for (const re of patterns) {
    const mm = m.match(re);
    if (mm && mm[1]) {
      const q = mm[1].trim().replace(/[?.!]+$/, "");
      if (q.length >= 2 && !/^(is|are|the|my|all|any|who|what|which|them|this|these|it)$/i.test(q)) return q;
    }
  }
  return null;
}

/**
 * Route a message to one whitelisted tool. Returns null when no confident deterministic match
 * exists (the caller then either asks the LLM or replies "no tool for that").
 */
export function routeIntent(message: string): Intent | null {
  const m = String(message || "").toLowerCase().trim();
  if (!m) return null;

  const periodMonth = has(m, "month", "30 day", "30-day", "this month");
  const periodQuarter = has(m, "quarter", "90 day", "3 month");

  // Student 360 first if a specific person/phone is referenced.
  const sq = extractStudentQuery(message);
  if (sq && !has(m, "overdue", "webinar", "batch", "attention", "collection")) {
    return { tool: "getStudent360", args: { query: sq } };
  }

  if (has(m, "overdue", "late payment", "not paid", "unpaid", "behind on")) {
    const min = /\b15\b/.test(m) ? 15 : /\b30\b/.test(m) && has(m, "overdue") ? 30 : /\b(a week|7 day|8\+|8 day)\b/.test(m) ? 8 : 1;
    return { tool: "getOverdueStudents", args: { minDaysOverdue: min } };
  }

  if (has(m, "aging", "at risk", "at-risk", "risk revenue", "revenue at", "abandoned")) {
    return { tool: "getRevenueAging", args: {} };
  }

  if (has(m, "webinar")) {
    return { tool: "getWebinarPerformance", args: {} };
  }

  if (has(m, "batch") && has(m, "fill", "slow", "seat", "capacity", "filling", "timeline", "start")) {
    return { tool: "getBatchFill", args: {} };
  }
  if (has(m, "batch")) return { tool: "getBatchFill", args: {} };

  // Zero-contact is checked BEFORE enrollments so "enrolled students never contacted" routes here.
  if ((has(m, "contact", "sms", "texted", "text", "message", "reached", "reach out") && has(m, "never", "no ", "not ", "zero", "without", "haven't", "havent")) || has(m, "never been contacted", "no sms")) {
    return { tool: "getZeroContactStudents", args: {} };
  }

  if (has(m, "enrol", "enroll", "admission", "signups", "sign-ups", "sign ups")) {
    return { tool: "getEnrollmentsTrend", args: { period: periodMonth ? "month" : has(m, "week") ? "week" : "month" } };
  }

  if (has(m, "attention", "priorit", "focus", "urgent", "today", "problem", "wrong", "worry", "worried", "look at", "care about")) {
    return { tool: "getAttentionItems", args: {} };
  }

  if (has(m, "collect", "revenue", "money", "income", "cash", "sales", "how much")) {
    return { tool: "getCollectionsSummary", args: { period: periodQuarter ? "quarter" : periodMonth ? "month" : "week", comparePrevious: true } };
  }

  return null;
}

/** Context-aware follow-up suggestions per tool (shown as tap-to-ask chips). Pure. */
export function followupsFor(tool: string | null): string[] {
  switch (tool) {
    case "getCollectionsSummary":
      return ["How does this month compare to last?", "How much is overdue right now?", "Which webinar drove the most revenue?"];
    case "getOverdueStudents":
      return ["Which of these have never been reminded?", "Show the full overdue aging breakdown", "What needs my attention today?"];
    case "getWebinarPerformance":
      return ["How many converts have paid in full?", "Which batch are these converts in?", "Enrollments this month vs last?"];
    case "getBatchFill":
      return ["Which batch is filling fastest?", "How many enrolled this month vs last?", "Show revenue by batch"];
    case "getEnrollmentsTrend":
      return ["Split webinar vs direct in detail", "Which webinar converted best?", "Who enrolled but hasn't paid?"];
    case "getZeroContactStudents":
      return ["Who's overdue 15+ days?", "What needs my attention today?", "Show me abandoned checkouts"];
    case "getAttentionItems":
      return ["Who's overdue 15+ days, and how much?", "How are collections this week vs last?", "Show revenue aging"];
    case "getStudent360":
      return ["Who else is overdue like this?", "How are collections this week?", "What needs my attention today?"];
    case "getRevenueAging":
      return ["Who's overdue 15+ days?", "Show abandoned checkouts", "How are collections this week vs last?"];
    default:
      return ["What needs my attention today?", "How are collections this week vs last?", "Who's overdue 15+ days?"];
  }
}

/** The seed CEO questions shown on the empty state (kept in code so tests pin their routing). */
export const SEED_QUESTIONS: string[] = [
  "How are collections this week vs last?",
  "Who's overdue 15+ days, and how much?",
  "Which webinar converted best and worst?",
  "Which batch is filling slowest?",
  "Enrollments this month vs last month?",
  "Which enrolled students have never been contacted?",
  "What needs my attention today?",
];
