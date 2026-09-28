"use client";

import { useEffect, useMemo, useState } from "react";
import { formatPaise } from "@/lib/store/money";
import { rankQuotes, type AdminQuote } from "@/lib/store/adminConsole";

interface ProviderResult {
  provider: string;
  configured: boolean;
  ok: boolean;
  quotes: Array<AdminQuote & { prepaid?: boolean; codSupported?: boolean }>;
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
  const [quotes, setQuotes] = useState<ProviderResult["quotes"]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDone(null);
    setError(null);
    setSelected(null);
    setConfirming(false);
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
        if (!json.ok && !flat.length) setError(json.error || "No quote available.");
      } catch {
        setError("Could not reach the quote service.");
      } finally {
        setBusy(false);
      }
    })();
  }, [open, orderId, weight, length, width, height]);

  const ranked = useMemo(() => rankQuotes(quotes, mode), [quotes, mode]);
  const chosen = ranked.find((q) => q.key === selected) || null;

  async function book() {
    if (!chosen || !writesAuthorized || !confirming) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/notes/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          provider: chosen.provider,
          courier_id: chosen.courierId || undefined,
          courier: chosen.courier,
          service: chosen.service,
          rate_paise: chosen.ratePaise,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setConfirming(false);
        const reason = json.error || "Shipment was not created.";
        setError(json.code === "CANCELLED" ? `${reason} Shipment was cancelled.` : reason);
      } else {
        setDone(json.pickup ? "Shipment booked and pickup requested." : "Shipment saved. Pickup was not scheduled.");
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
            <p className="mt-1 text-xs text-[var(--ca-navy)]/55">Weight used: {weight} g · {length} × {width} × {height} cm. Nothing is booked until you confirm.</p>
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
          {ranked.map((quote) => {
            const extra = quotes.find((row) => row.provider === quote.provider && row.courier === quote.courier && row.ratePaise === quote.ratePaise);
            return (
              <li key={quote.key}>
                <button
                  type="button"
                  onClick={() => { setSelected(quote.key); setConfirming(false); setError(null); }}
                  className={`flex w-full items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-left ${chosen?.key === quote.key ? "border-[var(--ca-gold-dark)] bg-white" : "border-[var(--ca-navy)]/10 bg-white/80"}`}
                >
                  <span>
                    <span className="block text-sm font-semibold text-[var(--ca-navy)]">{quote.courier}</span>
                    <span className="mt-1 block text-xs text-[var(--ca-navy)]/60">
                      {quote.provider} · {quote.service || "Service"} · {quote.etaText || (quote.etaDays != null ? `${quote.etaDays} days` : "ETA not returned")}
                    </span>
                    <span className="mt-1 block text-xs text-[var(--ca-navy)]/50">{extra?.prepaid === false ? "COD" : "Prepaid"}</span>
                    <span className="mt-2 flex flex-wrap gap-1">
                      {quote.lowest && <span className="rounded-full bg-[var(--ca-gold)]/20 px-2 py-0.5 text-[10px] font-semibold text-[var(--ca-gold-dark)]">Cheapest</span>}
                      {quote.fastest && <span className="rounded-full bg-[var(--ca-navy)]/5 px-2 py-0.5 text-[10px] font-semibold text-[var(--ca-navy)]">Fastest</span>}
                    </span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-[var(--ca-navy)]">{formatPaise(quote.ratePaise)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {error && <p className="mt-3 text-sm text-red-800">{error}</p>}
        {done && <p className="mt-3 text-sm text-emerald-800">{done}</p>}
        {confirming && chosen && (
          <div className="mt-4 rounded-2xl bg-white p-4">
            <p className="font-semibold text-[var(--ca-navy)]">Book {chosen.courier}?</p>
            <p className="mt-1 text-sm text-[var(--ca-navy)]/70">Courier cost: {formatPaise(chosen.ratePaise)}</p>
            <p className="mt-2 text-sm text-[var(--ca-navy)]/70">This will create the shipment, generate an AWB, and request pickup.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-full border px-4 text-sm font-semibold">Cancel</button>
              <button type="button" disabled={busy} onClick={() => void book()} className="min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white disabled:opacity-50">
                Book courier & request pickup
              </button>
            </div>
          </div>
        )}
        {!confirming && (
          <button
            type="button"
            disabled={busy || !chosen || !writesAuthorized || Boolean(done)}
            onClick={() => setConfirming(true)}
            className="mt-4 min-h-12 w-full rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white disabled:opacity-50"
          >
            {chosen ? `Book ${chosen.courier} · ${formatPaise(chosen.ratePaise)}` : writesAuthorized ? "Select a courier" : "Shipping actions unavailable"}
          </button>
        )}
      </div>
    </div>
  );
}
