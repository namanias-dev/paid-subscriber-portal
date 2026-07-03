"use client";

import { useMemo } from "react";
import SplitPreviewCard from "./SplitPreviewCard";
import { last7Pred } from "@/lib/webinarReg";
import { bucketizeSources, sourceMeta } from "@/lib/webinarSource";
import type { Payment } from "@/lib/types";

/** Route for the full-page "Registrations by source" view. */
export const SOURCE_BREAKDOWN_ROUTE = "/admin/payments/registrations-by-source";

/**
 * Collapsed "Paid registrations by source" card: previews the top acquisition
 * sources (last 7 days, all webinars combined) as a labelled split with "+N more",
 * and opens the FULL-PAGE view on click. Same paid-only + distinct methodology as
 * the opened view (shared {@link bucketizeSources}), so the split numbers match.
 * No-source registrations are shown honestly as "Unknown". Read-only.
 */
export default function WebinarSourceBreakdown({ payments }: { payments: Payment[] }) {
  const { rows, total } = useMemo(() => {
    const b = bucketizeSources(payments, "", last7Pred());
    // Preview ranks purely by volume (Unknown included) so a large Unknown shows.
    const ranked = [...b.rows].sort((a, z) => z.count - a.count);
    return {
      total: b.total,
      rows: ranked.map((r) => ({ key: r.key, label: sourceMeta(r.key).label, count: r.count, color: sourceMeta(r.key).color })),
    };
  }, [payments]);

  return (
    <SplitPreviewCard
      label="Paid registrations by source"
      href={SOURCE_BREAKDOWN_ROUTE}
      rows={rows}
      total={total}
      hint="last 7 days · all webinars"
      emptyText="No paid registrations in the last 7 days."
    />
  );
}
