"use client";

import { useMemo } from "react";
import SplitPreviewCard from "./SplitPreviewCard";
import { webinarSplit, last7Pred } from "@/lib/webinarReg";
import type { Payment } from "@/lib/types";

/** Route for the full-page "Registrations by webinar" view. */
export const WEBINAR_REGISTRATIONS_ROUTE = "/admin/payments/webinar-registrations";

/**
 * Collapsed "Registrations by webinar" card: previews the per-webinar split
 * (last 7 days) as labelled mini-bars with "+N more", and opens the FULL-PAGE
 * view on click. Same paid-only + distinct (phone, webinar, day) methodology as
 * the opened view (shared {@link webinarSplit}), so the per-webinar rows sum to
 * the all-webinars total and match the opened view. Read-only.
 */
export default function WebinarRegistrationsByWebinarTrend({ payments }: { payments: Payment[] }) {
  const { rows, total } = useMemo(() => webinarSplit(payments, last7Pred()), [payments]);

  return (
    <SplitPreviewCard
      label="Registrations by webinar"
      href={WEBINAR_REGISTRATIONS_ROUTE}
      rows={rows.map((r) => ({ key: r.key, label: r.label, count: r.count }))}
      total={total}
      hint="last 7 days"
      emptyText="No webinar registrations in the last 7 days."
    />
  );
}
