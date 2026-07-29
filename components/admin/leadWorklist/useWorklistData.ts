"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LeadWorklistRow } from "@/lib/types";
import type { LegacyLeadMatch } from "@/lib/marketing/legacyLeadMatch";

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
  legacyLeadByPhone?: Record<string, LegacyLeadMatch>;
}

export interface WorklistData {
  rows: LeadWorklistRow[];
  nextCursor: string | null;
  total: number | null;
  totalIsCapped: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  legacyLeadByPhone: Record<string, LegacyLeadMatch>;
  loadMore: () => void;
  retry: () => void;
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
  const [legacyLeadByPhone, setLegacyLeadByPhone] = useState<Record<string, LegacyLeadMatch>>({});

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
        params.set("count", "0");
        setLoadingMore(true);
      } else {
        setRows(EMPTY);
        setNextCursor(null);
        setTotal(null);
        setTotalIsCapped(false);
        setLegacyLeadByPhone({});
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
        if (data.legacyLeadByPhone) {
          setLegacyLeadByPhone((prev) =>
            cursor ? { ...prev, ...data.legacyLeadByPhone } : (data.legacyLeadByPhone || {}),
          );
        }
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
    legacyLeadByPhone,
    loadMore,
    retry,
    patchRow,
  };
}
