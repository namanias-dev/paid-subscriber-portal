"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader, useAdminData, LoadingBlock } from "@/components/admin/ui";
import WebinarRegistrationsByWebinarPanel from "@/components/admin/WebinarRegistrationsByWebinarPanel";
import type { Payment } from "@/lib/types";

/**
 * Full-page "Registrations by webinar" view. Reuses the admin portal's
 * dedicated-route pattern (like /admin/leaderboard). Same paid-webinar data and
 * chart as the card — just rendered full-page with the webinar selector and
 * timeframe controls. Read-only.
 */
export default function WebinarRegistrationsPage() {
  const full = useAdminData<Payment[]>("/api/admin/payments", "payments");
  const payments = full.data || [];

  return (
    <div>
      <Link
        href="/admin/payments"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink2 transition hover:text-ink"
      >
        <ArrowLeft size={15} /> Payments &amp; Finance
      </Link>

      <PageHeader
        title="Registrations by Webinar"
        subtitle="Paid webinar registrations by day (IST) — filter by webinar and timeframe."
      />

      {full.loading ? (
        <LoadingBlock />
      ) : (
        <div className="card p-4 sm:p-6">
          <WebinarRegistrationsByWebinarPanel payments={payments} />
        </div>
      )}
    </div>
  );
}
