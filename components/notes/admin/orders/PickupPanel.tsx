"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, MessageCircle, Phone } from "lucide-react";
import { formatAdminWhen } from "@/lib/store/adminConsole";
import { readyAge } from "@/lib/store/fulfillment";
import { readyForCollectionMessage, type PickupLocationSnapshot } from "@/lib/store/pickupLocation";

export interface AdminPickupFacts {
  location: PickupLocationSnapshot | null;
  acknowledged_at: string | null;
  ready_at: string | null;
  ready_by: string | null;
  collected_at: string | null;
  collected_by: string | null;
}

function digits10(phone: string): string {
  return String(phone || "").replace(/\D/g, "").slice(-10);
}

const AGE_TONE = {
  neutral: "text-[var(--ca-navy)]/60",
  amber: "text-amber-900",
  strong: "font-semibold text-amber-950",
} as const;

/**
 * Academy Pickup operations panel: where, who, which stage, and the handover.
 * Location comes from the order's frozen snapshot, never today's config.
 */
export default function PickupPanel({
  order,
  pickup,
  canManage,
  busy,
  onCopy,
  onCollect,
  confirmRequest = 0,
}: {
  order: { order_no: string; status: string; customer_name: string; phone: string; items: Array<{ name: string; qty: number }> };
  pickup: AdminPickupFacts | null;
  canManage: boolean;
  busy: boolean;
  onCopy: (text: string, label: string) => void;
  onCollect: () => void;
  /** Increment to open the handover dialog from elsewhere (the bottom action bar). */
  confirmRequest?: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const location = pickup?.location || null;
  const ready = order.status === "READY_FOR_COLLECTION";
  const collected = order.status === "COLLECTED";
  const age = ready ? readyAge(pickup?.ready_at) : null;
  const phone = digits10(order.phone);
  const message = readyForCollectionMessage(order.order_no, location);

  useEffect(() => {
    if (confirmRequest > 0 && order.status === "READY_FOR_COLLECTION") setConfirming(true);
  }, [confirmRequest, order.status]);

  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  return (
    <section className="rounded-2xl border border-[var(--ca-gold-dark)]/25 bg-white p-4 ns-elev-1" aria-labelledby="pickup-panel-title">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Collection</p>
      <h2 id="pickup-panel-title" className="mt-1 font-heading text-xl font-bold text-[var(--ca-navy)]">Academy Pickup</h2>

      <div className="mt-3 flex items-start gap-2 text-sm text-[var(--ca-navy)]/80">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {location ? (
          <p>
            <span className="font-semibold text-[var(--ca-navy)]">{location.name}</span>
            <span className="block">{location.address_lines.join(", ")}</span>
            {location.maps_url && (
              <a href={location.maps_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ca-navy)] underline decoration-[var(--ca-gold)] underline-offset-4">
                View academy on Google Maps ↗
              </a>
            )}
          </p>
        ) : (
          <p>Pickup location unavailable</p>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-navy)]/45">Customer confirmed collection</dt>
          <dd className="mt-1 text-sm text-[var(--ca-navy)]">{formatAdminWhen(pickup?.acknowledged_at) || "—"}</dd>
        </div>
        {(ready || collected) && (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-navy)]/45">Ready since</dt>
            <dd className="mt-1 text-sm text-[var(--ca-navy)]">
              {formatAdminWhen(pickup?.ready_at) || "—"}
              {pickup?.ready_by ? ` · by ${pickup.ready_by}` : ""}
              {age && <span className={`block text-xs ${AGE_TONE[age.tone]}`}>{age.label}</span>}
            </dd>
          </div>
        )}
        {collected && (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-navy)]/45">Collected</dt>
            <dd className="mt-1 text-sm text-[var(--ca-navy)]">
              {formatAdminWhen(pickup?.collected_at) || "—"}
              {pickup?.collected_by && <span className="block text-xs text-[var(--ca-navy)]/60">Handed over by {pickup.collected_by}</span>}
            </dd>
          </div>
        )}
      </dl>

      {ready && (
        <>
          <p className="mt-4 text-sm text-[var(--ca-navy)]/70">Contact the customer and keep the order at the academy.</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {phone.length === 10 && (
              <a href={`tel:+91${phone}`} className="ca-focus inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[var(--ca-navy)]/15 px-4 text-sm font-semibold text-[var(--ca-navy)]">
                <Phone className="h-4 w-4" aria-hidden /> Call customer
              </a>
            )}
            {phone.length === 10 && (
              <a
                href={`https://wa.me/91${phone}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ca-focus inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[var(--ca-navy)]/15 px-4 text-sm font-semibold text-[var(--ca-navy)]"
              >
                <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
              </a>
            )}
            <button type="button" onClick={() => onCopy(message, "Ready message copied")} className="ca-focus min-h-11 rounded-full border border-[var(--ca-navy)]/15 px-4 text-sm font-semibold text-[var(--ca-navy)]">
              Copy ready message
            </button>
            <button type="button" onClick={() => onCopy(order.order_no, "Order number copied")} className="ca-focus min-h-11 rounded-full border border-[var(--ca-navy)]/15 px-4 text-sm font-semibold text-[var(--ca-navy)]">
              Copy order number
            </button>
          </div>
          {canManage && (
            <div className="mt-5 border-t border-[var(--ca-navy)]/10 pt-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(true)}
                className="ca-focus min-h-12 w-full rounded-full bg-[var(--ca-navy)] px-5 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
              >
                Mark collected
              </button>
            </div>
          )}
        </>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ca-navy)]/40 p-3 sm:items-center" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="collect-title" className="w-full max-w-md rounded-3xl bg-white p-5 ns-elev-4">
            <h3 id="collect-title" className="font-heading text-lg font-bold text-[var(--ca-navy)]">
              Hand over order {order.order_no} to {order.customer_name}?
            </h3>
            <p className="mt-2 text-sm text-[var(--ca-navy)]/75">Confirm the order number and registered mobile with the customer.</p>
            <dl className="mt-3 space-y-1 rounded-2xl bg-[#f7f5ef] p-3 text-sm text-[var(--ca-navy)]">
              <div className="flex justify-between gap-3"><dt className="text-[var(--ca-navy)]/60">Order</dt><dd className="font-mono">{order.order_no}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[var(--ca-navy)]/60">Customer</dt><dd>{order.customer_name}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[var(--ca-navy)]/60">Registered mobile</dt><dd className="tabular-nums">{order.phone}</dd></div>
              <div className="pt-1">
                <dt className="text-[var(--ca-navy)]/60">Items</dt>
                <dd>
                  <ul className="mt-1">
                    {order.items.map((item) => (
                      <li key={item.name}>{item.name} × {item.qty}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-sm font-medium text-[var(--ca-navy)]">Confirm the customer is collecting this order now.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button ref={cancelRef} type="button" onClick={() => setConfirming(false)} className="ca-focus min-h-11 rounded-full border px-4 text-sm font-semibold">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  onCollect();
                }}
                className="ca-focus min-h-11 rounded-full bg-[var(--ca-navy)] px-5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Yes, collected
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
