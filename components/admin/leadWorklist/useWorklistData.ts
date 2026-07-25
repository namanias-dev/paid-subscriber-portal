"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LeadWorklistRow } from "@/lib/types";

/**
 * The reader for `GET /api/admin/leads/worklist`.
 *
 * EVERYTHING IS SERVER-SIDE. This hook never filters, sorts, searches or
 * paginates in JS — it forwards the query string the URL already describes and
 * renders whatever comes back. There is no "fetch all then filter" path, which
 * matters when the widest scope is 179,170 rows.
 *
 * Failure is never disguised as emptiness. A rejected request populates
 * `error` with the API's own message and leaves `rows` untouched, so the table
 * can show a retryable error instead of a clean, confident, wrong "no results".
 */

interface WorklistResponse {
  ok: boolean;
  error?: string;
  scope?: string;
  rows?: LeadWorklistRow[];
  nextCursor?: string | null;
  total?: number | null;
  totalIsCapped?: boolean;
}

export interface WorklistData {
  rows: LeadWorklistRow[];
  nextCursor: string | null;
  /**
   * Match count, or null when the server did not compute one. Read together
   * with `totalIsCapped` — never rendered as an exact figure when capped.
   */
  total: number | null;
  /** True when `total` is a floor ("5,000+"), not an exact count. */
  totalIsCapped: boolean;
  /** First page in flight: the query changed, so the old rows are gone. */
  loading: boolean;
  /** A later page is in flight; the rows already on screen stay put. */
  loadingMore: boolean;
  error: string | null;
  loadMore: () => void;
  retry: () => void;
  /** Apply a mutation's result to one loaded row without refetching the list. */
  patchRow: (id: string, patch: Partial<LeadWorklistRow>) => void;
}

const EMPTY: LeadWorklistRow[] = [];

export function useWorklistData(apiSearch: string): WorklistData {
  const [rows, setRows] = useState<LeadWorklistRow[]>(EMPTY);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [totalIsCapped, setTotalIsCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic request id. A response from a superseded query is dropped rather
  // than merged, so a slow "live" page can never land on top of "legacy".
  const requestRef = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const requestId = ++requestRef.current;

      const params = new URLSearchParams(apiSearch);
      if (cursor) {
        params.set("cursor", cursor);
        // The total was already counted for this query on the first page;
        // recounting on every load-more doubles the cost for no new answer.
        params.set("count", "0");
        setLoadingMore(true);
      } else {
        setRows(EMPTY);
        setNextCursor(null);
        setTotal(null);
        setTotalIsCapped(false);
        setLoading(true);
      }
      setError(null);

      try {
        const res = await fetch(`/api/admin/leads/worklist?${params.toString()}`);
        const data = (await res.json().catch(() => null)) as WorklistResponse | null;
        if (requestRef.current !== requestId) return;

        if (!res.ok || !data?.ok) {
          setError(data?.error || `The worklist request failed (HTTP ${res.status}).`);
          return;
        }

        const page = data.rows ?? [];
        setRows((prev) => (cursor ? [...prev, ...page] : page));
        setNextCursor(data.nextCursor ?? null);
        cursorRef.current = data.nextCursor ?? null;
        if (!cursor) {
          setTotal(data.total ?? null);
          setTotalIsCapped(!!data.totalIsCapped);
        }
      } catch (e) {
        if (requestRef.current !== requestId) return;
        setError(e instanceof Error ? e.message : "The worklist request failed.");
      } finally {
        if (requestRef.current === requestId) {
          setLoading(false);
          setLoadingMore(false);
        }
        inFlightRef.current = false;
      }
    },
    [apiSearch],
  );

  useEffect(() => {
    cursorRef.current = null;
    // A query change invalidates any page in flight; clearing the guard lets
    // the new first page start immediately instead of being swallowed.
    inFlightRef.current = false;
    void fetchPage(null);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (cursorRef.current) void fetchPage(cursorRef.current);
  }, [fetchPage]);

  const retry = useCallback(() => {
    inFlightRef.current = false;
    void fetchPage(rows.length > 0 ? cursorRef.current : null);
  }, [fetchPage, rows.length]);

  const patchRow = useCallback((id: string, patch: Partial<LeadWorklistRow>) => {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.id === id);
      if (i === -1) return prev;
      const next = prev.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }, []);

  return {
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
  };
}
