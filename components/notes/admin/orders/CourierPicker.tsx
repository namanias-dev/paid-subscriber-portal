"use client";

import { useEffect, useState } from "react";
import { formatPaise } from "@/lib/store/money";
import { courierCostNotice, explicitCourierSelection, providerDisplayName, quoteWithinShippingNotice, selectionPremiumNotice, type AdminQuote, type PresentedQuote } from "@/lib/store/adminConsole";

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
  package?: { weight_grams: number; length_cm: number; width_cm: number; height_cm: number } | null;
  /** The saved comparison. Its rows are exactly what is shown and the only thing that can be booked. */
  quote_session?: { id: string; expires_at: string; options: PresentedQuote[] } | null;
}

function requestKey(): string {
  const c = typeof crypto !== "undefined" ? crypto : null;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

interface Booked {
  courier: string;
  awb: string;
  ratePaise: number;
  pickupRequested: boolean;
  labelUrl: string | null;
}

interface CityConfirm {
  customer: string;
  courierDestination: string;
  pin: string;
  state: string;
  courier: string;
  awb: string;
  ratePaise: number;
}

export default function CourierPicker({
  orderId,
  open,
  writesAuthorized,
  onClose,
  onBooked,
}: {
  orderId: string;
  open: boolean;
  writesAuthorized: boolean;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  onClose: () => void;
  onBooked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<PresentedQuote[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [cityConfirm, setCityConfirm] = useState<CityConfirm | null>(null);
  const [blockedKeys, setBlockedKeys] = useState<Record<string, string>>({});
  const [packLabel, setPackLabel] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!open) return;
    setConfirming(false);
    setBooked(null);
    setCityConfirm(null);
    setBlockedKeys({});
    setError(null);
    setSelectedKey(null);
    setQuotes([]);
    setSessionId(null);
    setStale(false);
    setBusy(true);
    // One key per Compare action: a repeated request returns the saved session without new provider calls.
    const key = requestKey();
    void (async () => {
      try {
        const res = await fetch(`/api/admin/notes/orders/${orderId}/rates`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request_key: key }),
        });
        const json = (await res.json()) as RateResponse & {
          city_confirmation?: { customer_destination: string; courier_destination: string; pin: string; state: string; courier: string; awb: string; rate_paise: number | null } | null;
        };
        const presented = json.quote_session?.options || [];
        setQuotes(presented);
        setSessionId(json.quote_session?.id || null);
        setSelectedKey(explicitCourierSelection(null));
        const pending = json.city_confirmation;
        if (pending?.customer_destination && pending.courier_destination) {
          setCityConfirm({
            customer: pending.customer_destination,
            courierDestination: pending.courier_destination,
            pin: pending.pin,
            state: pending.state,
            courier: pending.courier,
            awb: pending.awb,
            ratePaise: pending.rate_paise || 0,
          });
        }
        const pack = json.package;
        setPackLabel(pack ? `${pack.weight_grams} g · ${pack.length_cm}×${pack.width_cm}×${pack.height_cm} cm` : null);
        if (!json.ok && !presented.length && !pending?.customer_destination) setError(json.error || "No quote available.");
      } catch {
        setError("Could not reach the quote service.");
      } finally {
        setBusy(false);
      }
    })();
  }, [open, orderId, round]);

  const visible = quotes.map((quote) => blockedKeys[quote.key] ? { ...quote, eligible: false, unavailableReason: blockedKeys[quote.key] } : quote);
  const chosen = visible.find((quote) => quote.key === selectedKey && quote.eligible) || null;
  const cost = courierCostNotice(visible);
  const premium = chosen ? selectionPremiumNotice(chosen, quotes) : null;

  function rememberCity(json: {
    customer_destination?: string;
    courier_destination?: string;
    pin?: string;
    state?: string;
    courier?: string;
    awb?: string;
    rate_paise?: number;
  }, fallbackCourier: string, fallbackRate: number) {
    if (!json.customer_destination || !json.courier_destination) return;
    setCityConfirm({
      customer: json.customer_destination,
      courierDestination: json.courier_destination,
      pin: json.pin || "MATCH",
      state: json.state || "MATCH",
      courier: json.courier || fallbackCourier,
      awb: json.awb || "",
      ratePaise: json.rate_paise || fallbackRate,
    });
    setConfirming(false);
  }

  async function confirmCity() {
    if (!cityConfirm || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/notes/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "confirm_city" }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "The courier city could not be confirmed.");
      } else {
        setBooked({
          courier: json.courier || cityConfirm.courier,
          awb: json.awb || cityConfirm.awb,
          ratePaise: json.rate_paise || cityConfirm.ratePaise,
          pickupRequested: Boolean(json.pickup_requested),
          labelUrl: null,
        });
        setCityConfirm(null);
        onBooked();
      }
    } catch {
      setError("The courier city could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }

  async function declineCity() {
    if (!cityConfirm || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/notes/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "decline_city" }),
      });
      const json = await res.json();
      if (!json.ok) setError(json.error || "The shipment could not be released.");
      else setCityConfirm(null);
    } catch {
      setError("The shipment could not be released.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmBook() {
    if (!chosen || !sessionId || !writesAuthorized || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Only the saved option is sent. The server takes courier and price from it.
      const res = await fetch(`/api/admin/notes/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quote_session_id: sessionId, quote_option_id: chosen.key }),
      });
      const json = await res.json();
      if (json.reason === "quote_expired" || json.reason === "quote_changed" || json.reason === "quote_required") {
        setError(json.error || "Courier rates have expired. Compare Couriers again.");
        setStale(true);
        setConfirming(false);
        setSelectedKey(null);
      } else if (json.city_confirm) {
        rememberCity(json, chosen.courier, chosen.ratePaise);
      } else if (!json.ok) {
        setError(json.error || `${chosen.courier} could not be booked.`);
        if (json.reason === "destination_mismatch") {
          setBlockedKeys((current) => ({ ...current, [chosen.key]: "Unavailable — destination mismatch" }));
        }
        setConfirming(false);
        setSelectedKey(null);
      } else {
        setBooked({
          courier: json.courier || chosen.courier,
          awb: json.awb,
          ratePaise: json.rate_paise || chosen.ratePaise,
          pickupRequested: Boolean(json.pickup_requested),
          labelUrl: typeof json.label_url === "string" ? json.label_url : null,
        });
        onBooked();
      }
    } catch {
      setError(`${chosen.courier} could not be booked.`);
      setConfirming(false);
      setSelectedKey(null);
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Compare couriers</p>
            <h2 className="mt-1 font-heading text-2xl font-bold text-[var(--ca-navy)]">Select a courier</h2>
            {packLabel && <p className="mt-1 text-sm text-[var(--ca-navy)]/70">Package {packLabel}</p>}
          </div>
          <button type="button" onClick={onClose} className="min-h-11 px-2 text-sm text-[var(--ca-navy)]/60">Close</button>
        </div>

        {cityConfirm && !booked && (
          <div className="mt-4 rounded-2xl bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Before pickup</p>
            <h2 className="mt-1 font-heading text-xl font-bold text-[var(--ca-navy)]">COURIER ADDRESS CONFIRMATION</h2>
            <p className="mt-1 text-sm text-[var(--ca-navy)]/70">
              {cityConfirm.courier}{cityConfirm.ratePaise > 0 ? ` · ${formatPaise(cityConfirm.ratePaise)}` : ""}
            </p>
            <dl className="mt-3 space-y-2 text-sm text-[var(--ca-navy)]">
              <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-navy)]/50">Customer destination</dt><dd>{cityConfirm.customer}</dd></div>
              <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-navy)]/50">Courier destination</dt><dd>{cityConfirm.courierDestination}</dd></div>
              <div className="flex justify-between gap-3"><dt>PIN</dt><dd className="font-semibold">{cityConfirm.pin}</dd></div>
              <div className="flex justify-between gap-3"><dt>State</dt><dd className="font-semibold">{cityConfirm.state}</dd></div>
            </dl>
            <p className="mt-3 text-sm text-[var(--ca-navy)]/70">Only this courier city is confirmed. The customer address stays as entered.</p>
            {error && <p className="mt-3 text-sm text-red-800">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" disabled={busy} onClick={() => void declineCity()} className="min-h-11 flex-1 rounded-full border text-sm font-semibold">Back</button>
              <button type="button" disabled={busy || !writesAuthorized} onClick={() => void confirmCity()} className="min-h-11 flex-1 rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Confirming…" : "Confirm courier city"}
              </button>
            </div>
          </div>
        )}

        {booked && (
          <div className="mt-4 rounded-2xl bg-white p-4">
            <p className="font-heading text-lg font-bold text-[var(--ca-navy)]">Courier booked</p>
            <dl className="mt-3 space-y-1 text-sm text-[var(--ca-navy)]">
              <div className="flex justify-between gap-3"><dt>Courier</dt><dd className="font-semibold">{booked.courier}</dd></div>
              <div className="flex justify-between gap-3"><dt>AWB</dt><dd className="font-mono text-xs">{booked.awb}</dd></div>
              <div className="flex justify-between gap-3"><dt>Price</dt><dd>{formatPaise(booked.ratePaise)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Pickup</dt><dd>{booked.pickupRequested ? "Requested" : "Not confirmed"}</dd></div>
            </dl>
            {booked.labelUrl && (
              <a href={booked.labelUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white">Print Label</a>
            )}
          </div>
        )}

        {!booked && !cityConfirm && confirming && chosen && (
          <div className="mt-4 rounded-2xl bg-white p-4">
            <p className="text-sm text-[var(--ca-navy)]">Book {chosen.courier} for {formatPaise(chosen.ratePaise)}?</p>
            <p className="mt-2 text-sm text-[var(--ca-navy)]/70">This will create the courier shipment, AWB, label and request pickup.</p>
            {!quoteWithinShippingNotice(chosen.ratePaise) && <p className="mt-2 text-sm text-[var(--ca-navy)]">Shipping exceeds ₹100</p>}
            {premium && <p className="mt-2 rounded-xl bg-[#fbf8f3] px-3 py-2 text-sm text-[var(--ca-navy)]">{premium}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="min-h-11 flex-1 rounded-full border text-sm font-semibold">Cancel</button>
              <button type="button" disabled={busy || !writesAuthorized} onClick={() => void confirmBook()} className="min-h-11 flex-1 rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Booking…" : "Confirm booking"}
              </button>
            </div>
          </div>
        )}

        {!booked && !cityConfirm && !confirming && (
          <>
            {busy && !quotes.length && <div className="mt-4 h-28 animate-pulse rounded-2xl bg-white" />}
            {cost.cheapestPaise != null && !cost.underHundred && (
              <p className="mt-4 text-sm font-semibold text-[var(--ca-navy)]">Lowest available rate is {formatPaise(cost.cheapestPaise)}</p>
            )}
            {!!visible.length && (
              <div className="mt-4 overflow-x-auto rounded-2xl bg-white">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/50">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Courier</th>
                      <th className="px-3 py-2 font-semibold">Provider</th>
                      <th className="px-3 py-2 font-semibold">Mode</th>
                      <th className="px-3 py-2 font-semibold">Price</th>
                      <th className="px-3 py-2 font-semibold">Estimated delivery</th>
                      <th className="px-3 py-2 font-semibold">Serviceability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((quote) => {
                      const selected = chosen?.key === quote.key;
                      return (
                        <tr key={quote.key} className={selected ? "bg-[var(--ca-gold)]/10" : undefined}>
                          <td className="px-3 py-3">
                            <span className="block font-semibold text-[var(--ca-navy)]">{quote.courier}</span>
                            {quote.lowest && quote.eligible && <span className="mt-1 inline-block rounded-full bg-[var(--ca-gold)]/20 px-2 py-0.5 text-[10px] font-semibold text-[var(--ca-gold-dark)]">CHEAPEST</span>}
                          </td>
                          <td className="px-3 py-3">{providerDisplayName(quote.provider)}</td>
                          <td className="px-3 py-3">{quote.service || "—"}</td>
                          <td className="px-3 py-3 tabular-nums">
                            {formatPaise(quote.ratePaise)}
                            {quote.eligible && quoteWithinShippingNotice(quote.ratePaise) && <span className="mt-1 block text-[10px] font-semibold text-[var(--ca-gold-dark)]">UNDER ₹100</span>}
                          </td>
                          <td className="px-3 py-3">{quote.etaText || (quote.etaDays != null ? `${quote.etaDays} days` : "—")}</td>
                          <td className="px-3 py-3">
                            {quote.eligible ? (
                              <button type="button" onClick={() => setSelectedKey(quote.key)} className="min-h-10 rounded-full border px-3 text-xs font-semibold">
                                {selected ? "Selected" : "Select"}
                              </button>
                            ) : (
                              <span className="text-xs text-[var(--ca-navy)]/50">{quote.unavailableReason || "Unavailable"}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {chosen && (
              <div className="mt-4 rounded-2xl bg-white p-4 text-sm text-[var(--ca-navy)]">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-gold-dark)]">Selected courier</p>
                <p className="mt-1 font-semibold">{chosen.courier}</p>
                <p>{formatPaise(chosen.ratePaise)} · {providerDisplayName(chosen.provider)} · {chosen.service || "Surface"}</p>
                <p>{chosen.etaText || (chosen.etaDays != null ? `${chosen.etaDays} days` : "ETA not returned")}</p>
              </div>
            )}
            {error && <p className="mt-3 text-sm text-red-800">{error}</p>}
            {stale && (
              <button type="button" disabled={busy} onClick={() => setRound((n) => n + 1)} className="mt-3 min-h-11 w-full rounded-full border border-[var(--ca-navy)]/20 text-sm font-semibold text-[var(--ca-navy)]">
                Compare couriers again
              </button>
            )}
            <button
              type="button"
              disabled={busy || !chosen || !sessionId || stale || !writesAuthorized}
              onClick={() => setConfirming(true)}
              className="mt-4 min-h-12 w-full rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white disabled:opacity-50"
            >
              {writesAuthorized ? "Book this courier" : "Shipping actions unavailable"}
            </button>
          </>
        )}
        {!booked && !cityConfirm && confirming && error && <p className="mt-3 text-sm text-red-800">{error}</p>}
      </div>
    </div>
  );
}
