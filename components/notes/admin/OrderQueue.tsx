"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/admin/ui";
import CourierQuotes from "@/components/notes/admin/CourierQuotes";
import { formatPaise } from "@/lib/store/money";

interface Address {
  name?: string;
  phone?: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  landmark: string | null;
  delivery_instructions?: string | null;
}

interface Row {
  id: string;
  order_no: string;
  status: string;
  customer_name: string;
  phone: string;
  email: string | null;
  total_paise: number;
  discount_paise?: number;
  promo_code?: string | null;
  discount_trace_json?: {
    offer_name?: string;
    discount_type?: string;
    discount_value?: number;
    discount_amount?: number;
  } | null;
  payment_status: string | null;
  promised_delivery_date: string | null;
  placed_at: string;
  internal_notes: string | null;
  address: Address | null;
  items: Array<{ name: string; qty: number; sku: string; unit_price_paise?: number; line_total_paise?: number }>;
  shipment: {
    courier: string | null;
    awb: string | null;
    tracking_url: string | null;
    provider: string | null;
    status: string | null;
    has_label: boolean;
    pickup_scheduled_at: string | null;
    weight_grams?: number | null;
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
  } | null;
  attention?: string[];
}

const BUCKETS = [
  { key: "", label: "All" },
  { key: "new", label: "New" },
  { key: "preparing", label: "Preparing" },
  { key: "packed", label: "Packed" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
  { key: "problem", label: "Problem" },
  { key: "cancelled", label: "Cancelled" },
];

const EXCEPTIONS = [
  { value: "damaged", label: "Damaged notes" },
  { value: "wrong_subject", label: "Wrong subject" },
  { value: "missing_item", label: "Missing product" },
  { value: "incomplete_pages", label: "Incomplete pages" },
  { value: "print_defect", label: "Print defect" },
  { value: "delivery_problem", label: "Delivery issue" },
  { value: "lost_in_transit", label: "Lost in transit" },
  { value: "duplicate_order", label: "Duplicate order" },
];

const REFUNDABLE = new Set(["DELIVERED", "DELIVERY_FAILED", "RETURN_APPROVED", "RETURN_RECEIVED", "RTO_DELIVERED"]);

function formatAddress(a: Address | null): string {
  if (!a) return "—";
  return [a.line1, a.line2, a.landmark, `${a.city}, ${a.state} ${a.pincode}`].filter(Boolean).join(", ");
}

function courierBlock(o: Row): string {
  const a = o.address;
  return [
    o.customer_name,
    o.phone,
    a?.line1,
    a?.line2,
    a?.landmark,
    a ? `${a.city}, ${a.state} - ${a.pincode}` : "",
    `Order ${o.order_no}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export default function NotesOrderQueue() {
  const [orders, setOrders] = useState<Row[]>([]);
  const [bucket, setBucket] = useState("");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [awb, setAwb] = useState<Record<string, string>>({});
  const [courier, setCourier] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [exc, setExc] = useState<Record<string, string>>({});
  const [pickupDate, setPickupDate] = useState<Record<string, string>>({});
  const [refundPaise, setRefundPaise] = useState<Record<string, string>>({});
  const [refundRef, setRefundRef] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const hasRows = useRef(false);

  const load = useCallback(async () => {
    if (!hasRows.current) setLoading(true);
    const params = new URLSearchParams();
    if (bucket) params.set("bucket", bucket);
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/admin/notes/orders?${params}`, { cache: "no-store" });
    const json = await res.json();
    const next = json.orders || [];
    hasRows.current = next.length > 0;
    setOrders(next);
    setLoading(false);
  }, [bucket, q]);

  useEffect(() => {
    void load();
  }, [bucket]); // eslint-disable-line react-hooks/exhaustive-deps

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`${what} copied`);
      setTimeout(() => setMsg(null), 1400);
    } catch {
      setMsg("Copy failed");
    }
  }

  async function act(id: string, fn: () => Promise<Response>, ok: string) {
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fn();
      const json = await res.json();
      setMsg(json.ok ? ok : json.error);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const advance = (id: string) =>
    act(id, () => fetch(`/api/admin/notes/orders/${id}/advance`, { method: "POST", cache: "no-store" }), "Status advanced");

  const ship = (id: string) =>
    act(
      id,
      () =>
        fetch(`/api/admin/notes/orders/${id}/ship`, {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ awb: awb[id], courier_name: courier[id] || "Manual" }),
        }),
      "Marked shipped — stock deducted",
    );

  const saveNote = (id: string) =>
    act(
      id,
      () =>
        fetch(`/api/admin/notes/orders/${id}/note`, {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note: note[id] || "", exception_type: exc[id] || null }),
        }),
      "Saved",
    ).then(() => {
      setNote((m) => ({ ...m, [id]: "" }));
      setExc((m) => ({ ...m, [id]: "" }));
    });

  return (
    <div>
      <PageHeader
        title="Notes Store — orders"
        subtitle="Search, filter, prepare, pack and ship. Copy the shipping block straight into your courier portal."
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
          className="flex flex-1 gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search order no, name, phone, email, AWB"
            className="h-9 w-full rounded-lg border border-line px-3 text-sm"
          />
          <button type="submit" className="h-9 shrink-0 rounded-lg bg-ink px-3 text-sm font-semibold text-white">
            Search
          </button>
        </form>
      </div>

      <div className="mb-4 -mx-1 flex gap-1 overflow-x-auto pb-1">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => setBucket(b.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
              bucket === b.key ? "bg-ink text-white" : "bg-surface text-ink2 ring-1 ring-line"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {msg && <p className="mb-3 rounded-lg border border-line bg-white px-3 py-2 text-sm">{msg}</p>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-sm text-muted">
          No orders match.
        </p>
      ) : (
        <div className="space-y-4">
          {orders.map((o) => (
            <article key={o.id} className="rounded-xl border border-line bg-white p-4 shadow-soft-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-ink">{o.order_no}</p>
                  <p className="mt-1 font-heading text-lg font-bold">{o.customer_name}</p>
                  <p className="text-sm tabular-nums text-ink2">
                    {o.phone}
                    {o.email ? ` · ${o.email}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-heading text-lg font-bold tabular-nums">{formatPaise(o.total_paise)}</p>
                  {(o.discount_paise || 0) > 0 && (
                    <p className="mt-1 text-[11px] text-ink2">
                      Promotion: {o.discount_trace_json?.offer_name || o.promo_code || "Offer"}
                      {o.discount_trace_json?.discount_type === "percentage" && o.discount_trace_json.discount_value
                        ? ` · ${o.discount_trace_json.discount_value}%`
                        : ""}
                      <br />
                      Discount: {formatPaise(o.discount_paise || o.discount_trace_json?.discount_amount || 0)}
                    </p>
                  )}
                  <p className="mt-1 inline-flex rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink2">
                    {o.status.replaceAll("_", " ")}
                  </p>
                  {o.payment_status && (
                    <p className="mt-1 text-[11px] font-medium text-emerald-700">{o.payment_status}</p>
                  )}
                </div>
              </div>

              <div className="mt-3 rounded-lg bg-surface p-2 text-sm text-ink2">
                <span className="font-semibold text-ink">Ship to: </span>
                {formatAddress(o.address)}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => copy(formatAddress(o.address), "Address")} className="rounded border border-line bg-white px-2 py-1 text-xs font-medium">
                    Copy address
                  </button>
                  <button type="button" onClick={() => copy(o.phone, "Phone")} className="rounded border border-line bg-white px-2 py-1 text-xs font-medium">
                    Copy phone
                  </button>
                  <button type="button" onClick={() => copy(courierBlock(o), "Shipping block")} className="rounded border border-line bg-white px-2 py-1 text-xs font-medium">
                    Copy full shipping
                  </button>
                </div>
              </div>

              <ul className="mt-2 text-sm text-ink2">
                {o.items.map((it, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs text-muted">{it.sku}</span> — {it.name} × {it.qty}
                    {typeof it.unit_price_paise === "number" ? ` · ${formatPaise(it.unit_price_paise)} each` : ""}
                  </li>
                ))}
              </ul>

              {o.shipment?.provider && o.shipment.provider !== "manual" && (
                <p className="mt-2 text-sm text-ink2">
                  <span className="font-semibold text-ink">Chosen courier: </span>
                  {o.shipment.provider} · {o.shipment.courier || "service not named"}
                  {o.shipment.awb ? "" : " · not booked"}
                </p>
              )}
              {o.shipment?.awb && (
                <p className="mt-2 text-sm text-ink2">
                  <span className="font-semibold text-ink">AWB on file: </span>
                  {o.shipment.courier || "Courier"} · <span className="font-mono">{o.shipment.awb}</span>
                  {o.shipment.pickup_scheduled_at ? " · pickup requested" : ""}
                  {o.shipment.status ? ` · ${o.shipment.status.replaceAll("_", " ")}` : ""}
                </p>
              )}
              {(o.attention || []).length > 0 && (
                <p className="mt-2 text-xs text-ink2">Needs attention: {(o.attention || []).join(", ").replaceAll("_", " ")}</p>
              )}
              {(o.shipment?.has_label ||
                (o.shipment?.awb && ["PACKED", "READY_FOR_PICKUP", "PICKUP_SCHEDULED"].includes(o.status))) && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  {o.shipment?.has_label && (
                    <button
                      type="button"
                      className="inline-flex h-9 items-center rounded border border-line px-3 text-sm font-medium text-ink"
                      onClick={() => {
                        void (async () => {
                          setBusyId(o.id);
                          setMsg(null);
                          try {
                            const res = await fetch(`/api/admin/notes/orders/${o.id}/label`, { cache: "no-store" });
                            const json = await res.json();
                            if (json.fixture) setMsg("Test label on file. No courier document was purchased.");
                            else if (json.ok && typeof json.url === "string" && /^https?:\/\//.test(json.url)) {
                              window.open(json.url, "_blank", "noopener");
                              setMsg("Opened the stored label. No new shipment was created.");
                            } else setMsg(json.error || "No label is stored for this order.");
                          } finally {
                            setBusyId(null);
                          }
                        })();
                      }}
                    >
                      Print label
                    </button>
                  )}
                  {o.shipment?.awb && ["PACKED", "READY_FOR_PICKUP", "PICKUP_SCHEDULED"].includes(o.status) && (
                    <>
                      <label className="text-xs text-ink2">
                        Pickup date
                        <input
                          type="date"
                          value={pickupDate[o.id] || ""}
                          onChange={(e) => setPickupDate((m) => ({ ...m, [o.id]: e.target.value }))}
                          className="mt-1 block h-9 rounded border border-line px-2 text-sm text-ink"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busyId === o.id || !pickupDate[o.id]}
                        onClick={() =>
                          act(
                            o.id,
                            () =>
                              fetch(`/api/admin/notes/orders/${o.id}/pickup`, {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ date: pickupDate[o.id] }),
                              }),
                            "Pickup requested. The order stays packed until the courier scans it.",
                          )
                        }
                        className="h-9 rounded border border-line px-3 text-sm font-medium text-ink disabled:opacity-50"
                      >
                        Schedule pickup
                      </button>
                    </>
                  )}
                </div>
              )}
              {o.status === "REFUND_PENDING" && (
                <p className="mt-2 text-sm text-ink">Refund pending manual payment-gateway processing.</p>
              )}
              {o.internal_notes && (
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface p-2 text-xs text-ink2">{o.internal_notes}</pre>
              )}

              <CourierQuotes
                orderId={o.id}
                packed={o.shipment}
                onUseCourier={(name) => setCourier((m) => ({ ...m, [o.id]: name }))}
                onSaved={() => void load()}
              />

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === o.id}
                  onClick={() => advance(o.id)}
                  className="h-9 rounded bg-surface px-3 text-sm font-semibold text-ink ring-1 ring-line hover:bg-white disabled:opacity-50"
                >
                  Advance status
                </button>
                <input
                  value={courier[o.id] || ""}
                  onChange={(e) => setCourier((m) => ({ ...m, [o.id]: e.target.value }))}
                  placeholder="Courier"
                  className="h-9 w-40 rounded border border-line px-2 text-sm"
                />
                <input
                  value={awb[o.id] || ""}
                  onChange={(e) => setAwb((m) => ({ ...m, [o.id]: e.target.value }))}
                  placeholder="AWB"
                  className="h-9 w-40 rounded border border-line px-2 font-mono text-sm"
                />
                <button
                  type="button"
                  disabled={busyId === o.id || !(awb[o.id] || "").trim()}
                  onClick={() => ship(o.id)}
                  className="h-9 rounded bg-ink px-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Mark shipped
                </button>
                <button
                  type="button"
                  onClick={() => setNoteOpen((c) => (c === o.id ? null : o.id))}
                  className="h-9 rounded border border-line px-3 text-sm font-medium text-ink2"
                >
                  {noteOpen === o.id ? "Close" : "Note / issue"}
                </button>
              </div>

              {noteOpen === o.id && (
                <div className="mt-3 space-y-2 rounded-lg border border-line bg-surface p-3">
                  <select
                    value={exc[o.id] || ""}
                    onChange={(e) => setExc((m) => ({ ...m, [o.id]: e.target.value }))}
                    className="h-9 w-full rounded border border-line px-2 text-sm"
                  >
                    <option value="">Internal note (no exception)</option>
                    {EXCEPTIONS.map((x) => (
                      <option key={x.value} value={x.value}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={note[o.id] || ""}
                    onChange={(e) => setNote((m) => ({ ...m, [o.id]: e.target.value }))}
                    rows={2}
                    placeholder="e.g. Call before dispatch · replacement sent via Delhivery"
                    className="w-full rounded border border-line px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    disabled={busyId === o.id || !((note[o.id] || "").trim() || exc[o.id])}
                    onClick={() => saveNote(o.id)}
                    className="h-9 rounded bg-ink px-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Save note
                  </button>
                  {(o.status === "RETURN_REQUESTED" || o.status === "RETURN_APPROVED") && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyId === o.id}
                        onClick={() =>
                          act(
                            o.id,
                            () =>
                              fetch(`/api/admin/notes/orders/${o.id}/support-decision`, {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ action: "approve", reason: note[o.id] || "Reviewed" }),
                              }),
                            "Return approved. No shipment was created.",
                          )
                        }
                        className="h-9 rounded border border-line px-3 text-sm font-medium text-ink"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyId === o.id || !(note[o.id] || "").trim()}
                        onClick={() =>
                          act(
                            o.id,
                            () =>
                              fetch(`/api/admin/notes/orders/${o.id}/support-decision`, {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ action: "reject", reason: note[o.id] }),
                              }),
                            "Rejected. No refund was sent.",
                          )
                        }
                        className="h-9 rounded border border-line px-3 text-sm font-medium text-ink disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={busyId === o.id || !(note[o.id] || "").trim()}
                        onClick={() =>
                          act(
                            o.id,
                            () =>
                              fetch(`/api/admin/notes/orders/${o.id}/support-decision`, {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ action: "replace", reason: note[o.id] }),
                              }),
                            "Replacement recorded. No shipment was created.",
                          )
                        }
                        className="h-9 rounded border border-line px-3 text-sm font-medium text-ink disabled:opacity-50"
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        disabled={busyId === o.id || !(note[o.id] || "").trim()}
                        onClick={() =>
                          act(
                            o.id,
                            () =>
                              fetch(`/api/admin/notes/orders/${o.id}/support-decision`, {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ action: "reverse", reason: note[o.id] }),
                              }),
                            "Reverse pickup requested.",
                          )
                        }
                        className="h-9 rounded border border-line px-3 text-sm font-medium text-ink disabled:opacity-50"
                      >
                        Reverse pickup
                      </button>
                    </div>
                  )}
                  {REFUNDABLE.has(o.status) && (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-xs text-ink2">
                        Refund (paise)
                        <input
                          inputMode="numeric"
                          value={refundPaise[o.id] || ""}
                          onChange={(e) => setRefundPaise((m) => ({ ...m, [o.id]: e.target.value }))}
                          className="mt-1 block h-9 w-28 rounded border border-line px-2 text-sm text-ink"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busyId === o.id || !(note[o.id] || "").trim()}
                        onClick={() =>
                          act(
                            o.id,
                            () =>
                              fetch(`/api/admin/notes/orders/${o.id}/refund`, {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({
                                  amount_paise: refundPaise[o.id] === undefined || refundPaise[o.id] === "" ? o.total_paise : Number(refundPaise[o.id]),
                                  reason: note[o.id],
                                  confirm: "REQUEST_REFUND",
                                }),
                              }),
                            "Refund pending manual payment-gateway processing.",
                          )
                        }
                        className="h-9 rounded border border-line px-3 text-sm font-medium text-ink disabled:opacity-50"
                      >
                        Request refund
                      </button>
                    </div>
                  )}
                  {o.status === "REFUND_PENDING" && (
                    <div className="space-y-2">
                      <p className="text-sm text-ink">Refund pending manual payment-gateway processing.</p>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-xs text-ink2">
                          Gateway reference
                          <input
                            value={refundRef[o.id] || ""}
                            onChange={(e) => setRefundRef((m) => ({ ...m, [o.id]: e.target.value }))}
                            className="mt-1 block h-9 w-48 rounded border border-line px-2 text-sm text-ink"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={busyId === o.id || (refundRef[o.id] || "").trim().length < 4}
                          onClick={() =>
                            act(
                              o.id,
                              () =>
                                fetch(`/api/admin/notes/orders/${o.id}/refund`, {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({
                                    amount_paise: refundPaise[o.id] === undefined || refundPaise[o.id] === "" ? o.total_paise : Number(refundPaise[o.id]),
                                    reference: refundRef[o.id],
                                    confirm: "RECORD_MANUAL_REFUND",
                                  }),
                                }),
                              "Gateway reference recorded. No new payment was sent.",
                            )
                          }
                          className="h-9 rounded border border-line px-3 text-sm font-medium text-ink disabled:opacity-50"
                        >
                          Record gateway reference
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
