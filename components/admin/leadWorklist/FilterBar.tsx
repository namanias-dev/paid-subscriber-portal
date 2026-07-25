"use client";

import { useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { LEAD_WORK_STATUSES } from "@/lib/types";
import {
  MIN_SEARCH_CHARS,
  PAGE_SIZES,
  applySegment,
  hasActiveFilters,
  clearedFilters,
  segmentIsActive,
  segmentsFor,
  type PageSize,
  type WorklistQuery,
} from "./query";

/** How long the user has to stop typing before a request is issued. */
const SEARCH_DEBOUNCE_MS = 300;

const CONSENT_OPTIONS = ["unknown", "implied", "explicit", "withdrawn", "opted_out"];

/**
 * Search, saved segments, page size and the secondary filters.
 *
 * EVERY control here writes a URL parameter that the API understands directly.
 * Nothing in this file narrows a result set locally — the widest scope holds
 * 179,170 rows and only Postgres is allowed to filter them.
 */
export default function FilterBar({
  query,
  onChange,
  currentAdmin,
  loading,
}: {
  query: WorklistQuery;
  onChange: (next: WorklistQuery) => void;
  currentAdmin: string | null;
  loading: boolean;
}) {
  const [showMore, setShowMore] = useState(false);
  const segments = segmentsFor(currentAdmin);

  // Local mirror of the search box so typing stays responsive while the URL
  // (and therefore the request) only moves once the user pauses.
  const [draft, setDraft] = useState(query.search);
  const committedRef = useRef(query.search);
  useEffect(() => {
    // Re-sync when the search changes from outside — a cleared filter, a
    // segment click, or the back button.
    if (query.search !== committedRef.current) {
      committedRef.current = query.search;
      setDraft(query.search);
    }
  }, [query.search]);

  useEffect(() => {
    if (draft === committedRef.current) return;
    const t = setTimeout(() => {
      committedRef.current = draft;
      onChange({ ...query, search: draft });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, query, onChange]);

  const typed = draft.trim();
  const searchTooShort = typed.length > 0 && typed.length < MIN_SEARCH_CHARS;
  const filtersApplied = hasActiveFilters(query);

  function set<K extends keyof WorklistQuery>(key: K, value: WorklistQuery[K]) {
    onChange({ ...query, [key]: value });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[240px] flex-1">
          <div className="relative">
            <Search
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              className="input pl-9 text-sm"
              placeholder="Search name or phone…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Search leads by name or phone"
              aria-describedby="worklist-search-hint"
              aria-invalid={searchTooShort}
            />
          </div>
          <p
            id="worklist-search-hint"
            className={`mt-1 text-xs ${searchTooShort ? "text-[#b45309]" : "text-muted"}`}
          >
            {searchTooShort
              ? `Keep typing — search needs at least ${MIN_SEARCH_CHARS} characters, so this one is not applied yet.`
              : "Searches the whole scope on the server, not just the rows on screen."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="whitespace-nowrap text-xs text-muted" htmlFor="worklist-page-size">
            Rows per page
          </label>
          <select
            id="worklist-page-size"
            className="input max-w-[88px] py-1.5 text-sm"
            value={query.limit}
            onChange={(e) => set("limit", Number(e.target.value) as PageSize)}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          className="btn btn-secondary gap-1.5 py-2 text-sm"
        >
          <SlidersHorizontal size={15} strokeWidth={1.75} aria-hidden="true" />
          Filters
          {filtersApplied && <span className="pill pill-blue px-1.5 py-0 text-[10px]">on</span>}
        </button>
      </div>

      {/* Saved segments — one-click shortcuts to a URL you could type by hand. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-xs font-semibold uppercase tracking-wide text-muted">
          Segments
        </span>
        {segments.map((segment) => {
          const active = segmentIsActive(query, segment);
          const disabled = !!segment.disabledReason;
          return (
            <button
              key={segment.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              title={segment.disabledReason || segment.hint}
              onClick={() => onChange(applySegment(query, segment))}
              className="rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
              style={{
                borderColor: active ? "var(--primary)" : "var(--line)",
                background: active ? "var(--primary-tint)" : "#fff",
                color: active ? "var(--primary)" : "var(--ink2)",
              }}
            >
              {segment.label}
            </button>
          );
        })}
        {filtersApplied && (
          <button
            type="button"
            onClick={() => onChange(clearedFilters(query))}
            className="ml-1 inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs font-medium text-ink2 transition hover:border-line-strong hover:text-ink focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <X size={12} strokeWidth={2} aria-hidden="true" />
            Clear filters
          </button>
        )}
        {loading && <span className="ml-1 text-xs text-muted">Loading…</span>}
      </div>

      {showMore && (
        <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Work status"
            htmlFor="f-work-status"
            hint="The counsellor's working state — never the pipeline status."
          >
            <select
              id="f-work-status"
              className="input py-1.5 text-sm"
              value={query.work_status}
              onChange={(e) => set("work_status", e.target.value)}
            >
              <option value="">Any</option>
              {LEAD_WORK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Consent" htmlFor="f-consent" hint="unknown for 100% of legacy leads.">
            <select
              id="f-consent"
              className="input py-1.5 text-sm"
              value={query.consent_status}
              onChange={(e) => set("consent_status", e.target.value)}
            >
              <option value="">Any</option>
              {CONSENT_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Assignment" htmlFor="f-assigned-mode">
            <select
              id="f-assigned-mode"
              className="input py-1.5 text-sm"
              value={query.assigned_mode}
              onChange={(e) => set("assigned_mode", e.target.value)}
            >
              <option value="">Any</option>
              <option value="assigned">Assigned</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </Field>

          <Field label="Contacted" htmlFor="f-contacted">
            <select
              id="f-contacted"
              className="input py-1.5 text-sm"
              value={query.contacted}
              onChange={(e) => set("contacted", e.target.value)}
            >
              <option value="">Any</option>
              <option value="yes">Contacted at least once</option>
              <option value="no">Never contacted</option>
            </select>
          </Field>

          <Field label="Assigned to" htmlFor="f-assigned-to" hint="Exact counsellor name.">
            <input
              id="f-assigned-to"
              className="input py-1.5 text-sm"
              value={query.assigned_to}
              placeholder="Any"
              onChange={(e) => set("assigned_to", e.target.value)}
            />
          </Field>

          <Field label="Source tag" htmlFor="f-source-tag" hint="Exact legacy_source_tab, e.g. FB LEADS.">
            <input
              id="f-source-tag"
              className="input py-1.5 text-sm"
              value={query.source_tag}
              placeholder="Any"
              onChange={(e) => set("source_tag", e.target.value)}
            />
          </Field>

          <Field label="Status" htmlFor="f-status" hint="Exact pipeline status, e.g. New or Not Replied.">
            <input
              id="f-status"
              className="input py-1.5 text-sm"
              value={query.status}
              placeholder="Any"
              onChange={(e) => set("status", e.target.value)}
            />
          </Field>

          <Field label="Created between" hint="Filters created_at, not the imported date.">
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                className="input py-1.5 text-sm"
                value={query.created_from}
                aria-label="Created from"
                onChange={(e) => set("created_from", e.target.value)}
              />
              <span className="text-xs text-muted">to</span>
              <input
                type="date"
                className="input py-1.5 text-sm"
                value={query.created_to}
                aria-label="Created to"
                onChange={(e) => set("created_to", e.target.value)}
              />
            </div>
          </Field>
        </div>
      )}
    </div>
  );
}

/**
 * One labelled filter control. `htmlFor` is omitted for the date range, whose
 * two inputs carry their own `aria-label` — a single `<label>` can only ever
 * point at one of them, and a label that points at the wrong input is worse
 * than no label at all.
 */
function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      {htmlFor ? (
        <label
          htmlFor={htmlFor}
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted"
        >
          {label}
        </label>
      ) : (
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </span>
      )}
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-tight text-muted">{hint}</span>}
    </div>
  );
}
