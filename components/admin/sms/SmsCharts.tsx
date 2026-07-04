"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";

/**
 * Recharts bodies for SMS Mission Control, split out so Recharts can be
 * lazy-loaded via next/dynamic and kept out of the initial /admin/communications/sms
 * bundle. Both charts render only inside their respective (below-the-fold) tabs.
 * Purely presentational; identical output to the previous inline charts.
 */

export function SmsTrend24h({ data }: { data: { hour: string; sent: number; failed: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
        <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={3} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip />
        <Line type="monotone" dataKey="sent" stroke="#16a34a" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="failed" stroke="#dc2626" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SmsSendsOverTime({ data }: { data: { day: string; sent: number; failed: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}><CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis dataKey="day" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip /><Bar dataKey="sent" fill="#16a34a" /><Bar dataKey="failed" fill="#dc2626" /></BarChart>
    </ResponsiveContainer>
  );
}
