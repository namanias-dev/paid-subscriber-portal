import { LEADS_SORT_KEYS, type LeadsSortDir, type LeadsSortKey } from "@/lib/types";

/**
 * The worklist's URL contract.
 *
 * Every filter, the scope, the sort and the page size live in the query string
 * and NOWHERE else, so a view is shareable, bookmarkable and survives a reload.
 * The component tree reads its state back out of the URL rather than keeping a
 * parallel copy — there is exactly one source of truth.
 *
 * The parameter names here are the SAME names `GET /api/admin/leads/worklist`
 * accepts, so building the request is a copy, not a translation. `cursor` and
 * `count` are deliberately absent: they are pagination mechanics, not view
 * state, and putting a keyset cursor in a shared link would hand someone a
 * page 7 that no longer exists.
 */

/** `scope=live` is the default so nobody's screen suddenly holds 178,183 rows. */
export type LeadScope = "live" | "legacy" | "all";

export const LEAD_SCOPES: { value: LeadScope; label: string; hint: string }[] = [
  {
    value: "live",
    label: "Live captured",
    hint: "Leads captured by the public site. The CRM's historical default.",
  },
  {
    value: "legacy",
    label: "Re-engagement (legacy)",
    hint: "Imported from the team's Google Sheet. Consent is unknown for all of them.",
  },
  { value: "all", label: "All", hint: "Live captures and legacy imports together." },
];

/**
 * Mirrors `MIN_SEARCH_CHARS` in the API route. Enforced here too so the user
 * gets an inline hint instead of a raw 400 they cannot act on.
 */
export const MIN_SEARCH_CHARS = 3;

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const DEFAULT_PAGE_SIZE: PageSize = 50;

export interface WorklistQuery {
  scope: LeadScope;
  limit: PageSize;
  sort: LeadsSortKey;
  dir: LeadsSortDir;
  search: string;
  status: string;
  source_tag: string;
  assigned_to: string;
  consent_status: string;
  work_status: string;
  assigned_mode: string;
  contacted: string;
  created_from: string;
  created_to: string;
}

export const DEFAULT_QUERY: WorklistQuery = {
  scope: "live",
  limit: DEFAULT_PAGE_SIZE,
  sort: "created_at",
  dir: "desc",
  search: "",
  status: "",
  source_tag: "",
  assigned_to: "",
  consent_status: "",
  work_status: "",
  assigned_mode: "",
  contacted: "",
  created_from: "",
  created_to: "",
};

/** The free-text keys, i.e. everything that is just passed through verbatim. */
const TEXT_KEYS = [
  "search",
  "status",
  "source_tag",
  "assigned_to",
  "consent_status",
  "work_status",
  "assigned_mode",
  "contacted",
  "created_from",
  "created_to",
] as const;

function isScope(v: string | null): v is LeadScope {
  return v === "live" || v === "legacy" || v === "all";
}

function isPageSize(v: number): v is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(v);
}

/** Read a `WorklistQuery` out of the URL, falling back to the defaults. */
export function parseQuery(params: URLSearchParams): WorklistQuery {
  const out: WorklistQuery = { ...DEFAULT_QUERY };

  const scope = params.get("scope");
  if (isScope(scope)) out.scope = scope;

  const limit = Number(params.get("limit"));
  if (Number.isFinite(limit) && isPageSize(limit)) out.limit = limit;

  const sort = params.get("sort");
  if (sort && (LEADS_SORT_KEYS as readonly string[]).includes(sort)) out.sort = sort as LeadsSortKey;

  const dir = params.get("dir");
  if (dir === "asc" || dir === "desc") out.dir = dir;

  for (const key of TEXT_KEYS) out[key] = (params.get(key) ?? "").trim();

  return out;
}

/**
 * Serialise for the ADDRESS BAR. Defaults are omitted so the common case is a
 * short, readable link rather than fourteen redundant parameters.
 */
export function toUrlSearch(q: WorklistQuery): string {
  const p = new URLSearchParams();
  if (q.scope !== DEFAULT_QUERY.scope) p.set("scope", q.scope);
  if (q.limit !== DEFAULT_QUERY.limit) p.set("limit", String(q.limit));
  if (q.sort !== DEFAULT_QUERY.sort) p.set("sort", q.sort);
  if (q.dir !== DEFAULT_QUERY.dir) p.set("dir", q.dir);
  for (const key of TEXT_KEYS) {
    const v = q[key];
    if (v) p.set(key, v);
  }
  return p.toString();
}

/** True when the typed needle is long enough for the server to accept it. */
export function searchIsUsable(search: string): boolean {
  return search.trim().length >= MIN_SEARCH_CHARS;
}

/**
 * Serialise for the API. Unlike the URL form this is explicit about every
 * value, and it DROPS a too-short search rather than sending one: the server
 * would answer 400, and a 400 the user cannot fix from the error text is just
 * a broken screen.
 */
export function toApiSearch(q: WorklistQuery): string {
  const p = new URLSearchParams();
  p.set("scope", q.scope);
  p.set("limit", String(q.limit));
  p.set("sort", q.sort);
  p.set("dir", q.dir);
  for (const key of TEXT_KEYS) {
    const v = q[key];
    if (!v) continue;
    if (key === "search" && !searchIsUsable(v)) continue;
    p.set(key, key === "search" ? v.trim() : v);
  }
  return p.toString();
}

/** True when any filter beyond scope/sort/page-size is applied. */
export function hasActiveFilters(q: WorklistQuery): boolean {
  return TEXT_KEYS.some((k) => q[k] !== DEFAULT_QUERY[k]);
}

/** Reset every filter but keep the scope the user is looking at. */
export function clearedFilters(q: WorklistQuery): WorklistQuery {
  return { ...DEFAULT_QUERY, scope: q.scope, limit: q.limit };
}

// =====================================================================
// Saved segments
// =====================================================================

export interface Segment {
  id: string;
  label: string;
  hint: string;
  /** The exact parameter values this segment stands for. */
  patch: Partial<WorklistQuery>;
  /** Set when the segment cannot be offered, e.g. no signed-in identity. */
  disabledReason?: string;
}

/**
 * One-click presets. Each is a pure parameter patch, so a segment is just a
 * shortcut to a URL a user could have built by hand — never a hidden filter
 * the table applies behind their back.
 */
export function segmentsFor(currentAdmin: string | null): Segment[] {
  return [
    {
      id: "my-queue",
      label: "My Queue",
      hint: currentAdmin
        ? `Leads assigned to ${currentAdmin}.`
        : "Unavailable — no signed-in admin identity was resolved for this page.",
      patch: { assigned_to: currentAdmin ?? "" },
      disabledReason: currentAdmin
        ? undefined
        : "We could not resolve who you are signed in as, so we will not guess whose queue to show.",
    },
    {
      id: "unassigned",
      label: "Unassigned",
      hint: "No counsellor owns these yet. True for 100% of legacy leads today.",
      patch: { assigned_mode: "unassigned" },
    },
    {
      id: "never-contacted",
      label: "Never contacted",
      hint: "No recorded contact attempt on the lead.",
      patch: { contacted: "no" },
    },
    {
      id: "follow-ups-due",
      label: "Follow-ups due",
      hint: "Sorted by follow-up date, soonest first.",
      patch: { sort: "follow_up_at", dir: "asc" },
    },
    {
      id: "needs-consent",
      label: "Needs consent",
      hint: "consent_status = unknown. These leads cannot be messaged.",
      patch: { consent_status: "unknown" },
    },
  ];
}

/** A segment is active when every value in its patch is currently applied. */
export function segmentIsActive(q: WorklistQuery, segment: Segment): boolean {
  const entries = Object.entries(segment.patch) as [keyof WorklistQuery, string][];
  if (entries.length === 0) return false;
  return entries.every(([key, value]) => String(q[key]) === String(value) && value !== "");
}

/** Toggle a segment on or off, leaving every other parameter alone. */
export function applySegment(q: WorklistQuery, segment: Segment): WorklistQuery {
  if (segmentIsActive(q, segment)) {
    const next: Record<string, unknown> = { ...q };
    for (const key of Object.keys(segment.patch)) next[key] = DEFAULT_QUERY[key as keyof WorklistQuery];
    return next as unknown as WorklistQuery;
  }
  return { ...q, ...segment.patch };
}
