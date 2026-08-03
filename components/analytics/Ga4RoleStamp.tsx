"use client";

import { useEffect } from "react";
import { ga4SetUserProperties, hasMarketingConsent, isGa4Configured } from "@/lib/analytics/ga4";

export type Ga4Role = "anonymous" | "registered_free" | "paid_student" | "staff";

/**
 * Stamps GA4 user_property `role` once. Read-only; never writes to DB/session.
 * US AZ test cluster is internal staff (confirmed) — staff logins get role=staff.
 */
export default function Ga4RoleStamp({ role }: { role: Ga4Role }) {
  useEffect(() => {
    try {
      if (!isGa4Configured() || !hasMarketingConsent()) return;
      ga4SetUserProperties({ role });
    } catch {
      /* never throw */
    }
  }, [role]);
  return null;
}
