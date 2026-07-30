/**
 * THE SINGLE SOURCE OF TRUTH FOR LEAD PIPELINE STATUS.
 *
 * Every surface that renders, filters, orders, colours, validates, defaults,
 * exports or aggregates a lead status imports from this file. Nothing else in
 * the codebase may contain a status string literal —
 * `tests/lead-status-consolidation/no-hardcoded-status.test.ts` fails the build
 * if it does. That guard is the whole point: this consolidation replaced five
 * divergent status vocabularies, and without a test the sixth would appear
 * within a month.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT `LeadWorkStatus`. DO NOT LET THE TWO CONVERGE.
 * ---------------------------------------------------------------------------
 * `LEAD_WORK_STATUSES` (`lib/types.ts`) is the counsellor's MUTABLE working
 * state — where they are with the lead right now. It is overwritten as they
 * work and is CHECK-enforced separately.
 *
 * `LeadStatus` (here) is the PIPELINE DISPOSITION — the outcome of record. The
 * two vocabularies overlap in wording (`callback_scheduled` vs `Call Back`,
 * `interested` vs `Interested`) and that overlap is a trap: merging them would
 * lose the callback signal the first time a counsellor touched the row.
 *
 * ---------------------------------------------------------------------------
 * WHAT `Not Called` MEANS, AND WHY IT IS NOT `Not Replied`
 * ---------------------------------------------------------------------------
 * `Not Called` was named `New` before the 2026-07-25 consolidation. On the
 * 62,641 legacy rows that carry it, it means the calling team never
 * dispositioned the lead — established by an exact 1:1 partition against
 * `legacy_call_status_raw IS NULL` (62,641 matched, 0 unmatched in either
 * direction). `Not Replied` means a human dialled and got no answer, because
 * they typed that into the source sheet.
 *
 * Collapsing the two would have created a single 125,411-row bucket asserting
 * a contact attempt for 62,641 people who were never dialled, and the
 * distinction is not reconstructible from `status` afterwards. Do not merge
 * them. (`contact_attempt_count` cannot arbitrate this: it reads 0 for ALL
 * legacy rows including every `Not Replied`, because it tracks portal-era
 * contact and the import never populated it.)
 *
 * ---------------------------------------------------------------------------
 * BEHAVIOUR LADDER (2026-07-30)
 * ---------------------------------------------------------------------------
 * `Webinar Registered` and `Seat Booked` sit on the behaviour ladder between
 * demo attendance and admission. Staff judgement values (Not Interested, etc.)
 * remain fully usable but never block a behaviour-driven flip — see
 * `lib/leadBehaviourStatus.ts`.
 */

// ============================================================================
// THE 15 CANONICAL VALUES
// ============================================================================

export type LeadStatus =
  | "Not Called"
  | "Not Replied"
  | "Call Back"
  | "Interested"
  | "High Potential Lead"
  | "Wants Free Seminar"
  | "Walk In"
  | "Demo Booked"
  | "Demo Attended"
  | "Webinar Registered"
  | "Seat Booked"
  | "Admission Done"
  | "Repeat"
  | "Not Interested"
  | "Wrong No.";

/**
 * Tailwind pill class from the admin design system (`app/globals.css`).
 * Deliberately reuses the existing palette rather than introducing new CSS —
 * this consolidation swaps the value set, it does not redesign the UI.
 */
export type LeadStatusPill =
  | "pill-gray"
  | "pill-blue"
  | "pill-amber"
  | "pill-saffron"
  | "pill-green"
  | "pill-gold"
  | "pill-red"
  | "pill-slate"
  | "pill-emerald";

export interface LeadStatusMeta {
  /** The exact string persisted in `public.leads.status`. */
  readonly value: LeadStatus;
  /** What the user sees. Identical to `value` today; separate so a future
   *  relabel does not require a data migration. */
  readonly label: string;
  /** Design-system pill class. Grouped into tonal families by funnel phase —
   *  several statuses intentionally share a colour because they share a
   *  meaning-band; the label always disambiguates. */
  readonly pill: LeadStatusPill;
  /** 1-based display/sort order: cold -> warm -> converted -> dead. */
  readonly order: number;
  /** One-line meaning, surfaced as the filter/select title attribute. */
  readonly description: string;
}

/**
 * The canonical ordering: cold -> warm -> converted -> dead.
 *
 * Kanban columns, every dropdown, the export and the analytics grouping all
 * read this array directly, so the order is defined once and cannot drift
 * between surfaces.
 */
export const LEAD_STATUS_META: readonly LeadStatusMeta[] = [
  { value: "Not Called",          label: "Not Called",          pill: "pill-gray",    order: 1,  description: "No contact attempt has ever been made." },
  { value: "Not Replied",         label: "Not Replied",         pill: "pill-gray",    order: 2,  description: "Dialled, but the lead did not answer." },
  { value: "Call Back",           label: "Call Back",           pill: "pill-amber",   order: 3,  description: "Answered and asked to be called back — highest-intent early signal." },
  { value: "Interested",          label: "Interested",          pill: "pill-blue",    order: 4,  description: "Expressed interest in a course." },
  { value: "High Potential Lead", label: "High Potential Lead", pill: "pill-saffron", order: 5,  description: "Strong intent or a paid micro-conversion." },
  { value: "Wants Free Seminar",  label: "Wants Free Seminar",  pill: "pill-amber",   order: 6,  description: "Asked to attend a free seminar." },
  { value: "Walk In",             label: "Walk In",             pill: "pill-saffron", order: 7,  description: "Visited the centre in person." },
  { value: "Demo Booked",         label: "Demo Booked",         pill: "pill-blue",    order: 8,  description: "A demo class is scheduled." },
  { value: "Demo Attended",       label: "Demo Attended",       pill: "pill-blue",    order: 9,  description: "Attended the demo class." },
  { value: "Webinar Registered",  label: "Webinar Registered",  pill: "pill-slate",   order: 10, description: "Confirmed webinar registration (free, or paid after successful payment)." },
  { value: "Seat Booked",         label: "Seat Booked",         pill: "pill-amber",   order: 11, description: "Course seat deposit paid — reserved a seat." },
  { value: "Admission Done",      label: "Admission Done",      pill: "pill-emerald", order: 12, description: "Admitted — installment or full course payment received." },
  { value: "Repeat",              label: "Repeat",              pill: "pill-gold",    order: 13, description: "A returning student or repeat enquiry." },
  { value: "Not Interested",      label: "Not Interested",      pill: "pill-red",     order: 14, description: "Declined — includes leads previously marked Lost." },
  { value: "Wrong No.",           label: "Wrong No.",           pill: "pill-red",     order: 15, description: "The number does not belong to the lead." },
] as const;

/** Every canonical status, in display/sort order. */
export const LEAD_STATUSES: readonly LeadStatus[] = LEAD_STATUS_META.map((m) => m.value);

/**
 * Default for a newly captured lead. A lead nobody has phoned yet has, by
 * definition, not been called.
 */
export const DEFAULT_LEAD_STATUS: LeadStatus = "Not Called";

/**
 * Where Phase 4 promotion lands a legacy lead entering the live pipeline.
 *
 * Promotion deliberately discards the legacy disposition rather than carrying
 * sheet-era wording into live funnel metrics; the original stays readable on
 * `legacy_call_status_raw`. Same value as `DEFAULT_LEAD_STATUS`, named
 * separately because they answer different questions and could diverge.
 */
export const PROMOTED_LEAD_STATUS: LeadStatus = "Not Called";

const META_BY_VALUE = new Map<string, LeadStatusMeta>(LEAD_STATUS_META.map((m) => [m.value, m]));

// ============================================================================
// RETIRED VALUES — the 2026-07-25 consolidation mapping
// ============================================================================

/**
 * Statuses that existed before the consolidation and no longer may be written.
 *
 * Kept as executable data rather than prose because three things consume it:
 * the SQL migration, the runtime coercion below (for any row written by a
 * process that predates the deploy), and the QA assertion that no surface
 * still renders a retired value.
 */
export const RETIRED_LEAD_STATUS_MAP: Readonly<Record<string, LeadStatus>> = {
  // RENAME — same meaning, honest label. 63,663 rows.
  "New": "Not Called",
  // RENAME — 3 rows.
  "Admitted": "Admission Done",
  // MERGE — "engaged then lost" folds into the single declined bucket. 112 rows.
  "Lost": "Not Interested",
  // MERGE — vague "reached, outcome unknown"; retired in favour of the
  // specific dispositions. 1 row, and that row is a seed fixture.
  "Contacted": "Interested",
  // MERGE — a genuine paid micro-conversion (the Rs.50 masterclass), which is
  // an intent signal, not an admission. 1 row.
  "Paid Rs. 50": "High Potential Lead",
  // RETIRED — zero rows. The fee-discussion stage was never used.
  "Negotiation": "Interested",
} as const;

/** Every retired status string, for QA assertions and the migration. */
export const RETIRED_LEAD_STATUSES: readonly string[] = Object.keys(RETIRED_LEAD_STATUS_MAP);

// ============================================================================
// LOOKUPS
// ============================================================================

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && META_BY_VALUE.has(value);
}

export function leadStatusMeta(value: string | null | undefined): LeadStatusMeta | null {
  return value == null ? null : META_BY_VALUE.get(value) ?? null;
}

/** Display label. Falls back to the raw string so an unexpected value is
 *  visible rather than blank — never silently hide data. */
export function leadStatusLabel(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  return META_BY_VALUE.get(value)?.label ?? value;
}

/** Design-system pill class. Unknown values render neutral, not invisible. */
export function leadStatusPill(value: string | null | undefined): LeadStatusPill {
  return (value == null ? null : META_BY_VALUE.get(value)?.pill) ?? "pill-gray";
}

/** Sort position. Unknown values sort last rather than first, so a stray value
 *  cannot displace `Not Called` at the head of the Kanban. */
export function leadStatusOrder(value: string | null | undefined): number {
  return (value == null ? null : META_BY_VALUE.get(value)?.order) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Coerce any historical status to a canonical one.
 *
 * Belt-and-braces for the deploy window: the migration rewrites every row, but
 * a request in flight against the old code could still write `New` between the
 * data migration and the code going live. Reads pass through here so such a row
 * displays correctly instead of falling out of a filtered view.
 *
 * Returns `null` for an unrecognised value — callers decide whether that is a
 * validation error (writes) or a passthrough (reads).
 */
export function normalizeLeadStatus(value: string | null | undefined): LeadStatus | null {
  if (value == null) return null;
  if (isLeadStatus(value)) return value;
  return RETIRED_LEAD_STATUS_MAP[value] ?? null;
}

// ============================================================================
// MERGE RANK — which row survives a de-duplication
// ============================================================================

/**
 * Pipeline-progress rank used by `scripts/dedupe-leads.mjs` to choose the
 * surviving row when two records share a phone number. Higher wins.
 *
 * This is NOT the display order. Display order runs cold -> dead so the Kanban
 * reads left to right; merge rank runs worst -> best so `Math.max` picks the
 * most advanced disposition. `Wrong No.` ranks below `Not Interested` because a
 * wrong number carries no information about the actual person, whereas a
 * decline does.
 *
 * The pre-consolidation table ranked `Lost` at -1 so it always lost a merge.
 * `Lost` now maps to `Not Interested`, which inherits that negative rank —
 * without this the merge winner would have changed silently.
 */
export const LEAD_STATUS_MERGE_RANK: Readonly<Record<LeadStatus, number>> = {
  "Wrong No.": -2,
  "Not Interested": -1,
  "Not Called": 0,
  "Not Replied": 1,
  "Call Back": 2,
  "Wants Free Seminar": 3,
  "Interested": 4,
  "High Potential Lead": 5,
  "Walk In": 6,
  "Demo Booked": 7,
  "Demo Attended": 8,
  "Webinar Registered": 9,
  "Seat Booked": 10,
  "Repeat": 11,
  "Admission Done": 12,
} as const;

// ============================================================================
// THE DASHBOARD FUNNEL
// ============================================================================

/**
 * The progress stages of the dashboard funnel, keyed to the BOOLEAN columns
 * that back them rather than to `status`.
 *
 * Lives here so the funnel's wording cannot drift from the vocabulary, and so
 * `lib/dataProvider.ts` needs no status literals of its own. Boolean-backed on
 * purpose: `status` is single-valued and mutable, so a lead who attended a demo
 * and then declined would silently leave the demo stage and the funnel would
 * appear to shrink from the middle.
 */
export const LEAD_FUNNEL_STAGES: readonly { key: "demo_booked" | "demo_attended" | "admitted"; label: string }[] = [
  { key: "demo_booked",   label: leadStatusLabelFor("Demo Booked") },
  { key: "demo_attended", label: leadStatusLabelFor("Demo Attended") },
  { key: "admitted",      label: leadStatusLabelFor("Admission Done") },
] as const;

/** Internal: label lookup that is total over `LeadStatus`, for use above. */
function leadStatusLabelFor(value: LeadStatus): string {
  const meta = LEAD_STATUS_META.find((m) => m.value === value);
  if (!meta) throw new Error(`leadStatus: "${value}" is not in LEAD_STATUS_META`);
  return meta.label;
}

// ============================================================================
// DERIVED BOOLEAN COLUMNS
// ============================================================================

/**
 * The boolean columns a given status implies.
 *
 * Before the consolidation these were derived ad hoc from status string
 * comparisons in three places (`app/admin/leads/page.tsx`, `lib/mockData.ts`),
 * which meant the `Admitted` -> `Admission Done` rename would have silently
 * stopped setting `admitted`. Deriving them here keeps the rename safe.
 *
 * Only ever turns flags ON. A lead who attended a demo and later declined is
 * still a lead who attended a demo, so moving to `Not Interested` must not
 * erase `demo_attended` — the caller merges with OR.
 */
export function leadStatusFlags(value: string | null | undefined): {
  demo_booked: boolean;
  demo_attended: boolean;
  admitted: boolean;
  webinar_registered: boolean;
} {
  const s = normalizeLeadStatus(value);
  const attended = s === "Demo Attended" || s === "Admission Done" || s === "Seat Booked";
  const webinar =
    s === "Webinar Registered" || s === "Seat Booked" || s === "Admission Done";
  return {
    demo_booked: attended || s === "Demo Booked",
    demo_attended: attended,
    admitted: s === "Admission Done",
    webinar_registered: webinar,
  };
}
