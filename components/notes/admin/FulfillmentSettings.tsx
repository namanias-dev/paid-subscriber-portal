"use client";

import { useCallback, useEffect, useState } from "react";

interface Settings {
  auto: boolean;
  strategy: string;
  maxAttempts: number;
  shiprocket: boolean;
  delhivery: boolean;
  excluded: string[];
}

export default function FulfillmentSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/notes/fulfillment-settings", { cache: "no-store" });
    const json = await res.json();
    if (json.ok) setSettings(json.settings);
    else setError(json.error || "Could not load fulfillment settings.");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Partial<Settings>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/notes/fulfillment-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) setError(json.error || "Could not save.");
    else setSettings(json.settings);
  }

  if (!settings) return null;

  return (
    <section className="mb-6 rounded-3xl border border-[var(--ca-navy)]/10 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ca-navy)]/50">Automatic fulfillment</p>
      <p className="mt-1 text-sm text-[var(--ca-navy)]/70">
        Starts after Mark packed. Strategy: cheapest eligible. Up to {settings.maxAttempts} couriers. Delhivery stays eligible.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void save({ auto: !settings.auto })} className="min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white">
          Auto fulfillment {settings.auto ? "ON" : "OFF"}
        </button>
        <button type="button" disabled={busy} onClick={() => void save({ shiprocket: !settings.shiprocket })} className="min-h-11 rounded-full border px-4 text-sm font-semibold">
          Shiprocket {settings.shiprocket ? "ON" : "OFF"}
        </button>
        <button type="button" disabled={busy} onClick={() => void save({ delhivery: !settings.delhivery })} className="min-h-11 rounded-full border px-4 text-sm font-semibold">
          Delhivery Direct {settings.delhivery ? "ON" : "OFF"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
