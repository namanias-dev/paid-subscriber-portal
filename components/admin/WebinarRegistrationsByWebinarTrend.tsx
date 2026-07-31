"use client";

import { useMemo } from "react";
import SplitPreviewCard from "./SplitPreviewCard";
import { latestPaidWebinar, type WebinarMeta } from "@/lib/webinarReg";
import type { Payment } from "@/lib/types";

/** Route for the full-page "Registrations by webinar" view. */
export const WEBINAR_REGISTRATIONS_ROUTE = "/admin/payments/webinar-registrations";

/**
 * Collapsed "Registrations by webinar" card: hero total for the chronologically
 * latest webinar only (no multi-webinar bars / time-series preview). Click opens
 * the full-page trend view. Same paid-only + distinct (phone, webinar, day)
 * methodology as the opened view. Read-only.
 */
export default function WebinarRegistrationsByWebinarTrend({
  payments,
  webinars,
}: {
  payments: Payment[];
  webinars?: WebinarMeta[] | null;
}) {
  const latest = useMemo(() => latestPaidWebinar(payments, webinars), [payments, webinars]);

  return (
    <SplitPreviewCard
      label="Registrations by webinar"
      href={WEBINAR_REGISTRATIONS_ROUTE}
      rows={latest ? [{ key: latest.key, label: latest.label, count: latest.count }] : []}
      total={latest?.count ?? 0}
      hint={latest ? latest.label : undefined}
      emptyText="No paid webinar registrations yet."
      totalOnly
    />
  );
}
