"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatPaise } from "@/lib/store/money";
import {
  fulfillmentLabel,
  fulfillmentTone,
  formatAdminWhen,
  invoiceStatusLabel,
  orderIndexLabel,
  pickupFailedActivity,
  type BadgeTone,
} from "@/lib/store/adminConsole";
import { BUSINESS_CHANNELS } from "@/lib/analytics/notesCommerce";
import OrderDetail, { type AdminOrder } from "./orders/OrderDetail";
import CourierPicker from "./orders/CourierPicker";
import { ViewInvoiceButton } from "./orders/InvoiceActions";
import { FulfillmentTimeline } from "./orders/FulfillmentTimeline";
import { showsFulfillmentTimeline } from "@/lib/store/opsBoard";
import { productSummary } from "@/lib/store/stages";

const FILTERS = [
  { key: "", label: "All customers", count: "customers" },
  { key: "paid", label: "Paid customers", count: "paid_customers" },
  { key: "new", label: "New", count: "new" },
  { key: "preparing", label: "Preparing", count: "preparing" },
  { key: "printing", label: "Printing", count: "printing" },
  { key: "packed", label: "Packed", count: "packed" },
  { key: "pickup", label: "Pickup", count: "pickup" },
  { key: "shipped", label: "Shipped", count: "transit" },
  { key: "delivered", label: "Delivered", count: "delivered" },
  { key: "issues", label: "Issues", count: "issues" },
] as const;

function rowAccent(status: string, actionRequired: boolean): string {
  if (status === "PAYMENT_PENDING" || actionRequired && (status === "PAYMENT_PENDING" || status === "REFUND_PENDING")) return "border-l-amber-600 bg-amber-50/70";
  if (status === "CANCELLED" || status === "PAYMENT_FAILED" || status === "PAYMENT_EXPIRED" || status === "REFUNDED") return "border-l-red-700/50 bg-red-50/50";
  if (status === "DELIVERED") return "border-l-emerald-700 bg-emerald-50/50";
  if (status === "PROCESSING") return "border-l-amber-600 bg-amber-50/40";
  if (status === "PRINTING" || status === "QUALITY_CHECK" || status === "READY_TO_PACK") return "border-l-[var(--ca-gold-dark)] bg-[var(--ca-gold)]/10";
  if (status === "PACKED" || status === "READY_FOR_PICKUP") return "border-l-indigo-700 bg-indigo-50/50";
  if (status === "PICKUP_SCHEDULED") return "border-l-teal-700 bg-teal-50/50";
  if (status === "PICKED_UP" || status === "IN_TRANSIT" || status === "OUT_FOR_DELIVERY") return "border-l-sky-700 bg-sky-50/40";
  if (status === "ORDER_CONFIRMED" || status === "PAYMENT_CONFIRMED") return "border-l-indigo-500 bg-indigo-50/30";
  if (actionRequired) return "border-l-amber-600 bg-amber-50/40";
  return "border-l-transparent";
}

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-[var(--ca-navy)]/5 text-[var(--ca-navy)]",
  navy: "bg-[var(--ca-navy)] text-white",
  gold: "bg-[var(--ca-gold)]/30 text-[var(--ca-gold-dark)]",
  amber: "bg-amber-100 text-amber-950",
  green: "bg-emerald-50 text-emerald-900",
  red: "bg-red-50 text-red-900",
};

function readParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    bucket: params.get("status") || "",
    q: params.get("q") || "",
    sort: params.get("sort") || "newest",
    action: params.get("action") === "required",
    acq: params.get("acq") || "",
    offset: Number(params.get("offset") || 0),
  };
}

export default function NotesOrderQueue() {
  const initial = typeof window === "undefined" ? { bucket: "", q: "", sort: "newest", action: false, acq: "", offset: 0 } : readParams();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [products, setProducts] = useState<Array<{ name: string; orders: number; units: number }>>([]);
  const [total, setTotal] = useState(0);
  const [bucket, setBucket] = useState(initial.bucket === "issues" ? "" : initial.bucket);
  const [issueOnly, setIssueOnly] = useState(initial.bucket === "issues");
  const [actionOnly, setActionOnly] = useState(initial.action);
  const [acq, setAcq] = useState(initial.acq);
  const [q, setQ] = useState(initial.q);
  const [sort, setSort] = useState(initial.sort);
  const [offset, setOffset] = useState(initial.offset);
  const [openId, setOpenId] = useState<string | null>(null);
  const openOrder = useCallback((id: string) => {
    window.history.pushState({ notesOrder: id }, "", window.location.href);
    setOpenId(id);
  }, []);
  useEffect(() => {
    const onPop = () => setOpenId(window.history.state?.notesOrder || null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [writes, setWrites] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const queryRef = useRef(q);

  const writeUrl = useCallback((next: { bucket: string; issue: boolean; action: boolean; acq: string; q: string; sort: string; offset: number }) => {
    const params = new URLSearchParams();
    if (next.issue) params.set("status", "issues");
    else if (next.bucket) params.set("status", next.bucket);
    if (next.action) params.set("action", "required");
    if (next.acq) params.set("acq", next.acq);
    if (next.q) params.set("q", next.q);
    if (next.sort && next.sort !== "newest") params.set("sort", next.sort);
    if (next.offset) params.set("offset", String(next.offset));
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `/admin/notes?${qs}` : "/admin/notes");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (bucket) params.set("bucket", bucket);
    if (issueOnly) params.set("issue", "open");
    if (actionOnly) params.set("action", "required");
    if (acq) params.set("acq", acq);
    if (q.trim()) params.set("q", q.trim());
    if (sort) params.set("sort", sort);
    params.set("limit", "25");
    params.set("offset", String(offset));
    const res = await fetch(`/api/admin/notes/orders?${params}`, { cache: "no-store" });
    const json = await res.json();
    const rows = (json.orders || []) as AdminOrder[];
    setOrders(rows);
    setCounts(json.counts || {});
    setProducts(json.counts?.products || []);
    setTotal(json.total || rows.length);
    setWrites(Boolean(json.writes_authorized));
    setLoading(false);
  }, [bucket, issueOnly, actionOnly, acq, q, sort, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyFilter(key: string) {
    const issues = key === "issues";
    setIssueOnly(issues);
    setBucket(issues ? "" : key);
    setActionOnly(false);
    setOffset(0);
    writeUrl({ bucket: issues ? "" : key, issue: issues, action: false, acq, q, sort, offset: 0 });
  }

  const open = orders.find((row) => row.id === openId) || null;
  const compare = orders.find((row) => row.id === compareId) || null;

  function act(id: string, fn: () => Promise<Response>, ok: string) {
    setBusyId(id);
    setMsg(null);
    void (async () => {
      try {
        const res = await fn();
        const json = await res.json();
        setMsg(json.ok ? ok : json.error || "Could not update the order.");
        await load();
      } finally {
        setBusyId(null);
      }
    })();
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Notes Store</p>
          <h1 className="font-heading text-3xl font-bold text-[var(--ca-navy)]">Orders</h1>
          <p className="mt-1 text-xs text-[var(--ca-navy)]/55">
            {counts.paid ?? "–"} paid orders · {counts.paid_customers ?? "–"} paid customers · {counts.attempts ?? "–"} payment attempts
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/notes/analytics" className="inline-flex min-h-10 items-center rounded-full border border-[var(--ca-navy)]/15 bg-white px-4 text-sm font-semibold text-[var(--ca-navy)]">Analytics</Link>
          <Link href="/admin/notes/leads" className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-semibold text-[var(--ca-navy)]/70">Checkout leads</Link>
        </div>
      </header>

      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto pb-1">
        {[
          ["paid", "Paid orders", "paid", counts.paid],
          ["sales", "Paid sales", "paid", counts.paid_sales_paise != null ? formatPaise(Number(counts.paid_sales_paise)) : "–"],
          ["new", "New", "new", counts.new],
          ["preparing", "Preparing", "preparing", counts.preparing],
          ["printing", "Printing", "printing", counts.printing],
          ["packed", "Packed", "packed", counts.packed],
          ["pickup", "Pickup", "pickup", counts.pickup],
          ["transit", "In transit", "shipped", counts.transit],
          ["delivered", "Delivered", "delivered", counts.delivered],
          ["issues", "Issues", "issues", counts.issues],
        ].map(([key, label, filter, value]) => {
          const selected = filter === "issues" ? issueOnly : !issueOnly && bucket === filter;
          return (
            <button
              key={String(key)}
              type="button"
              aria-pressed={selected}
              onClick={() => applyFilter(String(filter))}
              className={`min-w-[7.5rem] shrink-0 rounded-2xl border px-3 py-2.5 text-left ${selected ? "border-[var(--ca-navy)] bg-[var(--ca-navy)] text-white" : "border-[var(--ca-navy)]/10 bg-white"}`}
            >
              <span className={`block text-[10px] font-semibold uppercase tracking-wide ${selected ? "text-white/70" : "text-[var(--ca-navy)]/45"}`}>{label}</span>
              <span className="mt-0.5 block font-heading text-xl font-bold tabular-nums">{value ?? "–"}</span>
            </button>
          );
        })}
      </div>

      {products.length > 0 && (
        <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto pb-1">
          <p className="sr-only">Paid by product</p>
          {products.map((product) => (
            <div key={product.name} className="min-w-[9rem] shrink-0 rounded-2xl border border-[var(--ca-navy)]/10 bg-white px-3 py-2">
              <span className="block truncate text-sm font-semibold text-[var(--ca-navy)]">{product.name.replace(/ notes$/i, "")}</span>
              <span className="mt-0.5 block text-xs text-[var(--ca-navy)]/55" title="An order with more than one subject is counted in each subject. These numbers do not have to add up to paid orders.">{product.units} units · {product.orders} orders</span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            queryRef.current = q;
            writeUrl({ bucket, issue: issueOnly, action: actionOnly, acq, q, sort, offset: 0 });
            void load();
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Order, customer, phone, email, AWB"
            className="min-h-11 w-full rounded-2xl border border-[var(--ca-navy)]/10 bg-white px-3 text-sm"
          />
        </form>
        <button type="button" onClick={() => setFiltersOpen((v) => !v)} className="min-h-11 rounded-full border bg-white px-4 text-sm font-semibold sm:hidden">
          Filters
        </button>
        <select
          aria-label="Sort orders"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setOffset(0);
            writeUrl({ bucket, issue: issueOnly, action: actionOnly, acq, q, sort: e.target.value, offset: 0 });
          }}
          className="min-h-11 rounded-full border bg-white px-3 text-sm"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="value_desc">Highest value</option>
          <option value="value_asc">Lowest value</option>
          <option value="updated">Recently updated</option>
          <option value="action">Action required first</option>
        </select>
      </div>

      <div className={`${filtersOpen ? "flex" : "hidden"} mb-4 flex-wrap gap-2 sm:flex`}>
        {FILTERS.map((filter) => {
          const active = filter.key === "issues" ? issueOnly : !issueOnly && bucket === filter.key;
          return (
            <button
              key={filter.key || "all"}
              type="button"
              onClick={() => applyFilter(filter.key)}
              className={`min-h-10 rounded-full px-3 text-sm font-semibold ${active ? "bg-[var(--ca-navy)] text-white" : "bg-white text-[var(--ca-navy)]"}`}
            >
              {filter.label}
              {counts[filter.count] != null ? ` ${counts[filter.count]}` : ""}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setActionOnly((v) => !v);
            setOffset(0);
            writeUrl({ bucket, issue: issueOnly, action: !actionOnly, acq, q, sort, offset: 0 });
          }}
          className={`min-h-10 rounded-full px-3 text-sm font-semibold ${actionOnly ? "bg-amber-800 text-white" : "bg-white text-[var(--ca-navy)]"}`}
        >
          Action required
        </button>
        <select
          aria-label="Acquisition source"
          value={acq}
          onChange={(e) => {
            setAcq(e.target.value);
            setOffset(0);
            writeUrl({ bucket, issue: issueOnly, action: actionOnly, acq: e.target.value, q, sort, offset: 0 });
          }}
          className="min-h-10 rounded-full border bg-white px-3 text-sm"
        >
          <option value="">All sources</option>
          {BUSINESS_CHANNELS.filter((channel) => channel !== "Unknown").map((channel) => (
            <option key={channel} value={channel}>{channel}</option>
          ))}
        </select>
      </div>

      {msg && <p className="mb-3 rounded-xl bg-white px-3 py-2 text-sm text-[var(--ca-navy)]">{msg}</p>}

      {loading ? (
        <div className="space-y-2" aria-hidden>
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
        </div>
      ) : orders.length === 0 ? (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-[var(--ca-navy)]/60">
          {q || bucket || issueOnly || actionOnly || acq ? "No orders match these filters." : "No orders yet."}
        </p>
      ) : (
        <>
          <ul className="hidden overflow-hidden rounded-2xl bg-white md:block">
            {orders.map((order) => {
              const failed = pickupFailedActivity(order.shipment?.tracking_activity);
              const product = productSummary(order.items);
              return (
                <li key={order.id} className={`grid grid-cols-[1.2fr_0.9fr_0.7fr_1.3fr_auto] items-center gap-3 border-b border-l-2 border-[var(--ca-navy)]/5 px-4 py-3 ${order.group && !order.group.paid_count ? "border-l-transparent" : rowAccent(order.status, Boolean(order.action_required && order.group?.paid_count !== 0))}`}>
                  <div>
                    <Link href={`/admin/notes/orders/${order.id}`} className="text-left">
                      <span className="block font-heading text-base font-bold text-[var(--ca-navy)]">{order.customer_name}</span>
                      <span className="block text-sm text-[var(--ca-navy)]/70">{order.group?.masked_phone || orderIndexLabel(order.order_no)}</span>
                    </Link>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ca-navy)]/45">
                      {(!order.group || order.group.paid_count === 1) && invoiceStatusLabel(order.invoice_status)}
                      {(!order.group || order.group.paid_count === 1) && order.invoice_status === "READY" && <ViewInvoiceButton orderId={order.id} />}
                    </span>
                  </div>
                  <div>
                    {order.group && !order.group.paid_count ? (
                      <span className="block text-sm text-[var(--ca-navy)]/70">No paid order</span>
                    ) : order.group && order.group.active.length > 1 ? (
                      order.group.active.map((item) => (
                        <span key={item.id} className="block text-sm text-[var(--ca-navy)]/80">{productSummary(item.items || [])} · {fulfillmentLabel(item.status, false)}</span>
                      ))
                    ) : (
                      <span className="block text-sm text-[var(--ca-navy)]/80">{product}</span>
                    )}
                    {order.group?.paid_count ? <span className="mt-1 block text-sm font-semibold tabular-nums text-[var(--ca-navy)]">{formatPaise(order.group.paid_total_paise)}</span> : null}
                    {!order.group && <span className="mt-1 block text-sm font-semibold tabular-nums text-[var(--ca-navy)]">{formatPaise(order.total_paise)}</span>}
                    {order.group?.matched_order_no && <span className="block text-[11px] text-[var(--ca-navy)]/55">Matched attempt {order.group.matched_order_no}</span>}
                  </div>
                  <span className={`w-fit rounded-full px-2 py-1 text-[11px] font-semibold ${order.group?.paid_count || order.payment_status === "CAPTURED" ? TONE.green : TONE.neutral}`}>{order.group ? (order.group.paid_count ? "Paid" : fulfillmentLabel(order.status, failed)) : order.payment_status === "CAPTURED" ? "Paid" : order.payment_status || "Payment pending"}</span>
                  <div>
                    {order.group?.paid_count && showsFulfillmentTimeline(order.status) ? <FulfillmentTimeline status={order.status} compact /> : <span className="text-xs text-[var(--ca-navy)]/60">{order.group?.paid_count ? fulfillmentLabel(order.status, failed) : "Previous attempt"}</span>}
                    <span className="mt-1 block text-[11px] text-[var(--ca-navy)]/50">{order.group ? `${order.group.attempts} attempts · ${order.group.paid_count} paid` : formatAdminWhen(order.placed_at)}</span>
                  </div>
                  <Link href={`/admin/notes/orders/${order.id}`} className="inline-flex min-h-11 items-center rounded-full bg-[var(--ca-navy)] px-3 text-sm font-semibold text-white">View details</Link>
                </li>
              );
            })}
          </ul>
          <ul className="space-y-2 md:hidden">
            {orders.map((order) => {
              const failed = pickupFailedActivity(order.shipment?.tracking_activity);
              return (
                <li key={order.id} className={`rounded-2xl border-l-2 bg-white p-4 ${order.group && !order.group.paid_count ? "border-l-transparent" : rowAccent(order.status, false)}`}>
                  <Link href={`/admin/notes/orders/${order.id}`} className="block text-left">
                    <span className="flex items-start justify-between gap-3">
                      <span>
                        <span className="block font-heading text-lg font-bold">{order.customer_name}</span>
                        <span className="mt-1 block text-sm text-[var(--ca-navy)]/60">{order.group?.masked_phone}</span>
                        <span className="mt-1 block text-sm text-[var(--ca-navy)]/70">{order.group && !order.group.paid_count ? "No paid order" : productSummary(order.items)}</span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{order.group?.paid_count ? formatPaise(order.group.paid_total_paise) : ""}</span>
                    </span>
                    <span className="mt-3 block">{showsFulfillmentTimeline(order.status) ? <FulfillmentTimeline status={order.status} compact /> : null}</span>
                    <span className="mt-2 flex items-center justify-between gap-2">
                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${TONE[fulfillmentTone(order.status, failed)]}`}>{fulfillmentLabel(order.status, failed)}</span>
                      <span className="text-xs text-[var(--ca-navy)]/55">{order.payment_status === "CAPTURED" ? "Paid" : order.payment_status || "Payment pending"}</span>
                    </span>
                    {order.group && <span className="mt-2 block text-xs text-[var(--ca-navy)]/55">{order.group.attempts} attempts · {order.group.paid_count} paid</span>}
                  </Link>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {order.invoice_status === "READY" && <ViewInvoiceButton orderId={order.id} />}
                    <Link href={`/admin/notes/orders/${order.id}`} className="inline-flex min-h-11 items-center rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white">View details</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mt-4 flex items-center justify-between text-sm">
        <button type="button" disabled={offset === 0} onClick={() => setOffset((n) => Math.max(0, n - 25))} className="min-h-11 rounded-full px-3 disabled:opacity-40">Previous</button>
        <span className="text-[var(--ca-navy)]/50">{offset + 1}–{Math.min(offset + orders.length, total)} of {total}</span>
        <button type="button" disabled={offset + 25 >= total} onClick={() => setOffset((n) => n + 25)} className="min-h-11 rounded-full px-3 disabled:opacity-40">Next</button>
      </div>

      {open && (
        <OrderDetail
          order={open}
          busy={busyId === open.id}
          writesAuthorized={writes}
          onClose={() => {
            if (window.history.state?.notesOrder) window.history.back();
            else setOpenId(null);
          }}
          onRefresh={() => void load()}
          onCompare={() => setCompareId(open.id)}
          act={(fn, ok) => act(open.id, fn, ok)}
        />
      )}
      {compare && (
        <CourierPicker
          orderId={compare.id}
          open
          writesAuthorized={writes}
          weight={compare.shipment?.weight_grams || 500}
          length={compare.shipment?.length_cm || 30}
          width={compare.shipment?.width_cm || 25}
          height={compare.shipment?.height_cm || 3}
          onClose={() => setCompareId(null)}
          onBooked={() => {
            setCompareId(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
