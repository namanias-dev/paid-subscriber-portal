"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, useAdminData, LoadingBlock } from "@/components/admin/ui";
import WebinarSourceBreakdownPanel from "@/components/admin/WebinarSourceBreakdownPanel";
import type { Payment } from "@/lib/types";

/**
 * Full-page "Registrations by source" view. Reuses the admin portal's
 * dedicated-route pattern. Same paid-only distinct source breakdown, filterable
 * per webinar + all, with timeframe controls — just full-page. Read-only.
 */
export default function RegistrationsBySourcePage() {
  const full = useAdminData<Payment[]>("/api/admin/payments", "payments");
  const payments = useMemo(() => full.data || [], [full.data]);

  return (
    <div className="pay-stagger">
      <Link
        href="/admin/payments"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink2 transition hover:text-ink"
      >
        <ArrowLeft size={15} /> Payments &amp; Finance
      </Link>

      <PageHeader
        title="Registrations by Source"
        subtitle="Paid webinar registrations by acquisition source (IST) — filter by webinar and timeframe."
      />

      {full.loading ? (
        <LoadingBlock />
      ) : (
        <div className="card p-4 sm:p-6">
          <WebinarSourceBreakdownPanel payments={payments} />
        </div>
      )}
    </div>
  );
}
