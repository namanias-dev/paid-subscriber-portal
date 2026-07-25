"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import type { LeadWorklistRow, LeadsSortDir, LeadsSortKey } from "@/lib/types";
import {
  AssigneeCell,
  CampaignCell,
  ConsentBadge,
  DateCell,
  LegacyCallStatus,
  LegacyChip,
  MaskedPhone,
  SourceTag,
  StatusPill,
  formatTotal,
} from "./cells";
import { useWindowedRows } from "./useWindowedRows";

/**
 * The dense, windowed, server-paginated worklist table.
 *
 * Real table semantics (`<table>`/`<th scope="col">`/`aria-sort`) rather than a
 * grid of divs, because a counsellor on a screen reader needs to hear "column
 * 6, call status from sheet" and not "generic, generic, generic". The window's
 * spacer rows are `aria-hidden`, and `aria-rowcount` / `aria-rowindex` carry
 * the real position so the assistive tree describes the whole list rather than
 * the forty rows that happen to be mounted.
 */

/**
 * Fixed row height, in px. The window arithmetic depends on it exactly, so
 * every cell is single-line and clipped rather than allowed to wrap.
 */
export const ROW_HEIGHT = 44;

/** Saffron left accent that marks a legacy row. Subtle, not a warning colour. */
const LEGACY_ACCENT = "#FF9933";

interface Column {
  key: string;
  label: string;
  width: number;
  sortKey?: LeadsSortKey;
  /** Native tooltip on the header, for columns whose meaning is not obvious. */
  hint?: string;
}

const COLUMNS: Column[] = [
  { key: "select", label: "", width: 44 },
  { key: "name", label: "Name", width: 200, sortKey: "name" },
  { key: "phone", label: "Phone", width: 158, hint: "Masked by default. Reveal one row at a time." },
  { key: "source", label: "Source tag", width: 150, hint: "legacy_source_tab, falling back to source." },
  { key: "status", label: "Status", width: 130, hint: "The frozen pipeline status. History — not editable here." },
  {
    key: "legacy_call_status_raw",
    label: "Call status (from sheet)",
    width: 180,
    hint: "The team's own wording, preserved verbatim from the source sheet. Never re-mapped.",
  },
  { key: "campaign_clean", label: "Campaign", width: 190 },
  {
    key: "imported",
    label: "Imported",
    width: 122,
    sortKey: "created_at",
    hint: "first_seen_at where present, else created_at. Sorting uses created_at.",
  },
  { key: "assigned_to", label: "Counsellor", width: 150 },
  { key: "follow_up_at", label: "Follow-up", width: 122, sortKey: "follow_up_at" },
  { key: "consent_status", label: "Consent", width: 112 },
  { key: "last_contacted_at", label: "Last contacted", width: 132, sortKey: "last_contacted_at" },
];

const TABLE_MIN_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0);
const COL_COUNT = COLUMNS.length;

export interface WorklistTableProps {
  rows: LeadWorklistRow[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  total: number | null;
  totalIsCapped: boolean;
  nextCursor: string | null;
  scopeLabel: string;
  sort: LeadsSortKey;
  dir: LeadsSortDir;
  onSort: (key: LeadsSortKey) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  selected: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAllLoaded: () => void;
  revealed: Set<string>;
  onToggleReveal: (id: string) => void;
  onOpen: (row: LeadWorklistRow) => void;
  activeId: string | null;
  /** Bumped by the parent whenever the query changes, to reset the scroll. */
  resetToken: string;
}

export default function WorklistTable(props: WorklistTableProps) {
  const {
    rows,
    loading,
    loadingMore,
    error,
    total,
    totalIsCapped,
    nextCursor,
    scopeLabel,
    sort,
    dir,
    onSort,
    onLoadMore,
    onRetry,
    selected,
    onToggleRow,
    onToggleAllLoaded,
    revealed,
    onToggleReveal,
    onOpen,
    activeId,
    resetToken,
  } = props;

  const { scrollRef, onScroll, startIndex, endIndex, padTop, padBottom, scrollToTop } =
    useWindowedRows({ count: rows.length, rowHeight: ROW_HEIGHT });

  // A new query means a new list; keeping the old scroll offset would land the
  // user in the middle of rows they never asked for.
  useEffect(() => {
    scrollToTop();
  }, [resetToken, scrollToTop]);

  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const allLoadedSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someLoadedSelected = rows.some((r) => selected.has(r.id));
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someLoadedSelected && !allLoadedSelected;
    }
  }, [someLoadedSelected, allLoadedSelected]);

  const windowed = useMemo(() => rows.slice(startIndex, endIndex), [rows, startIndex, endIndex]);

  const totalLabel = formatTotal(total, totalIsCapped);
  const fatal = !!error && rows.length === 0;

  return (
    <div className="card overflow-hidden p-0">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="overflow-auto"
        style={{ maxHeight: "calc(100vh - 22rem)", minHeight: 320 }}
      >
        <table
          className="w-full border-separate border-spacing-0 text-left"
          style={{ minWidth: TABLE_MIN_WIDTH }}
          aria-label={`Lead worklist — ${scopeLabel}`}
          aria-rowcount={total ?? rows.length}
          aria-busy={loading}
        >
          <colgroup>
            {COLUMNS.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr aria-rowindex={1}>
              <th
                scope="col"
                className="whitespace-nowrap border-b border-line bg-surface2 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted"
              >
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--primary)]"
                  checked={allLoadedSelected}
                  disabled={rows.length === 0}
                  onChange={onToggleAllLoaded}
                  aria-label="Select every lead loaded on this page"
                  title="Selects the rows currently loaded, not the whole result set."
                />
              </th>
              {COLUMNS.slice(1).map((col) => {
                const active = col.sortKey && col.sortKey === sort;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    title={col.hint}
                    aria-sort={
                      active ? (dir === "asc" ? "ascending" : "descending") : col.sortKey ? "none" : undefined
                    }
                    className="whitespace-nowrap border-b border-line bg-surface2 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted"
                  >
                    {col.sortKey ? (
                      <button
                        type="button"
                        onClick={() => onSort(col.sortKey as LeadsSortKey)}
                        className="inline-flex items-center gap-1 rounded transition hover:text-ink focus:outline-none focus:ring-2 focus:ring-primary/40"
                        style={{ color: active ? "var(--primary)" : undefined }}
                      >
                        {col.label}
                        {active &&
                          (dir === "asc" ? (
                            <ArrowUp size={12} strokeWidth={2.25} aria-hidden="true" />
                          ) : (
                            <ArrowDown size={12} strokeWidth={2.25} aria-hidden="true" />
                          ))}
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {loading && <SkeletonRows />}

            {!loading && fatal && (
              <tr>
                <td colSpan={COL_COUNT} className="px-4 py-12">
                  <ErrorPanel message={error as string} onRetry={onRetry} />
                </td>
              </tr>
            )}

            {!loading && !fatal && rows.length === 0 && (
              <tr>
                <td colSpan={COL_COUNT} className="px-4 py-16">
                  <div className="mx-auto max-w-md text-center">
                    <p className="font-heading text-base font-bold text-ink">
                      No leads match these filters
                    </p>
                    <p className="mt-1 text-sm text-ink2">
                      The request succeeded and returned zero rows in{" "}
                      <span className="font-semibold">{scopeLabel}</span>. Widen the scope or clear a
                      filter.
                    </p>
                  </div>
                </td>
              </tr>
            )}

            {!loading && !fatal && rows.length > 0 && (
              <>
                {padTop > 0 && (
                  <tr aria-hidden="true" style={{ height: padTop }}>
                    <td colSpan={COL_COUNT} className="p-0" />
                  </tr>
                )}
                {windowed.map((row, i) => (
                  <Row
                    key={row.id}
                    row={row}
                    rowIndex={startIndex + i}
                    selected={selected.has(row.id)}
                    revealed={revealed.has(row.id)}
                    active={activeId === row.id}
                    onToggleRow={onToggleRow}
                    onToggleReveal={onToggleReveal}
                    onOpen={onOpen}
                  />
                ))}
                {padBottom > 0 && (
                  <tr aria-hidden="true" style={{ height: padBottom }}>
                    <td colSpan={COL_COUNT} className="p-0" />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer: honest counts, cursor pagination, and a non-fatal error strip. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface2 px-4 py-3">
        <p className="text-xs text-ink2">
          {loading ? (
            "Loading…"
          ) : (
            <>
              <span className="font-semibold tabular-nums text-ink">
                {rows.length.toLocaleString("en-IN")}
              </span>{" "}
              loaded
              {totalLabel !== null && (
                <>
                  {" "}
                  of{" "}
                  <span
                    className="font-semibold tabular-nums text-ink"
                    title={
                      totalIsCapped
                        ? "The exact total was not computed. Counting a free-text match exactly is expensive, so the server stops at a bound and reports a floor."
                        : undefined
                    }
                  >
                    {totalLabel}
                  </span>
                </>
              )}{" "}
              <span className="text-muted">· {scopeLabel}</span>
            </>
          )}
        </p>

        <div className="flex items-center gap-3">
          {error && rows.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-danger">
              <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />
              {error}
            </span>
          )}
          {nextCursor ? (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="btn btn-secondary gap-1.5 py-1.5 text-sm"
            >
              {loadingMore && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          ) : (
            !loading &&
            rows.length > 0 && <span className="text-xs text-muted">End of results.</span>
          )}
          {error && rows.length > 0 && (
            <button type="button" onClick={onRetry} className="btn btn-secondary py-1.5 text-sm">
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================================

const Row = memo(function Row({
  row,
  rowIndex,
  selected,
  revealed,
  active,
  onToggleRow,
  onToggleReveal,
  onOpen,
}: {
  row: LeadWorklistRow;
  rowIndex: number;
  selected: boolean;
  revealed: boolean;
  active: boolean;
  onToggleRow: (id: string) => void;
  onToggleReveal: (id: string) => void;
  onOpen: (row: LeadWorklistRow) => void;
}) {
  const cell = "border-b border-line px-3 align-middle";
  return (
    <tr
      aria-rowindex={rowIndex + 2}
      style={{ height: ROW_HEIGHT }}
      onClick={() => onOpen(row)}
      className={`cursor-pointer transition-colors ${
        active ? "bg-[var(--primary-tint)]" : selected ? "bg-surface2" : "hover:bg-surface2"
      }`}
    >
      <td
        className={`${cell} py-0`}
        style={{
          borderLeft: `3px solid ${row.is_legacy ? LEGACY_ACCENT : "transparent"}`,
        }}
      >
        <input
          type="checkbox"
          className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--primary)]"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleRow(row.id)}
          aria-label={`Select ${row.name || "unnamed lead"}`}
        />
      </td>

      <td className={`${cell} py-0`}>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            data-worklist-row={row.id}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(row);
            }}
            className="min-w-0 truncate text-left text-[13px] font-semibold text-ink transition hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
            title={row.name || "—"}
          >
            {row.name?.trim() || <span className="font-normal text-muted">Unnamed</span>}
          </button>
          {row.is_legacy && <LegacyChip />}
        </span>
      </td>

      <td className={`${cell} py-0`}>
        <MaskedPhone phone={row.phone} revealed={revealed} onToggle={() => onToggleReveal(row.id)} />
      </td>

      <td className={`${cell} py-0`}>
        <span className="flex min-w-0 items-center gap-1">
          <SourceTag
            legacySourceTab={row.legacy_source_tab}
            source={row.source}
            isLegacy={row.is_legacy}
          />
        </span>
      </td>

      <td className={`${cell} py-0`}>
        <StatusPill status={row.status} />
      </td>

      <td className={`${cell} py-0`}>
        <LegacyCallStatus value={row.legacy_call_status_raw} />
      </td>

      <td className={`${cell} py-0`}>
        <CampaignCell
          value={row.campaign_clean}
          campaign={row.campaign}
          isLegacy={row.is_legacy}
        />
      </td>

      <td className={`${cell} py-0`}>
        <DateCell value={row.first_seen_at || row.created_at} />
      </td>

      <td className={`${cell} py-0`}>
        <AssigneeCell value={row.assigned_to} />
      </td>

      <td className={`${cell} py-0`}>
        <DateCell value={row.follow_up_at} />
      </td>

      <td className={`${cell} py-0`}>
        <ConsentBadge value={row.consent_status} />
      </td>

      <td className={`${cell} py-0`}>
        {row.last_contacted_at ? <DateCell value={row.last_contacted_at} /> : <NeverContacted />}
      </td>
    </tr>
  );
});

function NeverContacted() {
  return (
    <span className="text-[12px] text-muted" title="No contact attempt has ever been recorded.">
      Never
    </span>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 12 }).map((_, i) => (
        <tr key={i} style={{ height: ROW_HEIGHT }} aria-hidden="true">
          {COLUMNS.map((col) => (
            <td key={col.key} className="border-b border-line px-3 py-0">
              <div className="skeleton h-3 w-full animate-shimmer" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-lg text-center">
      <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#fdeaea] text-danger">
        <AlertTriangle size={18} strokeWidth={2} aria-hidden="true" />
      </div>
      <p className="font-heading text-base font-bold text-ink">The worklist could not be loaded</p>
      {/* The API's own message, verbatim — not a generic "something went wrong". */}
      <p className="mx-auto mt-1 max-w-md text-sm text-ink2">{message}</p>
      <p className="mt-2 text-xs text-muted">
        No rows are shown because none were returned. This is a failure, not an empty result.
      </p>
      <button type="button" onClick={onRetry} className="btn btn-primary mt-4 text-sm">
        Retry
      </button>
    </div>
  );
}
