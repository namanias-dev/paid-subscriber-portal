import { formatINR } from "@/lib/dates";
import type { Stats } from "@/lib/dataProvider";

export default function StatsRow({ stats }: { stats: Stats | null }) {
  const items = [
    { label: "Total Students", value: stats ? String(stats.total) : "—", icon: "👥" },
    { label: "Active Now", value: stats ? String(stats.activeNow) : "—", icon: "✅" },
    { label: "Expiring in 7 Days", value: stats ? String(stats.expiringSoon) : "—", icon: "⏳" },
    {
      label: "Total Revenue",
      value: stats ? formatINR(stats.totalRevenue) : "—",
      icon: "💰",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="card p-4">
          <div className="text-xl">{it.icon}</div>
          <div className="mt-1 font-heading text-2xl text-gold-light">{it.value}</div>
          <div className="text-xs text-muted">{it.label}</div>
        </div>
      ))}
    </div>
  );
}
