"use client";

import { useEffect, useMemo, useState } from "react";
import { formatPaise } from "@/lib/store/money";
import { defaultQuote, rankQuotes, type AdminQuote } from "@/lib/store/adminConsole";

interface ProviderResult {
  provider: string;
  configured: boolean;
  ok: boolean;
  quotes: AdminQuote[];
  error: string | null;
}

interface RateResponse {
  ok: boolean;
  error: string | null;
  writes_authorized: boolean;
  providers: ProviderResult[];
}

export default function CourierPicker({
  orderId,
  open,
  writesAuthorized,
  weight,
  length,
  width,
  height,
  onClose,
  onBooked,
}: {
  orderId: string;
  open: boolean;
  writesAuthorized: boolean;
  weight: number;
  length: number;
  width: number;
  height: number;
  onClose: () => void;
  onBooked: () => void;
}) {
  const [mode, setMode] = useState<"price" | "eta">("price");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<AdminQuote[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDone(false);
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/notes/orders/${orderId}/rates`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ weight_grams: weight, length_cm: length, width_cm: width, height_cm: height }),
        });
        const json = (await res.json()) as RateResponse;
        const flat = (json.providers || []).flatMap((p) => p.quotes || []);
        setQuotes(flat);
        setSelected(defaultQuote(flat)?.key || null);
        if (!json.ok && !flat.length) setError(json.error || "No quote available.");
      } catch {
        setError("Could not reach the quote service.");
      } finally {
        setBusy(false);
      }
    })();
  }, [open, orderId, weight, length, width, height]);

  const ranked = useMemo(() => rankQuotes(quotes, mode), [quotes, mode]);
  const chosen = ranked.find((q) => q.key === selected) || ranked[0] || null;

  async function book() {
    if (!chosen || !writesAuthorized) return;
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
      else {
        setDone(true);
        onBooked();
      }
    } catch {
      setError("Shipment was not created.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button type="button" aria-label="Close delivery options" className="absolute inset-0 bg-[var(--ca-navy)]/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Delivery options" className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-[#fbfaf6] p-5 sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Delivery options</p>
            <h2 className="mt-1 font-heading text-2xl font-bold text-[var(--ca-navy)]">Choose a courier</h2>
          </div>
          <button type="button" onClick={onClose} className="min-h-11 px-2 text-sm text-[var(--ca-navy)]/60">Close</button>
        </div>
        <div className="mt-4 flex gap-2">
          {(["price", "eta"] as const).map((item) => (
            <button key={item} type="button" onClick={() => setMode(item)} className={`min-h-10 rounded-full px-4 text-sm font-semibold ${mode === item ? "bg-[var(--ca-navy)] text-white" : "bg-white text-[var(--ca-navy)]"}`}>
              {item === "price" ? "Cheapest" : "Fastest"}
            </button>
          ))}
        </div>
        {busy && !ranked.length && <div className="mt-4 h-28 animate-pulse rounded-2xl bg-white" />}
        <ul className="mt-4 space-y-2">
          {ranked.map((quote) => (
            <li key={quote.key}>
              <button
                type="button"
                onClick={() => setSelected(quote.key)}
                className={`flex w-full items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-left ${chosen?.key === quote.key ? "border-[var(--ca-gold-dark)] bg-white" : "border-[var(--ca-navy)]/10 bg-white/80"}`}
              >
                <span>
                  <span className="block text-sm font-semibold text-[var(--ca-navy)]">{quote.courier}</span>
                  <span className="mt-1 block text-xs text-[var(--ca-navy)]/60">{quote.etaText || (quote.etaDays != null ? `${quote.etaDays} days` : "ETA not returned")} · {quote.service || quote.provider}</span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    {quote.lowest && <span className="rounded-full bg-[var(--ca-gold)]/20 px-2 py-0.5 text-[10px] font-semibold text-[var(--ca-gold-dark)]">Lowest price</span>}
                    {quote.fastest && <span className="rounded-full bg-[var(--ca-navy)]/5 px-2 py-0.5 text-[10px] font-semibold text-[var(--ca-navy)]">Fastest</span>}
                    {quote.bestValue && <span className="rounded-full bg-[var(--ca-navy)]/5 px-2 py-0.5 text-[10px] font-semibold text-[var(--ca-navy)]">Best value</span>}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums text-[var(--ca-navy)]">{formatPaise(quote.ratePaise)}</span>
              </button>
            </li>
          ))}
        </ul>
        {chosen && (
          <p className="mt-4 text-sm text-[var(--ca-navy)]">
            Selected {chosen.courier} · {formatPaise(chosen.ratePaise)}
            {chosen.etaText ? ` · ${chosen.etaText}` : ""}
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-800">{error}</p>}
        {done && <p className="mt-3 text-sm text-emerald-800">Shipment created. The order stays packed until the courier collects it.</p>}
        <button type="button" disabled={busy || !chosen || !writesAuthorized || done} onClick={() => void book()} className="mt-4 min-h-12 w-full rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white disabled:opacity-50">
          {writesAuthorized ? "Create shipment" : "Shipping actions unavailable"}
        </button>
      </div>
    </div>
  );
}
