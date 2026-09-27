"use client";

import { useMemo, useState } from "react";
import { addressFingerprint, canonicalDelivery, formatDeliveryAddress, googleMapsSearchUrl, materialAddressChange } from "@/lib/store/deliveryAddress";

interface CurrentAddress {
  name?: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  confirmation_status?: string | null;
  address_hash?: string | null;
}

const REASONS = [
  ["customer_requested", "Customer requested correction"],
  ["typing_error", "Typing error"],
  ["courier_correction", "Courier correction"],
  ["internal", "Internal correction"],
  ["other", "Other"],
];

export default function ChangeDeliveryAddress({
  orderId,
  current,
  shipmentStatus,
  onClose,
  onSaved,
}: {
  orderId: string;
  current: CurrentAddress | null;
  shipmentStatus: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: current?.name || "",
    line1: current?.line1 || "",
    line2: current?.line2 || "",
    landmark: current?.landmark || "",
    pincode: current?.pincode || "",
    city: current?.city || "",
    state: current?.state || "",
    reason: "customer_requested",
    customerConfirmed: false,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [needsRebook, setNeedsRebook] = useState(false);
  const [busy, setBusy] = useState(false);
  const next = canonicalDelivery(form);
  const currentFields = canonicalDelivery({
    line1: current?.line1 || "",
    line2: current?.line2,
    landmark: current?.landmark,
    city: current?.city || "",
    state: current?.state || "",
    pincode: current?.pincode || "",
  });
  const material = materialAddressChange(currentFields, next);
  const mapsUrl = googleMapsSearchUrl(formatDeliveryAddress({ ...next, name: form.name }));
  const changes = useMemo(() => {
    const rows = [
      ["Street", current?.line1 || "", form.line1],
      ["Locality", current?.line2 || "", form.line2],
      ["PIN", current?.pincode || "", form.pincode],
      ["City", current?.city || "", form.city],
      ["State", current?.state || "", form.state],
    ];
    return rows.filter(([, from, to]) => from.trim() !== to.trim());
  }, [current, form]);

  async function save(confirmRebook: boolean, recordRequest: boolean) {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/notes/orders/address", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        order_id: orderId,
        ...form,
        customer_confirmed: form.customerConfirmed,
        confirm_rebook: confirmRebook,
        record_request: recordRequest,
        expected_hash: current?.address_hash || addressFingerprint(currentFields),
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (json.code === "CONFIRM_REBOOK" || json.code === "ACTIVE_AWB") {
      setNeedsRebook(true);
      setMessage(json.message);
      return;
    }
    setMessage(json.message || json.error || "Could not update the address.");
    if (json.ok) onSaved();
  }

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((value) => ({ ...value, [key]: event.target.value }));

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[var(--ca-navy)]/30 sm:items-center">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-[#f7f5ef] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Delivery address</p>
            <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">Change delivery address</h2>
          </div>
          <button type="button" onClick={onClose} className="min-h-11 text-sm text-[var(--ca-navy)]/60">Close</button>
        </div>
        <p className="mt-3 whitespace-pre-line text-sm text-[var(--ca-navy)]/75">{current ? formatDeliveryAddress({ ...currentFields, name: current.name }) : "No address"}</p>
        <div className="mt-4 grid gap-2">
          <label className="text-sm">Name<input className="mt-1 min-h-11 w-full rounded-xl border px-3" value={form.name} onChange={set("name")} /></label>
          <label className="text-sm">Address line 1<input className="mt-1 min-h-11 w-full rounded-xl border px-3" value={form.line1} onChange={set("line1")} /></label>
          <label className="text-sm">Locality<input className="mt-1 min-h-11 w-full rounded-xl border px-3" value={form.line2} onChange={set("line2")} /></label>
          <label className="text-sm">Landmark<input className="mt-1 min-h-11 w-full rounded-xl border px-3" value={form.landmark} onChange={set("landmark")} /></label>
          <label className="text-sm">PIN<input className="mt-1 min-h-11 w-full rounded-xl border px-3" inputMode="numeric" maxLength={6} value={form.pincode} onChange={set("pincode")} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">City<input className="mt-1 min-h-11 w-full rounded-xl border px-3" value={form.city} onChange={set("city")} /></label>
            <label className="text-sm">State<input className="mt-1 min-h-11 w-full rounded-xl border px-3" value={form.state} onChange={set("state")} /></label>
          </div>
          <label className="text-sm">Reason
            <select className="mt-1 min-h-11 w-full rounded-xl border px-3" value={form.reason} onChange={set("reason")}>
              {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm text-[var(--ca-navy)]/80">
            <input type="checkbox" className="mt-1" checked={form.customerConfirmed} onChange={(event) => setForm((value) => ({ ...value, customerConfirmed: event.target.checked }))} />
            <span>Student confirmed this new delivery address</span>
          </label>
        </div>
        {changes.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-[var(--ca-navy)]">
            {changes.map(([label, from, to]) => <li key={label}>{label}: {from || "—"} → {to || "—"}</li>)}
          </ul>
        )}
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ca-navy)]">Open new address in Google Maps</a>
        {message && <p className="mt-3 text-sm text-[var(--ca-navy)]" role="status">{message}</p>}
        {shipmentStatus && <p className="mt-2 text-xs text-[var(--ca-navy)]/50">Shipment: {shipmentStatus}{material ? " · PIN, city, or state changed" : ""}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-full border px-4 text-sm font-semibold">Cancel</button>
          {needsRebook ? (
            <button type="button" disabled={busy} onClick={() => void save(true, false)} className="min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white disabled:opacity-50">Change address and rebook</button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void save(false, shipmentStatus === "picked_up" || shipmentStatus === "in_transit" || shipmentStatus === "out_for_delivery")} className="min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white disabled:opacity-50">Save address</button>
          )}
        </div>
      </div>
    </div>
  );
}
