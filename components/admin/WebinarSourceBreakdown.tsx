"use client";

import { useMemo } from "react";
import SplitPreviewCard from "./SplitPreviewCard";
import { last7Pred } from "@/lib/webinarReg";
import { bucketizeSources, bucketMeta, type DerivedChannelAttr } from "@/lib/webinarSource";
import type { Payment } from "@/lib/types";

/** Route for the full-page "Registrations by source" view. */
export const SOURCE_BREAKDOWN_ROUTE = "/admin/payments/registrations-by-source";

/**
 * Collapsed "Paid registrations by source" card: previews the top acquisition
 * sources (last 7 days, all webinars combined) as a labelled split and opens
 * the FULL-PAGE view on click. Same paid-only + distinct methodology as the
 * opened view (shared {@link bucketizeSources}), so the split numbers match.
 *
 * When `leadAttrByPhone` is supplied (Payments UI v2 default), each paid
 * registration is bucketed by its DERIVED CRM channel (fbclid/gclid-aware,
 * looked up per phone) — fixing the historical undercount where paid Meta
 * traffic that flat-stamped `attribution_source="direct"` was hidden. When
 * omitted, the pre-v2 flat-bucket behavior is preserved byte-for-byte so a
 * `PAYMENTS_UI_V2=false` env flip restores the old card instantly. No-source
 * registrations are shown honestly as "Unknown" in both modes. Read-only.
 */
export default function WebinarSourceBreakdown({
  payments,
  leadAttrByPhone,
}: {
  payments: Payment[];
  leadAttrByPhone?: Record<string, DerivedChannelAttr> | null;
}) {
  const { rows, total } = useMemo(() => {
    const b = bucketizeSources(payments, "", last7Pred(), leadAttrByPhone);
    // Preview ranks purely by volume (Unknown included) so a large Unknown shows.
    const ranked = [...b.rows].sort((a, z) => z.count - a.count);
    const useDerived = !!leadAttrByPhone;
    return {
      total: b.total,
      rows: ranked.map((r) => {
        const meta = bucketMeta(r.key, useDerived);
        return { key: r.key, label: meta.label, count: r.count, color: meta.color };
      }),
    };
  }, [payments, leadAttrByPhone]);

  return (
    <SplitPreviewCard
      label="Paid registrations by source"
      href={SOURCE_BREAKDOWN_ROUTE}
      rows={rows}
      total={total}
      // v2: show the FULL derived channel list on the mini-card (typically 4-6
      // sources) so Meta Ads/Google Ads never hide behind an ambiguous "+N more".
      // Only truncate to top-6 with "+N more" if genuinely long — matches spec.
      maxRows={6}
      hint="last 7 days · all webinars"
      emptyText="No paid registrations in the last 7 days."
    />
  );
}
