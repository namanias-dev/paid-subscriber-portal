"use client";

import { useMemo } from "react";
import RegistrationsTrendChart from "./RegistrationsTrendChart";
import { istYMD } from "@/lib/dates";
import { isPaidStatus as isPaid, itemKey } from "@/lib/paymentsAgg";
import type { Payment } from "@/lib/types";

/**
 * Read-only registrations trend. Counts PAID webinar payments by IST day — the
 * SAME source as the "Webinar Registrations Today" card, so the latest bar always
 * matches that number. Never mutates any data. Rendering (mini card + modal chart
 * + timeframe controls) is delegated to the shared RegistrationsTrendChart so the
 * look/feel stays identical to the per-webinar card.
 */
export default function WebinarRegistrationsTrend({ payments }: { payments: Payment[] }) {
  // Paid webinar registrations bucketed by IST day — counted DISTINCT by
  // (phone, webinar) per day, so a retry that leaves two paid rows for the same
  // person+webinar on a day counts as ONE registration (matches the seat count).
  const byDay = useMemo(() => {
    const perDay = new Map<string, Set<string>>();
    for (const p of payments) {
      if (!isPaid(p.status) || p.item_type !== "webinar") continue;
      const ymd = istYMD(p.created_at);
      if (!ymd) continue;
      let s = perDay.get(ymd);
      if (!s) { s = new Set(); perDay.set(ymd, s); }
      s.add(`${(p.phone || "").trim()}|${itemKey(p)}`);
    }
    const map = new Map<string, number>();
    for (const [ymd, s] of perDay) map.set(ymd, s.size);
    return map;
  }, [payments]);

  return (
    <RegistrationsTrendChart
      byDay={byDay}
      label="Registrations · last 7 days"
      modalTitle="Webinar registrations trend"
      footNote="Counts paid webinar registrations by day (IST). Read-only analytics."
    />
  );
}
