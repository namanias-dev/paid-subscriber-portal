"use client";

import dynamic from "next/dynamic";
import { KpiCard, useAdminData, LoadingBlock, PageHeader } from "@/components/admin/ui";
import { formatINR } from "@/lib/dates";
import type { DashboardData } from "@/lib/dataProvider";

const EnrollmentsArea = dynamic(() => import("@/components/admin/Charts").then((m) => m.EnrollmentsArea), { ssr: false, loading: () => <LoadingBlock /> });
const RevenueBars = dynamic(() => import("@/components/admin/Charts").then((m) => m.RevenueBars), { ssr: false, loading: () => <LoadingBlock /> });
const SourcePie = dynamic(() => import("@/components/admin/Charts").then((m) => m.SourcePie), { ssr: false, loading: () => <LoadingBlock /> });
const FunnelBars = dynamic(() => import("@/components/admin/Charts").then((m) => m.FunnelBars), { ssr: false, loading: () => <LoadingBlock /> });

export default function AdminDashboard() {
  const { data, loading } = useAdminData<DashboardData>("/api/admin/dashboard", "data");

  if (loading || !data) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Your academy at a glance" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total Leads" value={data.totalLeads} hint={`${data.newLeadsToday} new today`} />
        <KpiCard label="Total Students" value={data.totalStudents} tone="green" />
        <KpiCard label="Active Subs" value={data.activeSubs} tone="green" />
        <KpiCard label="Conversion" value={`${data.conversionRate}%`} tone="amber" />
        {data.revenueMonth !== null && <KpiCard label="Revenue (Month)" value={formatINR(data.revenueMonth)} tone="green" />}
        {data.revenueTotal !== null && <KpiCard label="Revenue (Total)" value={formatINR(data.revenueTotal)} tone="green" />}
        {data.pendingCollections !== null && <KpiCard label="Pending Collections" value={formatINR(data.pendingCollections)} tone="red" />}
        <KpiCard label="Webinar Regs" value={data.webinarRegs} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-base">Enrollments over time</h3>
          <EnrollmentsArea data={data.enrollmentsByMonth} />
        </div>
        {data.revenueByCourse.length > 0 && (
          <div className="card p-5">
            <h3 className="mb-3 text-base">Revenue by course</h3>
            <RevenueBars data={data.revenueByCourse} />
          </div>
        )}
        <div className="card p-5">
          <h3 className="mb-3 text-base">Lead source breakdown</h3>
          <SourcePie data={data.leadSources} />
        </div>
        <div className="card p-5">
          <h3 className="mb-3 text-base">Funnel: Lead → Admission</h3>
          <FunnelBars data={data.funnel} />
        </div>
      </div>
    </div>
  );
}
