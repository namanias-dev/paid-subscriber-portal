"use client";

import { useMemo, useState } from "react";
import { RegistrationsTrendPanel } from "./RegistrationsTrendChart";
import { buildWebinarByDay, listPaidWebinars } from "@/lib/webinarReg";
import type { Payment } from "@/lib/types";

/**
 * Full-page interactive body for "Registrations by webinar": the webinar selector
 * + the shared {@link RegistrationsTrendPanel} (timeframe controls + chart). Same
 * source + methodology as the live cards (paid webinar payments, distinct by
 * (phone, webinar) per IST day). Read-only.
 */
export default function WebinarRegistrationsByWebinarPanel({ payments }: { payments: Payment[] }) {
  const [selected, setSelected] = useState<string>(""); // "" = all webinars

  const webinars = useMemo(() => listPaidWebinars(payments), [payments]);
  const byDay = useMemo(() => buildWebinarByDay(payments, selected), [payments, selected]);

  const selector = (
    <select
      value={selected}
      onChange={(e) => setSelected(e.target.value)}
      className="input max-w-[240px]"
      aria-label="Filter by webinar"
    >
      <option value="">All webinars</option>
      {webinars.map((w) => (
        <option key={w.key} value={w.key}>{w.label}</option>
      ))}
    </select>
  );

  return (
    <RegistrationsTrendPanel
      byDay={byDay}
      extraControls={selector}
      footNote="Paid webinar registrations by day (IST), distinct by (phone, webinar), scoped to the selected webinar. Read-only analytics."
      emptyState={
        <div className="flex h-full w-full flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface2/40 p-6 text-center">
          <p className="text-sm font-semibold text-ink">No registrations in this range</p>
          <p className="mt-1 text-xs text-muted">
            {webinars.length === 0 ? "No paid webinar registrations yet." : "Try a different webinar or timeframe."}
          </p>
        </div>
      }
    />
  );
}
