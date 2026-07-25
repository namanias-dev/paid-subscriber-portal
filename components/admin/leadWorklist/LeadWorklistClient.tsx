"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Users, X } from "lucide-react";
import { PageHeader } from "@/components/admin/ui";
import type { LeadWorklistRow, LeadsSortKey } from "@/lib/types";
import { BulkAssignModal } from "./BulkAssignModal";
import FilterBar from "./FilterBar";
import LeadDrawer from "./LeadDrawer";
import ScopeControl from "./ScopeControl";
import WorklistTable from "./WorklistTable";
import { useWorklistData } from "./useWorklistData";
import {
  LEAD_SCOPES,
  parseQuery,
  toApiSearch,
  toUrlSearch,
  type LeadScope,
  type WorklistQuery,
} from "./query";

/**
 * The lead worklist page.
 *
 * STATE LIVES IN THE URL. `useSearchParams` is the only source of truth for
 * scope, filters, sort and page size; every control writes back through
 * `router.replace`, so refresh, back/forward, and a link pasted into Slack all
 * reproduce the same screen. Nothing here holds a shadow copy that could drift.
 *
 * Selection and phone reveals are deliberately NOT in the URL: one is
 * ephemeral working state for Phase 3 bulk actions, and the other is a PII
 * disclosure that must not survive a page share or a reload.
 */
export default function LeadWorklistClient({
  currentAdmin,
  isSuperAdmin = false,
}: {
  currentAdmin: string | null;
  /** Renders the Phase 4 promotion control. The API enforces it independently. */
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlSearch = searchParams.toString();

  const query: WorklistQuery = useMemo(() => parseQuery(new URLSearchParams(urlSearch)), [urlSearch]);
  const apiSearch = useMemo(() => toApiSearch(query), [query]);

  const {
    rows,
    nextCursor,
    total,
    totalIsCapped,
    loading,
    loadingMore,
    error,
    loadMore,
    retry,
    patchRow,
  } = useWorklistData(apiSearch);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // A new result set invalidates both. Carrying a selection across a scope
  // change would let a Phase 3 bulk action target rows nobody can still see,
  // and carrying a reveal would leak a phone number into a view the user did
  // not unmask it in.
  useEffect(() => {
    setSelected(new Set());
    setRevealed(new Set());
  }, [apiSearch]);

  const setQuery = useCallback(
    (next: WorklistQuery) => {
      const qs = toUrlSearch(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const onScope = useCallback(
    (scope: LeadScope) => setQuery({ ...query, scope }),
    [query, setQuery],
  );

  const onSort = useCallback(
    (key: LeadsSortKey) => {
      if (query.sort === key) {
        setQuery({ ...query, dir: query.dir === "asc" ? "desc" : "asc" });
        return;
      }
      // Names read best A→Z; every date column reads best newest-first.
      setQuery({ ...query, sort: key, dir: key === "name" ? "asc" : "desc" });
    },
    [query, setQuery],
  );

  const toggleRow = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllLoaded = useCallback(() => {
    setSelected((prev) => {
      const allSelected = rows.length > 0 && rows.every((r) => prev.has(r.id));
      if (allSelected) return new Set();
      return new Set(rows.map((r) => r.id));
    });
  }, [rows]);

  const toggleReveal = useCallback((id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openLead = useCallback((row: LeadWorklistRow) => {
    const active = document.activeElement;
    restoreFocusRef.current = active instanceof HTMLElement ? active : null;
    setActiveId(row.id);
  }, []);

  const closeDrawer = useCallback(() => {
    const id = activeId;
    setActiveId(null);
    // Return focus to the row that opened the drawer. The row may have been
    // unmounted and remounted by the window in the meantime, so look it up by
    // id first and only fall back to the captured element.
    requestAnimationFrame(() => {
      const byId = id
        ? document.querySelector<HTMLElement>(`[data-worklist-row="${CSS.escape(id)}"]`)
        : null;
      (byId ?? restoreFocusRef.current)?.focus();
    });
  }, [activeId]);

  const activeRow = useMemo(
    () => (activeId ? rows.find((r) => r.id === activeId) ?? null : null),
    [activeId, rows],
  );

  // The drawer's row can vanish from the list (a filter now excludes it after
  // an edit). Closing is the honest response — showing a detail panel for a
  // row that is no longer in the result set is a screen that lies about scope.
  useEffect(() => {
    if (activeId && !loading && rows.length > 0 && !rows.some((r) => r.id === activeId)) {
      setActiveId(null);
    }
  }, [activeId, rows, loading]);

  const scopeLabel = LEAD_SCOPES.find((s) => s.value === query.scope)?.label ?? query.scope;

  return (
    <div>
      <PageHeader
        title="Lead Worklist"
        subtitle="Server-side worklist across live captures and the re-engagement (legacy) import. Scope is always explicit."
      />

      <div className="mb-4">
        <ScopeControl value={query.scope} onChange={onScope} />
      </div>

      <div className="mb-4">
        <FilterBar
          query={query}
          onChange={setQuery}
          currentAdmin={currentAdmin}
          loading={loading}
        />
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--primary)] bg-[var(--primary-tint)] px-4 py-2.5">
          <p className="text-sm font-semibold text-primary">
            {selected.size.toLocaleString("en-IN")} selected
            <span className="ml-2 font-normal text-ink2">
              Assignment is the only bulk action — status, notes and contact history are never changed in bulk.
            </span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Users size={12} strokeWidth={2} aria-hidden="true" />
              Assign…
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <X size={12} strokeWidth={2} aria-hidden="true" />
              Clear selection
            </button>
          </div>
        </div>
      )}

      <WorklistTable
        rows={rows}
        loading={loading}
        loadingMore={loadingMore}
        error={error}
        total={total}
        totalIsCapped={totalIsCapped}
        nextCursor={nextCursor}
        scopeLabel={scopeLabel}
        sort={query.sort}
        dir={query.dir}
        onSort={onSort}
        onLoadMore={loadMore}
        onRetry={retry}
        selected={selected}
        onToggleRow={toggleRow}
        onToggleAllLoaded={toggleAllLoaded}
        revealed={revealed}
        onToggleReveal={toggleReveal}
        onOpen={openLead}
        activeId={activeId}
        resetToken={apiSearch}
      />

      <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted">
        Counts on this page describe the <span className="font-semibold">{scopeLabel}</span> scope
        only. Legacy leads are excluded from live-capture analytics, Payments, dashboards and every
        SMS audience — this worklist is the one place they are visible.
      </p>

      {activeRow && (
        <LeadDrawer
          key={activeRow.id}
          lead={activeRow}
          currentAdmin={currentAdmin}
          isSuperAdmin={isSuperAdmin}
          onClose={closeDrawer}
          onRowPatch={patchRow}
        />
      )}

      <BulkAssignModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        leadIds={[...selected]}
        scope={query.scope}
        onCommitted={() => {
          // Drop the selection and re-read. The rows on screen now carry a
          // stale owner, and leaving them selected invites a second bulk
          // action against a list the operator can no longer see accurately.
          setSelected(new Set());
          retry();
        }}
      />
    </div>
  );
}
