"use client";

/**
 * Payments analytics card: Legacy campaign → course conversion funnel.
 * Matches SplitPreviewCard / TodayCard language (card, uppercase label, bars).
 * Fetches its OWN endpoint so /api/admin/payments is unchanged and unblocked.
 */
import { useMemo, useState } from "react";
import { useAdminData } from "@/components/admin/ui";
import type { LegacyCampaignFunnelResult, FunnelSort } from "@/lib/marketing/legacyCampaignFunnel";
import {
  formatPct,
  legacyWorklistCampaignHref,
  sortFunnelRows,
  LOW_SAMPLE_THRESHOLD,
  TOP_CAMPAIGNS_PREVIEW,
} from "@/lib/marketing/legacyCampaignFunnel";

const SORTS: { key: FunnelSort; label: string }[] = [
  { key: "paid", label: "Paid" },
  { key: "matched", label: "Matched" },
  { key: "paid_rate", label: "Paid %" },
  { key: "seat_rate", label: "Seat %" },
];

export default function LegacyCampaignFunnelCard() {
  const { data, loading } = useAdminData<LegacyCampaignFunnelResult>(
    "/api/admin/payments/legacy-campaign-funnel",
    "funnel",
  );
  const [sort, setSort] = useState<FunnelSort>("paid");
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () => sortFunnelRows(data?.rows || [], sort),
    [data?.rows, sort],
  );
  const hasMore = sorted.length > TOP_CAMPAIGNS_PREVIEW;
  const visible = expanded || !hasMore ? sorted : sorted.slice(0, TOP_CAMPAIGNS_PREVIEW);
  const totals = data?.totals;
  const maxBar = Math.max(1, ...(visible.map((r) => r.matched)), totals?.matched || 0);

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Legacy campaign → conversion
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-extrabold leading-none tabular-nums">
              {loading ? "…" : totals?.matched ?? 0}
            </span>
            <span className="truncate text-[11px] text-muted">
              matched students · seat → installment
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                sort === s.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-line text-ink2 hover:border-primary/40"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Historical legacy import campaign (phone match). Bars are cumulative: matched ≥ seat booked ≥
        installment paid. Webinar regs shown separately — most matched students book a seat without a
        webinar. Samples under {LOW_SAMPLE_THRESHOLD} flagged. Click a row → Worklist (new tab).
      </p>

      {loading ? (
        <p className="mt-3 text-xs text-muted">Loading funnel…</p>
      ) : !totals || totals.matched === 0 ? (
        <p className="mt-3 text-xs text-muted">No students matched to a legacy campaign yet.</p>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            {visible.map((r) => (
              <a
                key={r.campaign || r.label}
                href={legacyWorklistCampaignHref(r.campaign || r.label)}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg px-2 py-1.5 hover:bg-surface2/60"
                title="Open legacy Worklist filtered by this campaign (new tab)"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink" title={r.label}>
                    {r.label}
                    {r.lowSample && (
                      <span className="ml-1 text-[10px] font-semibold text-amber-700">low n</span>
                    )}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted">
                    {r.matched} · seat {formatPct(r.seatRate)} · paid {formatPct(r.paidRate)}
                  </span>
                </div>
                <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-surface2" aria-hidden>
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-slate-300"
                    style={{ width: `${Math.max((r.matched / maxBar) * 100, 2)}%` }}
                  />
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-sky-500/80"
                    style={{ width: `${Math.max((r.seatCum / maxBar) * 100, r.seatCum ? 2 : 0)}%` }}
                  />
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-emerald-600"
                    style={{ width: `${Math.max((r.paidCum / maxBar) * 100, r.paidCum ? 2 : 0)}%` }}
                  />
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] tabular-nums text-muted">
                  <span>Webinar {r.webinarReg}</span>
                  <span>Seat {r.seatCum}</span>
                  <span>Paid {r.paidCum}</span>
                  <span className="text-ink2">
                    excl {r.exclNoSeat}/{r.exclSeatOnly}/{r.exclPaid}
                  </span>
                </div>
              </a>
            ))}
          </div>

          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 w-full rounded-lg border border-dashed border-line px-2 py-1.5 text-center text-[11px] font-semibold text-primary hover:bg-surface2/60"
            >
              {expanded
                ? `Show top ${TOP_CAMPAIGNS_PREVIEW}`
                : `Show all ${sorted.length} campaigns`}
            </button>
          )}

          <div className="mt-3 border-t border-line pt-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink">
              <span>Total</span>
              <span className="tabular-nums">{totals.matched} matched</span>
              <span className="tabular-nums text-sky-700">seat {totals.seatCum} ({formatPct(totals.seatRate)})</span>
              <span className="tabular-nums text-emerald-700">paid {totals.paidCum} ({formatPct(totals.paidRate)})</span>
            </div>
            <p className="mt-1 text-[10px] text-muted">
              Exclusive check: no-seat {totals.exclNoSeat} + seat-only {totals.exclSeatOnly} + paid{" "}
              {totals.exclPaid} = {totals.exclNoSeat + totals.exclSeatOnly + totals.exclPaid} (must equal matched).
              {data?.queryMs != null ? ` · query ${data.queryMs}ms` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-3 rounded-full bg-slate-300" /> Matched
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-3 rounded-full bg-sky-500/80" /> Seat booked+
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-3 rounded-full bg-emerald-600" /> Installment paid
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
