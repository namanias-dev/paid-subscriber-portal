"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, useAdminData, LoadingBlock } from "@/components/admin/ui";
import { RegistrationsTrendPanel } from "@/components/admin/RegistrationsTrendChart";
import { buildWebinarByDay } from "@/lib/webinarReg";
import type { Payment } from "@/lib/types";

/**
 * Full-page "Registrations" (all webinars) view. Reuses the admin portal's
 * dedicated-route pattern. Same paid-only distinct data + chart + timeframe
 * controls as the card — just full-page. Read-only.
 */
export default function RegistrationsPage() {
  const full = useAdminData<Payment[]>("/api/admin/payments", "payments");
  const payments = useMemo(() => full.data || [], [full.data]);
  const byDay = useMemo(() => buildWebinarByDay(payments, ""), [payments]);

  return (
    <div className="pay-stagger">
      <Link
        href="/admin/payments"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink2 transition hover:text-ink"
      >
        <ArrowLeft size={15} /> Payments &amp; Finance
      </Link>

      <PageHeader
        title="Registrations"
        subtitle="Paid webinar registrations by day (IST) — distinct per person/webinar."
      />

      {full.loading ? (
        <LoadingBlock />
      ) : (
        <div className="card p-4 sm:p-6">
          <RegistrationsTrendPanel
            byDay={byDay}
            footNote="Counts paid webinar registrations by day (IST), distinct by (phone, webinar). Read-only analytics."
          />
        </div>
      )}
    </div>
  );
}
