"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Radio } from "lucide-react";
import { formatISTDate } from "@/lib/dates";

/**
 * Premium "Batch starts in" countdown (days:hours:mins) from a UTC ISO instant.
 * After the start, it switches gracefully to "Batch is live / In progress".
 * No layout shift (fixed slots) and respects prefers-reduced-motion (no anim).
 */
export default function BatchCountdown({
  startISO,
  label = "Batch starts in",
  liveLabel = "Batch is live · In progress",
}: {
  startISO?: string | null;
  label?: string;
  liveLabel?: string;
}) {
  const target = startISO ? new Date(startISO).getTime() : NaN;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (Number.isNaN(target)) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, [target]);

  if (Number.isNaN(target)) return null;

  // Pre-hydration / first paint: render a stable shell to avoid layout shift.
  const diff = now === null ? null : target - now;
  const live = diff !== null && diff <= 0;

  if (live) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-[rgba(22,163,74,0.3)] bg-[rgba(22,163,74,0.08)] px-4 py-3">
        <Radio size={18} className="text-[#16a34a]" aria-hidden="true" />
        <div>
          <p className="text-sm font-bold text-[#15803d]">{liveLabel}</p>
          <p className="text-xs text-[var(--ca-slate-700)]">Started {formatISTDate(startISO)} (IST)</p>
        </div>
      </div>
    );
  }

  const totalMin = diff === null ? 0 : Math.floor(diff / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const cells = [
    { v: days, l: "Days" },
    { v: hours, l: "Hours" },
    { v: mins, l: "Min" },
  ];

  return (
    <div className="rounded-2xl border border-[var(--ca-slate-200)] bg-white p-4 shadow-soft-sm">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ca-slate-400)]">
        <CalendarClock size={14} className="text-[var(--ca-gold)]" aria-hidden="true" /> {label}
      </p>
      <div className="mt-2.5 flex gap-2" aria-live="polite">
        {cells.map((c) => (
          <div key={c.l} className="flex-1 rounded-xl bg-[var(--ca-slate-50)] py-2 text-center">
            <div className="font-heading text-2xl font-extrabold tabular-nums text-[var(--ca-navy-900)]">
              {now === null ? "––" : String(c.v).padStart(2, "0")}
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--ca-slate-400)]">{c.l}</div>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-xs text-[var(--ca-slate-700)]">Starts {formatISTDate(startISO)} (IST)</p>
    </div>
  );
}
