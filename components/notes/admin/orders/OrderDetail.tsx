"use client";

import { useEffect, useState } from "react";
import { formatPaise } from "@/lib/store/money";
import {
  PRIMARY_LABEL,
  fulfillmentLabel,
  fulfillmentTone,
  formatAdminWhen,
  hasActiveShipment,
  nextPreparationStatus,
  orderIndexLabel,
  pickupFailedActivity,
  primaryAction,
  volumetricGrams,
  type BadgeTone,
} from "@/lib/store/adminConsole";

interface Address {
  name?: string;
  phone?: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  landmark: string | null;
}

export interface AdminOrder {
  id: string;
  order_no: string;
  status: string;
  customer_name: string;
  phone: string;
  email: string | null;
  total_paise: number;
  subtotal_paise?: number;
  discount_paise?: number;
  shipping_paise?: number;
  promo_code?: string | null;
  discount_trace_json?: { offer_name?: string; discount_type?: string; discount_value?: number } | null;
  payment_status: string | null;
  promised_delivery_date: string | null;
  placed_at: string;
  updated_at?: string | null;
  internal_notes: string | null;
  address: Address | null;
  items: Array<{ name: string; qty: number; sku: string; unit_price_paise?: number; line_total_paise?: number }>;
  action_required?: boolean;
  action_reasons?: string[];
  past_shipments?: Array<{ provider: string | null; courier: string | null; awb: string | null; status: string | null; reason: string | null }>;
  shipment: {
    courier: string | null;
    awb: string | null;
    tracking_url: string | null;
    provider: string | null;
    status: string | null;
    has_label: boolean;
    pickup_scheduled_at: string | null;
    pickup_date?: string | null;
    pickup_status?: string | null;
    tracking_activity?: string | null;
    tracking_event_at?: string | null;
    tracking_location?: string | null;
    pickup_reference?: string | null;
    pickup_time?: string | null;
    address_mismatch?: boolean;
    weight_grams?: number | null;
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
    package_source?: string | null;
  } | null;
  issue?: {
    id: string;
    reference: string;
    category_label: string;
    status: string;
    status_label: string;
    description: string;
    created_at: string;
    customer_note: string | null;
    admin_note: string | null;
    callback_requested: boolean;
    open: boolean;
  } | null;
}

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-[var(--ca-navy)]/5 text-[var(--ca-navy)]",
  navy: "bg-[var(--ca-navy)] text-white",
  gold: "bg-[var(--ca-gold)]/25 text-[var(--ca-gold-dark)]",
  amber: "bg-amber-100 text-amber-950",
  green: "bg-emerald-50 text-emerald-900",
  red: "bg-red-50 text-red-900",
};

function Badge({ children, tone }: { children: string; tone: BadgeTone }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONE[tone]}`}>{children}</span>;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-navy)]/45">{label}</dt>
      <dd className="mt-1 text-sm text-[var(--ca-navy)]">{value || "—"}</dd>
    </div>
  );
}

export default function OrderDetail({
  order,
  busy,
  writesAuthorized,
  onClose,
  onRefresh,
  onCompare,
  act,
}: {
  order: AdminOrder;
  busy: boolean;
  writesAuthorized: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onCompare: () => void;
  act: (fn: () => Promise<Response>, ok: string) => void;
}) {
  const ship = order.shipment;
  const active = hasActiveShipment(ship?.status, ship?.awb);
  const failed = pickupFailedActivity(ship?.tracking_activity);
  const queued = ship?.pickup_status === "already_in_pickup_queue" || ship?.pickup_status === "reattempt_requested";
  const action = primaryAction({
    status: order.status,
    awb: ship?.awb,
    pickupFailed: failed,
    addressMismatch: ship?.address_mismatch,
    openIssue: order.issue?.open,
    paymentPending: order.status === "PAYMENT_PENDING",
  });
  const [advanced, setAdvanced] = useState(false);
  const [history, setHistory] = useState(false);
  const [packEdit, setPackEdit] = useState(false);
  const [weight, setWeight] = useState(String(ship?.weight_grams || ""));
  const [length, setLength] = useState(String(ship?.length_cm || ""));
  const [width, setWidth] = useState(String(ship?.width_cm || ""));
  const [height, setHeight] = useState(String(ship?.height_cm || ""));
  const [awb, setAwb] = useState("");
  const [courier, setCourier] = useState("");
  const [note, setNote] = useState("");
  const [issueStatus, setIssueStatus] = useState(order.issue?.status || "OPEN");
  const [issueAdmin, setIssueAdmin] = useState("");
  const [issueCustomer, setIssueCustomer] = useState("");
  const [confirmAdvance, setConfirmAdvance] = useState(false);
  const [events, setEvents] = useState<Array<{ id: string; event: string; created_at: string; actor_name?: string | null }>>([]);
  const [scans, setScans] = useState<Array<{ activity?: string; time?: string; location?: string }>>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setIssueStatus(order.issue?.status || "OPEN");
    setWeight(String(ship?.weight_grams || ""));
    setLength(String(ship?.length_cm || ""));
    setWidth(String(ship?.width_cm || ""));
    setHeight(String(ship?.height_cm || ""));
  }, [order.id, order.issue?.status, ship?.weight_grams, ship?.length_cm, ship?.width_cm, ship?.height_cm]);

  useEffect(() => {
    void fetch(`/api/admin/notes/orders/${order.id}/activity`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => setEvents(json.events || []))
      .catch(() => setEvents([]));
  }, [order.id, order.updated_at, order.status]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied");
      window.setTimeout(() => setToast(null), 1200);
    } catch {
      setToast("Copy failed");
    }
  }

  function runPrimary() {
    if (action === "reconcile") {
      act(() => fetch(`/api/admin/notes/orders/${order.id}/reconcile`, { method: "POST" }), "Payment rechecked with the gateway");
    } else if (action === "prepare" || action === "pack") {
      setConfirmAdvance(true);
    } else if (action === "compare") onCompare();
    else if (action === "label") void printLabel();
    else if (action === "resolve_pickup" || action === "tracking") void refreshTrack();
    else if (action === "review_issue") document.getElementById("customer-issue")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function printLabel() {
    const res = await fetch(`/api/admin/notes/orders/${order.id}/label`, { cache: "no-store" });
    const json = await res.json();
    if (json.ok && typeof json.url === "string" && /^https?:\/\//.test(json.url)) window.open(json.url, "_blank", "noopener");
    else setToast(json.error || "No label is stored for this order.");
  }

  async function refreshTrack() {
    const res = await fetch(`/api/admin/notes/orders/${order.id}/track`, { cache: "no-store" });
    const json = await res.json();
    setScans(json.activities || []);
    setToast(json.activity || json.raw_status || json.error || "Tracking refreshed");
    onRefresh();
  }

  const address = order.address;
  const addressLine = address
    ? [address.line1, address.line2, address.landmark, `${address.city}, ${address.state} ${address.pincode}`].filter(Boolean).join(", ")
    : "";
  const vol = volumetricGrams(Number(length), Number(width), Number(height));
  const next = nextPreparationStatus(order.status);
  const reasons = order.action_reasons || [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[var(--ca-navy)]/30">
      <button type="button" aria-label="Close order" className="hidden flex-1 sm:block" onClick={onClose} />
      <article className="h-full w-full overflow-y-auto bg-[#f7f5ef] pb-28 sm:max-w-xl">
        <header className="sticky top-0 z-10 border-b border-[var(--ca-navy)]/10 bg-[#fbfaf6]/95 px-4 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-heading text-xl font-bold text-[var(--ca-navy)]">{orderIndexLabel(order.order_no)}</p>
              <p className="font-mono text-xs text-[var(--ca-navy)]/60">{order.order_no}</p>
              <p className="mt-1 text-sm font-semibold text-[var(--ca-navy)]">{order.customer_name}</p>
            </div>
            <div className="text-right">
              <p className="font-heading text-lg font-bold tabular-nums text-[var(--ca-navy)]">{formatPaise(order.total_paise)}</p>
              <button type="button" onClick={onClose} className="mt-1 min-h-11 text-sm text-[var(--ca-navy)]/60">Close</button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {order.payment_status && <Badge tone={order.payment_status === "CAPTURED" ? "green" : "neutral"}>{order.payment_status}</Badge>}
            <Badge tone={fulfillmentTone(order.status, failed)}>{fulfillmentLabel(order.status, failed)}</Badge>
          </div>
        </header>

        <div className="space-y-3 px-4 py-4">
          {reasons.length > 0 && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-950">Action required</p>
              <ul className="mt-1 text-sm text-amber-950/80">
                {reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </section>
          )}

          {failed && (
            <section className="rounded-2xl border border-amber-300 bg-white p-4">
              <p className="font-heading text-lg font-bold text-[var(--ca-navy)]">Pickup wasn't completed</p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ca-navy)]/75">
                {ship?.courier || "The courier"} last reported “{ship?.tracking_activity}”
                {ship?.tracking_event_at ? ` on ${formatAdminWhen(ship.tracking_event_at)}` : ""}.
                {queued ? " The parcel remains in the courier pickup queue." : " Collection needs a follow-up."}
              </p>
              {queued && <p className="mt-2 text-sm font-medium text-[var(--ca-navy)]">No new pickup has been booked.</p>}
              <button type="button" onClick={() => void refreshTrack()} className="mt-3 min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white">
                Check latest status
              </button>
            </section>
          )}

          {active && ship && (
            <section className="rounded-2xl bg-white p-4 ns-elev-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Active shipment</p>
              <h2 className="mt-1 font-heading text-xl font-bold text-[var(--ca-navy)]">{ship.courier || ship.provider}</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4">
                <Field label="AWB" value={ship.awb} />
                <Field label="Status" value={ship.tracking_activity || ship.status} />
                <Field label="Latest update" value={formatAdminWhen(ship.tracking_event_at)} />
                <Field label="Pickup" value={queued ? "Still in courier queue" : ship.pickup_date || "Not scheduled"} />
                <Field label="Reference" value={ship.pickup_reference} />
                <Field label="Destination" value={address ? `${address.city} · ${address.pincode}` : null} />
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {ship.has_label && (
                  <button type="button" onClick={() => void printLabel()} className="min-h-11 rounded-full border border-[var(--ca-navy)]/15 px-4 text-sm font-semibold text-[var(--ca-navy)]">
                    Print label
                  </button>
                )}
                <button type="button" onClick={() => void refreshTrack()} className="min-h-11 rounded-full border border-[var(--ca-navy)]/15 px-4 text-sm font-semibold text-[var(--ca-navy)]">
                  View tracking
                </button>
              </div>
            </section>
          )}

          {!active && (order.status === "PACKED" || order.status === "READY_FOR_PICKUP") && (
            <section className="rounded-2xl bg-white p-4">
              <p className="font-semibold text-[var(--ca-navy)]">Packed and ready to book a courier.</p>
              <button type="button" onClick={onCompare} className="mt-3 min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white">
                Compare couriers
              </button>
            </section>
          )}

          <section className="rounded-2xl bg-white p-4">
            <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Customer</h2>
            <dl className="mt-3 grid grid-cols-1 gap-3">
              <Field label="Name" value={order.customer_name} />
              <Field label="Phone" value={order.phone} />
              <Field label="Email" value={order.email} />
            </dl>
            <h3 className="mt-4 text-sm font-semibold text-[var(--ca-navy)]">Shipping</h3>
            <p className="mt-1 text-sm leading-relaxed text-[var(--ca-navy)]/80">{addressLine || "No address"}</p>
            <div className="mt-3 flex gap-2">
              <button type="button" aria-label="Copy address" onClick={() => copy(addressLine)} className="min-h-11 rounded-full border px-3 text-xs font-semibold">Copy address</button>
              <button type="button" aria-label="Copy phone" onClick={() => copy(order.phone)} className="min-h-11 rounded-full border px-3 text-xs font-semibold">Copy phone</button>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-4">
            <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Items and payment</h2>
            <ul className="mt-3 divide-y">
              {order.items.map((item) => (
                <li key={item.sku + item.name} className="flex justify-between py-2 text-sm">
                  <span>{item.name} <span className="text-[var(--ca-navy)]/50">× {item.qty}</span></span>
                  <span className="tabular-nums">{typeof item.line_total_paise === "number" ? formatPaise(item.line_total_paise) : ""}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-2 space-y-1 text-sm text-[var(--ca-navy)]/70">
              {order.subtotal_paise != null && <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatPaise(order.subtotal_paise)}</dd></div>}
              {(order.discount_paise || 0) > 0 && (
                <div className="flex justify-between"><dt>{order.discount_trace_json?.offer_name || order.promo_code || "Offer"}</dt><dd>− {formatPaise(order.discount_paise || 0)}</dd></div>
              )}
              {(order.shipping_paise || 0) > 0 && <div className="flex justify-between"><dt>Shipping</dt><dd>{formatPaise(order.shipping_paise || 0)}</dd></div>}
              <div className="flex justify-between font-semibold text-[var(--ca-navy)]"><dt>Total</dt><dd>{formatPaise(order.total_paise)}</dd></div>
            </dl>
          </section>

          <section className="rounded-2xl bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Package</h2>
              <button type="button" onClick={() => setPackEdit((v) => !v)} className="min-h-11 text-sm font-semibold text-[var(--ca-navy)]">{packEdit ? "Close" : "Edit"}</button>
            </div>
            {!packEdit && (
              <p className="mt-2 text-sm text-[var(--ca-navy)]">
                {ship?.weight_grams ? `${ship.weight_grams} g` : "Weight not saved"}
                {ship?.length_cm ? ` · ${ship.length_cm} × ${ship.width_cm} × ${ship.height_cm} cm` : ""}
                {ship?.package_source === "STAFF_OVERRIDE" ? " · Source: order override" : ship?.package_source === "PRODUCT_PROFILE" ? " · Source: product default profile" : ""}
                {vol ? ` · Volumetric ${vol} g` : ""}
              </p>
            )}
            {packEdit && (
              <form
                className="mt-3 grid grid-cols-2 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(
                    () => fetch(`/api/admin/notes/orders/${order.id}/pack`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ weight_grams: Number(weight), length_cm: Number(length), width_cm: Number(width), height_cm: Number(height) }),
                    }),
                    "Package saved. No courier was booked.",
                  );
                }}
              >
                <label className="text-xs">Weight (g)<input value={weight} onChange={(e) => setWeight(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border px-2" /></label>
                <label className="text-xs">Length<input value={length} onChange={(e) => setLength(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border px-2" /></label>
                <label className="text-xs">Width<input value={width} onChange={(e) => setWidth(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border px-2" /></label>
                <label className="text-xs">Height<input value={height} onChange={(e) => setHeight(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border px-2" /></label>
                <button type="submit" disabled={busy} className="col-span-2 min-h-11 rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white">Save package</button>
              </form>
            )}
          </section>

          {(order.past_shipments || []).length > 0 && (
            <section className="rounded-2xl bg-white p-4">
              <button type="button" onClick={() => setHistory((v) => !v)} className="flex min-h-11 w-full items-center justify-between text-left">
                <span className="font-heading text-lg font-bold text-[var(--ca-navy)]">Shipment history</span>
                <span className="text-sm text-[var(--ca-navy)]/50">{history ? "Hide" : "Show"}</span>
              </button>
              {history && (
                <ul className="mt-2 space-y-3">
                  {order.past_shipments?.map((past) => (
                    <li key={past.awb || past.courier} className="text-sm text-[var(--ca-navy)]/70">
                      <p className="font-semibold text-[var(--ca-navy)]">{past.courier || past.provider}</p>
                      <p className="font-mono text-xs">{past.awb}</p>
                      <p>{past.status}{past.reason ? ` · ${past.reason.replaceAll("_", " ")}` : ""}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {scans.length > 0 && (
            <section className="rounded-2xl bg-white p-4">
              <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Tracking history</h2>
              <ol className="mt-3 space-y-3">
                {scans.map((scan, i) => (
                  <li key={i}>
                    <p className="text-xs text-[var(--ca-navy)]/50">{formatAdminWhen(scan.time) || scan.time}</p>
                    <p className="text-sm font-semibold text-[var(--ca-navy)]">{scan.activity}</p>
                    {scan.location && <p className="text-xs text-[var(--ca-navy)]/60">{scan.location}</p>}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section id="customer-issue" className="rounded-2xl bg-white p-4">
            <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Customer issue</h2>
            {!order.issue && <p className="mt-2 text-sm text-[var(--ca-navy)]/60">No customer issues.</p>}
            {order.issue && (
              <div className="mt-3">
                <p className="text-sm font-semibold text-[var(--ca-navy)]">{order.issue.reference} · {order.issue.category_label}</p>
                <p className="mt-1 text-xs text-[var(--ca-navy)]/55">{order.issue.status_label} · {formatAdminWhen(order.issue.created_at)}</p>
                <p className="mt-2 text-sm leading-relaxed">{order.issue.description}</p>
                <select value={issueStatus} onChange={(e) => setIssueStatus(e.target.value)} className="mt-3 min-h-11 w-full rounded-xl border px-2 text-sm">
                  <option value="OPEN">Issue received</option>
                  <option value="IN_REVIEW">In review</option>
                  <option value="WAITING_ON_TEAM">With the team</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="CLOSED">Closed</option>
                </select>
                <textarea value={issueAdmin} onChange={(e) => setIssueAdmin(e.target.value)} placeholder="Internal note" rows={2} className="mt-2 w-full rounded-xl border px-3 py-2 text-sm" />
                <textarea value={issueCustomer} onChange={(e) => setIssueCustomer(e.target.value)} placeholder="Note the student will see" rows={2} className="mt-2 w-full rounded-xl border px-3 py-2 text-sm" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(() => fetch(`/api/admin/notes/orders/${order.id}/issues`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ issue_id: order.issue?.id, status: issueStatus, admin_note: issueAdmin, customer_note: issueCustomer }),
                  }), "Issue updated")}
                  className="mt-2 min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white"
                >
                  Update issue
                </button>
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-white p-4">
            <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Activity</h2>
            {events.length === 0 && <p className="mt-2 text-sm text-[var(--ca-navy)]/60">No activity recorded yet.</p>}
            <ol className="mt-3 space-y-2">
              {events.map((event) => (
                <li key={event.id} className="text-sm">
                  <span className="text-[var(--ca-navy)]/50">{formatAdminWhen(event.created_at)}</span>
                  <span className="ml-2 font-medium text-[var(--ca-navy)]">{event.event.replaceAll("_", " ")}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-2xl border border-dashed border-[var(--ca-navy)]/15 p-4">
            <button type="button" onClick={() => setAdvanced((v) => !v)} className="min-h-11 text-sm font-semibold text-[var(--ca-navy)]">
              {advanced ? "Hide advanced" : "Advanced"}
            </button>
            {advanced && (
              <div className="mt-3 space-y-3 text-sm">
                <p className="text-[var(--ca-navy)]/70">Manual shipping overrides should only be used when provider integration cannot be used. This does not book a courier by itself.</p>
                {!writesAuthorized && <p className="text-xs text-[var(--ca-navy)]/50">Live shipping writes disabled.</p>}
                <div className="grid grid-cols-2 gap-2">
                  <input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="Courier" className="min-h-11 rounded-xl border px-2" />
                  <input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="AWB" className="min-h-11 rounded-xl border px-2 font-mono" />
                </div>
                <button
                  type="button"
                  disabled={busy || !awb.trim()}
                  onClick={() => act(() => fetch(`/api/admin/notes/orders/${order.id}/ship`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ awb, courier_name: courier || "Manual" }),
                  }), "Marked shipped — stock deducted")}
                  className="min-h-11 rounded-full border px-4 text-sm font-semibold"
                >
                  Mark shipped
                </button>
                {next && (
                  <div>
                    <p>Next preparation step: {next.replaceAll("_", " ")}. This does not mark the order shipped.</p>
                    {!confirmAdvance ? (
                      <button type="button" onClick={() => setConfirmAdvance(true)} className="mt-2 min-h-11 rounded-full border px-4 text-sm">Override fulfillment status</button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => act(() => fetch(`/api/admin/notes/orders/${order.id}/advance`, { method: "POST" }), `Moved to ${next.replaceAll("_", " ")}`)}
                        className="mt-2 min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white"
                      >
                        Confirm move to {next.replaceAll("_", " ")}
                      </button>
                    )}
                  </div>
                )}
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Internal note" className="w-full rounded-xl border px-3 py-2" />
                <button
                  type="button"
                  disabled={busy || !note.trim()}
                  onClick={() => act(() => fetch(`/api/admin/notes/orders/${order.id}/note`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ note }),
                  }), "Note saved")}
                  className="min-h-11 rounded-full border px-4 text-sm"
                >
                  Save note
                </button>
              </div>
            )}
          </section>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--ca-navy)]/10 bg-[#fbfaf6] p-3 sm:max-w-xl sm:left-auto">
          <button type="button" disabled={busy} onClick={runPrimary} className="min-h-12 w-full rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white">
            {PRIMARY_LABEL[action]}
          </button>
          {toast && <p className="mt-1 text-center text-xs text-[var(--ca-navy)]/70">{toast}</p>}
        </div>
      </article>
    </div>
  );
}
