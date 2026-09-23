"use client";

import { useState } from "react";
import { formatPaise } from "@/lib/store/money";

interface Quote {
  provider: string;
  courier: string;
  service: string;
  ratePaise: number;
  etaText: string | null;
  etaDays: number | null;
  codSupported?: boolean;
  courierId?: string | null;
}

interface ProviderResult {
  provider: string;
  configured: boolean;
  ok: boolean;
  quotes: Quote[];
  error: string | null;
}

interface RateResponse {
  ok: boolean;
  error: string | null;
  pickup_postcode: string | null;
  writes_authorized: boolean;
  providers: ProviderResult[];
  lowest: Quote | null;
}

export default function CourierQuotes({
  orderId,
  onUseCourier,
}: {
  orderId: string;
  onUseCourier: (courier: string) => void;
}) {
  const [weight, setWeight] = useState("800");
  const [length, setLength] = useState("30");
  const [width, setWidth] = useState("22");
  const [height, setHeight] = useState("3");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [chosen, setChosen] = useState<Quote | null>(null);

  const compare = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/notes/orders/${orderId}/rates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          weight_grams: Number(weight),
          length_cm: Number(length),
          width_cm: Number(width),
          height_cm: Number(height),
        }),
      });
      const json = (await res.json()) as RateResponse;
      setResult(json);
      if (!json.ok) setError(json.error || "No quote available.");
    } catch {
      setError("Could not reach the quote service.");
    } finally {
      setBusy(false);
    }
  };

  const packBody = () =>
    JSON.stringify({
      weight_grams: Number(weight),
      length_cm: Number(length),
      width_cm: Number(width),
      height_cm: Number(height),
    });

  const savePack = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/notes/orders/${orderId}/pack`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: packBody(),
      });
      const json = await res.json();
      if (!json.ok) setError(json.error || "Could not save the packed size.");
      else setSaved(true);
    } catch {
      setError("Could not save the packed size.");
    } finally {
      setBusy(false);
    }
  };

  const createShipment = async () => {
    if (!chosen) {
      setError("Choose a courier quote first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/notes/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: chosen.provider, courier_id: chosen.courierId || undefined }),
      });
      const json = await res.json();
      if (!json.ok) setError(json.error || "Shipment was not created.");
    } catch {
      setError("Shipment was not created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-line bg-white p-3">
      <p className="text-sm font-semibold text-ink">Compare courier rates</p>
      <p className="mt-1 text-xs text-ink2">
        Quote only, from the packed weight you enter. This does not create a label, AWB, or pickup.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-ink2">
          Weight (g)
          <input
            inputMode="numeric"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="mt-1 block h-9 w-24 rounded border border-line px-2 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-ink2">
          L (cm)
          <input
            inputMode="decimal"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            className="mt-1 block h-9 w-20 rounded border border-line px-2 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-ink2">
          W
          <input
            inputMode="decimal"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            className="mt-1 block h-9 w-20 rounded border border-line px-2 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-ink2">
          H
          <input
            inputMode="decimal"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            className="mt-1 block h-9 w-20 rounded border border-line px-2 text-sm text-ink"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void compare()}
          className="h-9 rounded border border-line bg-surface px-3 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {busy ? "Checking…" : "Compare"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void savePack()}
          className="h-9 rounded border border-line px-3 text-sm font-medium text-ink disabled:opacity-50"
        >
          Save packed size
        </button>
        <button
          type="button"
          disabled={busy || !chosen}
          onClick={() => void createShipment()}
          className="h-9 rounded border border-line px-3 text-sm font-medium text-ink disabled:opacity-50"
        >
          Create shipment
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {saved && <p className="mt-2 text-xs text-emerald-800">Packed size saved. No courier was booked.</p>}
      {result?.providers?.map((provider) => (
        <div key={provider.provider} className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink2">{provider.provider}</p>
          {!provider.configured && <p className="mt-1 text-xs text-ink2">Not configured on this server.</p>}
          {provider.error && provider.configured && <p className="mt-1 text-xs text-ink2">{provider.error}</p>}
          <ul className="mt-1 space-y-1">
            {provider.quotes.map((quote) => {
              const lowest =
                result.lowest &&
                quote.provider === result.lowest.provider &&
                quote.courier === result.lowest.courier &&
                quote.service === result.lowest.service &&
                quote.ratePaise === result.lowest.ratePaise;
              return (
                <li key={`${quote.courier}-${quote.service}-${quote.ratePaise}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-ink">
                    {quote.courier}
                    {quote.service && quote.service !== quote.courier ? ` · ${quote.service}` : ""}
                  </span>
                  <span className="tabular-nums">{formatPaise(quote.ratePaise)}</span>
                  <span className="text-ink2">{quote.etaText || (quote.etaDays != null ? `${quote.etaDays} days` : "ETA not returned")}</span>
                  <span className="text-ink2">{quote.codSupported ? "COD available" : "Prepaid"}</span>
                  {lowest && <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink">Lowest quote</span>}
                  <button
                    type="button"
                    onClick={() => {
                      setChosen(quote);
                      onUseCourier(quote.courier);
                    }}
                    className="rounded border border-line px-2 py-0.5 text-xs font-medium text-ink"
                  >
                    {chosen?.provider === quote.provider && chosen.courier === quote.courier && chosen.service === quote.service
                      ? "Selected"
                      : "Use this courier"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {result && (
        <p className="mt-2 text-[11px] text-ink2">
          Pickup PIN {result.pickup_postcode || "not set"}. Labels and pickups are{" "}
          {result.writes_authorized ? "authorized in this environment" : "switched off"}.
        </p>
      )}
    </div>
  );
}
