"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, useAdminData, LoadingBlock } from "@/components/admin/ui";
import WebinarSourceBreakdownPanel from "@/components/admin/WebinarSourceBreakdownPanel";
import type { LeadAttrStamp } from "@/components/admin/SourcePill";
import type { Payment } from "@/lib/types";

/**
 * Full-page "Registrations by source" view. Reuses the admin portal's
 * dedicated-route pattern. Same paid-only distinct source breakdown, filterable
 * per webinar + all, with timeframe controls — just full-page. Read-only.
 *
 * Payments UI v2 (default) threads `leadAttrByPhone` through so the breakdown
 * uses the DERIVED CRM channel (fbclid/gclid-aware) instead of the historical
 * flat `attribution_source` — fixing the Meta Ads undercount. When
 * `PAYMENTS_UI_V2=false` on the server, the API returns `paymentsUiV2=false`
 * and this page falls back to the pre-shipment flat-source panel and stagger
 * animation without a redeploy.
 */
export default function RegistrationsBySourcePage() {
  const full = useAdminData<Payment[]>("/api/admin/payments", "payments");
  const leadAttrByPhone = useAdminData<Record<string, LeadAttrStamp>>("/api/admin/payments", "leadAttrByPhone").data || {};
  const paymentsUiV2 = useAdminData<boolean>("/api/admin/payments", "paymentsUiV2").data ?? true;
  const payments = useMemo(() => full.data || [], [full.data]);

  return (
    <div className={paymentsUiV2 ? "" : "pay-stagger"}>
      <Link
        href="/admin/payments"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink2 transition hover:text-ink motion-reduce:transition-none"
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
          <WebinarSourceBreakdownPanel
            payments={payments}
            leadAttrByPhone={paymentsUiV2 ? leadAttrByPhone : null}
          />
        </div>
      )}
    </div>
  );
}
