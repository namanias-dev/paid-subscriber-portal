"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const COLORS = ["#0057FF", "#3D8BFF", "#16A34A", "#F59E0B", "#FF9933", "#8A93A2", "#DC2626"];

export function EnrollmentsArea({ data }: { data: { month: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0057FF" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#0057FF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#8A93A2" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: "#8A93A2" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E5E9F0", fontSize: 13 }} />
        <Area type="monotone" dataKey="count" stroke="#0057FF" strokeWidth={2.5} fill="url(#g1)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RevenueBars({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#8A93A2" }} axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={{ fontSize: 12, fill: "#8A93A2" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E5E9F0", fontSize: 13 }} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#0057FF" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SourcePie({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E5E9F0", fontSize: 13 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function FunnelBars({ data }: { data: { stage: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12, fill: "#8A93A2" }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="stage" tick={{ fontSize: 12, fill: "#5A6472" }} axisLine={false} tickLine={false} width={80} />
        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E5E9F0", fontSize: 13 }} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} fill="#3D8BFF" />
      </BarChart>
    </ResponsiveContainer>
  );
}
