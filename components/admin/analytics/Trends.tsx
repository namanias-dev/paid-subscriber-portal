"use client";

import { useEffect, useState } from "react";
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { LoadingBlock } from "@/components/admin/ui";
import { SectionCard, EmptyState } from "./Shared";
import { formatINR } from "@/lib/dates";

interface Point { day: string; visitors: number; registrations: number; logins: number; quizAttempts: number; paymentsInitiated: number; paid: number; abandoned: number; revenue: number }

function dayLabel(ymd: string): string { const [, m, d] = ymd.split("-"); return d && m ? `${d}/${m}` : ymd; }

export default function Trends({ qs }: { qs: string }) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analytics/timeseries?${qs}`).then((r) => r.json())
      .then((d) => setPoints(d.ok ? d.timeseries.points : null))
      .catch(() => setPoints(null))
      .finally(() => setLoading(false));
  }, [qs]);

  if (loading) return <div className="space-y-4"><LoadingBlock /><LoadingBlock /></div>;
  if (!points || points.length === 0) return <SectionCard title="Trends"><EmptyState>No activity in this range yet.</EmptyState></SectionCard>;
  const data = points.map((p) => ({ ...p, label: dayLabel(p.day) }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Acquisition (visitors · registrations · paid)">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip /><Legend />
              <Line type="monotone" dataKey="visitors" name="Visitors" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="registrations" name="Registrations" stroke="#d97706" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="paid" name="Paid" stroke="#16a34a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title="Revenue">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#16a34a" stopOpacity={0.3} /><stop offset="95%" stopColor="#16a34a" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => formatINR(Number(v))} />
              <Tooltip formatter={(v) => formatINR(Number(v))} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#16a34a" strokeWidth={2} fill="url(#rev)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title="Payments (initiated · paid · abandoned)">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip /><Legend />
              <Line type="monotone" dataKey="paymentsInitiated" name="Initiated" stroke="#7c3aed" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="paid" name="Paid" stroke="#16a34a" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="abandoned" name="Abandoned" stroke="#dc2626" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title="Engagement (logins · quiz attempts)">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip /><Legend />
              <Line type="monotone" dataKey="logins" name="Logins" stroke="#0891b2" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="quizAttempts" name="Quiz attempts" stroke="#db2777" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>
    </div>
  );
}
