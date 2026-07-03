"use client";

import { useMemo } from "react";
import RegistrationsTrendChart from "./RegistrationsTrendChart";
import { buildWebinarByDay } from "@/lib/webinarReg";
import type { Payment } from "@/lib/types";

/** Route for the full-page "Registrations by webinar" view. */
export const WEBINAR_REGISTRATIONS_ROUTE = "/admin/payments/webinar-registrations";

/**
 * Per-webinar registrations entry card. Same source + methodology as
 * WebinarRegistrationsTrend (paid webinar payments, distinct by (phone, webinar)
 * per IST day). Clicking opens the FULL-PAGE view ({@link WEBINAR_REGISTRATIONS_ROUTE})
 * — reusing the admin portal's dedicated-route pattern — where the same chart,
 * timeframe controls, and webinar selector live. Read-only. The all-webinars card
 * keeps its inline modal behavior; only this card opens full-page.
 */
export default function WebinarRegistrationsByWebinarTrend({ payments }: { payments: Payment[] }) {
  // Sparkline reflects all webinars (last 7d); the webinar selector lives on the full page.
  const byDay = useMemo(() => buildWebinarByDay(payments, ""), [payments]);

  return (
    <RegistrationsTrendChart
      byDay={byDay}
      label="By webinar · All webinars"
      modalTitle="Registrations by webinar"
      href={WEBINAR_REGISTRATIONS_ROUTE}
    />
  );
}
