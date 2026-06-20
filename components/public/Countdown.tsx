"use client";

import { useEffect, useState } from "react";

export default function Countdown({ to }: { to: string }) {
  const [left, setLeft] = useState<number>(() => new Date(to).getTime() - Date.now());

  useEffect(() => {
    const id = setInterval(() => setLeft(new Date(to).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [to]);

  if (left <= 0) return <span className="pill pill-red">Started / Completed</span>;

  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const box = (v: number, l: string) => (
    <div className="rounded-xl bg-surface px-3 py-2 text-center">
      <div className="font-heading text-xl font-extrabold tabular-nums text-ink">{String(v).padStart(2, "0")}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{l}</div>
    </div>
  );

  return (
    <div className="flex gap-2">
      {box(d, "days")}
      {box(h, "hrs")}
      {box(m, "min")}
      {box(s, "sec")}
    </div>
  );
}
