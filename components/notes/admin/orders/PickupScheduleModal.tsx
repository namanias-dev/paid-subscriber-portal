"use client";

import { useMemo, useState } from "react";

/**
 * Schedule / reschedule a courier pickup on the EXISTING shipment + AWB.
 *
 * Providers accept a date within a short window and assign the pickup time themselves
 * (Shiprocket confirms a date; Delhivery uses a fixed time). There is therefore NO time-slot
 * selector — we show "Pickup time will be assigned by the courier" (§8, §9). Dates are built
 * in Asia/Kolkata so the staff browser's timezone can't shift the business day.
 */

const IST = "Asia/Kolkata";
const MAX_AHEAD_DAYS = 10;

function istToday(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m, d] = parts.split("-").map(Number);
  return { y, m, d };
}

function buildDays(): { iso: string; label: string; weekday: string; isToday: boolean }[] {
  const t = istToday();
  const base = Date.UTC(t.y, t.m - 1, t.d);
  const out: { iso: string; label: string; weekday: string; isToday: boolean }[] = [];
  for (let i = 0; i <= MAX_AHEAD_DAYS; i += 1) {
    const dt = new Date(base + i * 86_400_000);
    const iso = dt.toISOString().slice(0, 10);
    out.push({
      iso,
      label: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(dt),
      weekday: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(dt),
      isToday: i === 0,
    });
  }
  return out;
}

export function PickupScheduleModal({
  orderId,
  mode,
  onClose,
  onDone,
}: {
  orderId: string;
  mode: "schedule" | "reschedule";
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const days = useMemo(buildDays, []);
  const [selected, setSelected] = useState<string>(days[1]?.iso || days[0].iso);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/notes/orders/${orderId}/pickup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ date: selected }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error || "Pickup could not be scheduled. Please try again.");
        setBusy(false);
        return;
      }
      const confirmed = typeof json.pickup_date === "string" ? json.pickup_date.slice(0, 10) : selected;
      onDone(`Pickup ${mode === "reschedule" ? "rescheduled" : "scheduled"} for ${confirmed}`);
    } catch {
      setError("Pickup could not be scheduled. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ca-navy)]/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Schedule courier pickup">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">{mode === "reschedule" ? "Reschedule courier pickup" : "Schedule courier pickup"}</h2>
            <p className="mt-1 text-sm text-[var(--ca-navy)]/70">Same courier and AWB. Pick a date in IST.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-full text-2xl leading-none text-[var(--ca-navy)]/60">×</button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Pickup date">
          {days.map((day) => {
            const active = day.iso === selected;
            return (
              <button
                key={day.iso}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(day.iso)}
                className={`flex min-h-16 flex-col items-center justify-center rounded-xl border px-2 py-2 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  active ? "border-[var(--ca-navy)] bg-[var(--ca-navy)] text-white" : "border-[var(--ca-navy)]/15 bg-white text-[var(--ca-navy)]"
                }`}
              >
                <span className="text-[11px] uppercase tracking-wide opacity-80">{day.isToday ? "Today" : day.weekday}</span>
                <span className="text-sm font-semibold">{day.label}</span>
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-[var(--ca-navy)]/60">Pickup time will be assigned by the courier.</p>
        {error && <p className="mt-2 text-sm font-medium text-red-600" role="alert">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-full border border-[var(--ca-navy)]/15 px-4 text-sm font-semibold text-[var(--ca-navy)]">Cancel</button>
          <button type="button" onClick={() => void confirm()} disabled={busy} className="min-h-11 flex-1 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Scheduling…" : mode === "reschedule" ? "Reschedule pickup" : "Confirm pickup"}
          </button>
        </div>
      </div>
    </div>
  );
}
