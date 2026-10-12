"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";

type Filter = "needs_attention" | "awaiting_reply" | "open" | "exceptions";

interface SupportIssue {
  id: string;
  reference: string;
  order_id: string;
  order_no: string;
  category_label: string;
  description: string;
  latest_customer_message: string;
  status_label: string;
  priority: string;
  callback_requested: boolean;
  awaiting_staff_reply: boolean;
  answered: boolean;
  needs_attention: boolean;
  exception: boolean;
  customer_name: string;
  phone: string | null;
  order_status: string | null;
  shipment_status: string | null;
  courier: string | null;
  awb: string | null;
  created_at: string;
  last_customer_message_at: string | null;
  last_staff_reply_at: string | null;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "needs_attention", label: "Needs attention" },
  { key: "awaiting_reply", label: "Awaiting reply" },
  { key: "exceptions", label: "Exceptions" },
  { key: "open", label: "All open" },
];

const PAGE = 50;

function ageLabel(iso: string): string {
  const hours = Math.max(0, (Date.now() - Date.parse(iso)) / 3_600_000);
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function SupportQueue() {
  const [filter, setFilter] = useState<Filter>("needs_attention");
  const [issues, setIssues] = useState<SupportIssue[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next: Filter, offset = 0, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    const res = await fetch(`/api/admin/notes/support?filter=${next}&limit=${PAGE}&offset=${offset}`, {
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      setError(json?.error || "Could not load support queue");
      if (!append) setIssues([]);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    setCounts(json.counts || {});
    setTotal(Number(json.page?.total || 0));
    setHasMore(!!json.page?.has_more);
    setNextOffset(json.page?.next_offset ?? null);
    setIssues((prev) => (append ? [...prev, ...(json.issues || [])] : json.issues || []));
    setLoading(false);
    setLoadingMore(false);
  }, []);

  useEffect(() => {
    void load(filter, 0, false);
    const id = window.setInterval(() => void load(filter, 0, false), 45_000);
    return () => window.clearInterval(id);
  }, [filter, load]);

  return (
    <div>
      <PageHeader
        title="Customer service"
        subtitle="Open Notes Store issues that need a reply, monitoring, or exception handling. Staff notes stay separate from automatic tracking updates."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count =
            f.key === "needs_attention"
              ? counts.needs_attention
              : f.key === "awaiting_reply"
                ? counts.awaiting_reply
                : f.key === "exceptions"
                  ? counts.exceptions
                  : counts.open;
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition ${
                active ? "bg-[var(--ca-navy)] text-white" : "border border-[var(--ca-navy)]/15 bg-white text-[var(--ca-navy)]"
              }`}
            >
              {f.label}
              <span className={`tabular-nums ${active ? "text-white/80" : "text-[var(--ca-navy)]/50"}`}>{count ?? 0}</span>
            </button>
          );
        })}
      </div>

      {!loading && (
        <p className="mb-3 text-xs text-[var(--ca-navy)]/50">
          Showing {issues.length} of {total} in this view
        </p>
      )}

      {error && (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-[var(--ca-navy)]/60">Loading…</p>
      ) : issues.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--ca-navy)]/15 bg-white p-10 text-center text-sm text-[var(--ca-navy)]/60">
          Nothing in this view. Clear queue.
        </p>
      ) : (
        <div className="space-y-3">
          {issues.map((issue) => (
            <article
              key={issue.id}
              className="rounded-2xl border border-[var(--ca-navy)]/8 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.03)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/notes/orders/${issue.order_id}`}
                      className="font-heading text-lg font-bold text-[var(--ca-navy)] underline-offset-2 hover:underline"
                    >
                      {issue.order_no.replace(/^NIAS-N-2026-/, "#")}
                    </Link>
                    <span className="text-sm text-[var(--ca-navy)]/55">{issue.customer_name}</span>
                    {issue.priority === "high" && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                        High
                      </span>
                    )}
                    {issue.awaiting_staff_reply && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-900">
                        Needs reply
                      </span>
                    )}
                    {issue.answered && !issue.awaiting_staff_reply && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-900">
                        Answered
                      </span>
                    )}
                    {issue.exception && (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-orange-900">
                        Exception
                      </span>
                    )}
                    {issue.callback_requested && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-900">
                        Callback
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--ca-navy)]/50">
                    {issue.reference} · {issue.category_label} · {issue.status_label} · open {ageLabel(issue.created_at)}
                  </p>
                </div>
                <Link
                  href={`/admin/notes/orders/${issue.order_id}#customer-issue`}
                  className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white"
                >
                  Open issue
                </Link>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-[var(--ca-navy)]/85">
                <span className="font-semibold text-[var(--ca-navy)]">Customer: </span>
                {issue.latest_customer_message}
              </p>

              <div className="mt-3 grid gap-2 text-xs text-[var(--ca-navy)]/60 sm:grid-cols-2 lg:grid-cols-4">
                <p>
                  <span className="font-semibold text-[var(--ca-navy)]/80">Order</span>
                  <br />
                  {issue.order_status || "—"}
                </p>
                <p>
                  <span className="font-semibold text-[var(--ca-navy)]/80">Shipment</span>
                  <br />
                  {issue.shipment_status || "No active shipment"}
                  {issue.courier ? ` · ${issue.courier}` : ""}
                </p>
                <p>
                  <span className="font-semibold text-[var(--ca-navy)]/80">AWB</span>
                  <br />
                  {issue.awb || "—"}
                </p>
                <p>
                  <span className="font-semibold text-[var(--ca-navy)]/80">Last touch</span>
                  <br />
                  Customer {formatWhen(issue.last_customer_message_at)} · Staff {formatWhen(issue.last_staff_reply_at)}
                </p>
              </div>
            </article>
          ))}

          {hasMore && nextOffset != null && (
            <div className="pt-2 text-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void load(filter, nextOffset, true)}
                className="inline-flex min-h-11 items-center rounded-full border border-[var(--ca-navy)]/15 bg-white px-5 text-sm font-semibold text-[var(--ca-navy)]"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
