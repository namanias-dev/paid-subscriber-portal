/**
 * SINGLE SOURCE OF TRUTH for analytics metric definitions.
 *
 * Every KPI card, table column header and chart title in the admin Business
 * Analytics dashboard reads its tooltip text from here, and docs/staff/analytics.md
 * mirrors the same wording. The `meaning` line is plain English; the `formula`
 * line states the exact denominator/computation. If the implementation ever
 * diverges from these, FIX THE CODE to match (or update the text and flag it) —
 * tooltips must always describe how the number is actually computed.
 */

export interface MetricDef {
  /** Stable key used to look up the tooltip from UI code. */
  key: string;
  /** Short on-screen label. */
  label: string;
  /** Line 1 — plain meaning. */
  meaning: string;
  /** Line 2 — exact formula / denominator. */
  formula: string;
}

export const METRICS: Record<string, MetricDef> = {
  visitors: {
    key: "visitors",
    label: "Unique visitors",
    meaning: "Unique people who opened the site.",
    formula: "Distinct visitor IDs in range (10 refreshes by one person = 1).",
  },
  sessions: {
    key: "sessions",
    label: "Sessions",
    meaning: "Separate browsing visits.",
    formula: "Distinct session IDs in range (a new session starts after inactivity).",
  },
  pageViews: {
    key: "pageViews",
    label: "Page views",
    meaning: "Total pages opened.",
    formula: "Count of page_view events in range (events, not people).",
  },
  logins: {
    key: "logins",
    label: "Logins",
    meaning: "Times students logged into the portal.",
    formula: "Count of login events in range. The hint shows unique users.",
  },
  loginUsers: {
    key: "loginUsers",
    label: "Logged-in users",
    meaning: "Unique students who logged in.",
    formula: "Distinct users with at least one login event in range.",
  },
  registrations: {
    key: "registrations",
    label: "New registrations",
    meaning: "New webinar / lead registrations.",
    formula: "Distinct registrations created in range (deduped per person+webinar).",
  },
  paymentInitiated: {
    key: "paymentInitiated",
    label: "Payment initiated",
    meaning: "Payment attempts that were started.",
    formula: "Count of payment rows created in range (any status, from the Payments table).",
  },
  paidStudents: {
    key: "paidStudents",
    label: "Paid students",
    meaning: "Unique students who actually paid.",
    formula: "Distinct phones with ≥1 verified/approved payment in range (one person = 1, even if they paid twice).",
  },
  paidTransactions: {
    key: "paidTransactions",
    label: "Paid transactions",
    meaning: "Successful payments received.",
    formula: "Verified/approved payments in range, with retry-duplicate rows collapsed.",
  },
  revenue: {
    key: "revenue",
    label: "Revenue",
    meaning: "Money actually received.",
    formula: "Sum of verified/approved payments only (PAID/captured). Never pending, verifying, failed or abandoned. Ties to the Payments tab.",
  },
  abandoned: {
    key: "abandoned",
    label: "Payment abandoned",
    meaning: "Attempts the student walked away from.",
    formula: "Payments marked ABANDONED in range.",
  },
  proofPending: {
    key: "proofPending",
    label: "Proofs pending approval",
    meaning: "Payment proofs waiting for a staff decision.",
    formula: "Current payment_proofs with status 'submitted' (backlog, not range-limited).",
  },
  verifyingAmount: {
    key: "verifyingAmount",
    label: "Amount in verifying",
    meaning: "Money awaiting verification (not yet counted as revenue).",
    formula: "Sum of VERIFYING payment amounts created in range.",
  },
  // ---- conversions ----
  visitorToPaid: {
    key: "visitorToPaid",
    label: "Visitor → Paid %",
    meaning: "Share of visitors who became paying students.",
    formula: "Paid students ÷ unique visitors (source level). N/A when there are no tracked visitors for that source (e.g. pre-tracking).",
  },
  registrationToPaid: {
    key: "registrationToPaid",
    label: "Registration → Paid %",
    meaning: "Share of registrations that converted to a payment.",
    formula: "Paid students ÷ registrations in range. N/A when registrations = 0.",
  },
  paymentToPaid: {
    key: "paymentToPaid",
    label: "Payment → Paid %",
    meaning: "Share of payment attempts that succeeded.",
    formula: "Paid transactions ÷ payment initiated. N/A when no attempts.",
  },
  avgRevenuePerStudent: {
    key: "avgRevenuePerStudent",
    label: "Avg revenue / student",
    meaning: "Average spend per paying student.",
    formula: "Revenue ÷ paid students. N/A when paid students = 0.",
  },
};

/** Source-bucket display labels (kept in sync with classifyPaymentSource). */
export const SOURCE_LABELS: Record<string, string> = {
  untracked: "Untracked",
  pre_tracking: "Pre-tracking",
  admin: "Admin (manual)",
  direct: "Direct",
  referral: "Referral",
  other: "Other",
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  google: "Google",
  youtube: "YouTube",
  telegram: "Telegram",
};

/** Buckets that have NO valid visitor attribution → Visitor→Paid % shows N/A. */
export const NON_ATTRIBUTABLE_SOURCES: ReadonlySet<string> = new Set(["untracked", "pre_tracking", "admin"]);

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] || (source ? source.charAt(0).toUpperCase() + source.slice(1) : "Unknown");
}

/**
 * Global "About these numbers" notes shown in an info panel on the dashboard and
 * repeated verbatim in the staff docs. `{trackingStart}` is replaced at render.
 */
export const GLOBAL_NOTES: string[] = [
  "All numbers respect the selected date range and are shown in IST.",
  "People vs events: visitors, logged-in users and paid students count unique people; page views and transactions count events.",
  "Revenue counts verified or admin-approved payments only — never pending, verifying, failed or abandoned.",
  "Conversions show “N/A” when there is no valid denominator (e.g. revenue from before visitor tracking began).",
  "Duplicate retry payments are collapsed, so one purchase is never counted twice and a duplicate attempt never inflates paid students.",
  "Source buckets: “Untracked” = no source captured · “Pre-tracking” = created before visitor tracking began ({trackingStart}) · “Admin (manual)” = offline/admin-recorded payments. These have no visitor attribution, so their conversion rates are N/A.",
];

export function metricTip(key: string): { label: string; meaning: string; formula: string } | null {
  const m = METRICS[key];
  return m ? { label: m.label, meaning: m.meaning, formula: m.formula } : null;
}
