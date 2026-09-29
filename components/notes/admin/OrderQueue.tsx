"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatPaise } from "@/lib/store/money";
import {
  fulfillmentLabel,
  formatAdminWhen,
  invoiceStatusLabel,
  showAdminViewInvoice,
  orderIndexLabel,
  type BadgeTone,
} from "@/lib/store/adminConsole";
import { BUSINESS_CHANNELS } from "@/lib/analytics/notesCommerce";
import OrderDetail, { type AdminOrder } from "./orders/OrderDetail";
import CourierPicker from "./orders/CourierPicker";
import { ViewInvoiceButton } from "./orders/InvoiceActions";
import { destinationLabel, FulfillmentBlock, PackageMeta } from "./orders/OrderOpsCell";
import { productList, productSummary } from "@/lib/store/stages";
import type { ShippingRateStats } from "@/lib/store/orderOpsDisplay";

const REFRESH_MS = 45_000;
const REFRESH_MIN_GAP_MS = 10_000;

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
  neutral: "bg-ca-navy/5 text-[var(--ca-navy)]",
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
  const [shippingRate, setShippingRate] = useState<ShippingRateStats | null>(null);
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
  const [canManage, setCanManage] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
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

  const requestSeq = useRef(0);
  const lastLoadAt = useRef(0);
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const seq = ++requestSeq.current;
    lastLoadAt.current = Date.now();
    if (!opts?.silent) setLoading(true);
    const params = new URLSearchParams();
    if (bucket) params.set("bucket", bucket);
    if (issueOnly) params.set("issue", "open");
    if (actionOnly) params.set("action", "required");
    if (acq) params.set("acq", acq);
    if (q.trim()) params.set("q", q.trim());
    if (sort) params.set("sort", sort);
    params.set("limit", "25");
    params.set("offset", String(offset));
    let json: Record<string, unknown> & { orders?: AdminOrder[]; counts?: Record<string, unknown> & { products?: Array<{ name: string; orders: number; units: number }>; shipping_rate?: ShippingRateStats } };
    try {
      const res = await fetch(`/api/admin/notes/orders?${params}`, { cache: "no-store" });
      if (opts?.silent && !res.ok) return;
      json = await res.json();
    } catch (error) {
      if (opts?.silent) return;
      throw error;
    }
    if (seq !== requestSeq.current) return;
    const rows = (json.orders || []) as AdminOrder[];
    setOrders(rows);
    setCounts((json.counts || {}) as Record<string, number>);
    setShippingRate(json.counts?.shipping_rate || null);
    setProducts(json.counts?.products || []);
    setTotal(Number(json.total) || rows.length);
    setWrites(Boolean(json.writes_authorized));
    setCanManage(Boolean(json.can_manage));
    setShowAnalytics(Boolean(json.can_view_analytics));
    setLoading(false);
  }, [bucket, issueOnly, actionOnly, acq, q, sort, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const pauseRefresh = useRef(false);
  pauseRefresh.current = Boolean(openId || compareId || busyId);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || pauseRefresh.current) return;
      if (Date.now() - lastLoadAt.current < REFRESH_MIN_GAP_MS) return;
      void load({ silent: true });
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
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
          <p className="mt-1 text-xs text-ca-navy/55">
            {counts.paid ?? "–"} paid orders · {counts.paid_customers ?? "–"} paid customers · {counts.attempts ?? "–"} payment attempts
          </p>
        </div>
        <div className="flex gap-2">
          {showAnalytics && <Link href="/admin/notes/analytics" className="inline-flex min-h-10 items-center rounded-full border border-ca-navy/15 bg-white px-4 text-sm font-semibold text-[var(--ca-navy)]">Analytics</Link>}
          <Link href="/admin/notes/leads" className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-semibold text-ca-navy/70">Checkout leads</Link>
        </div>
      </header>

      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto pb-1">
        {[
          ["paid", "Paid orders", "paid", counts.paid],
          ["sales", "Paid sales", "paid", counts.paid_sales_paise != null ? formatPaise(Number(counts.paid_sales_paise)) : "–"],
          ["rate", "", "", null],
          ["new", "New", "new", counts.new],
          ["preparing", "Preparing", "preparing", counts.preparing],
          ["printing", "Printing", "printing", counts.printing],
          ["packed", "Packed", "packed", counts.packed],
          ["pickup", "Pickup", "pickup", counts.pickup],
          ["transit", "In transit", "shipped", counts.transit],
          ["delivered", "Delivered", "delivered", counts.delivered],
          ["issues", "Issues", "issues", counts.issues],
        ].map(([key, label, filter, value]) => {
          if (key === "rate") return <ShippingRateTile key="rate" stats={shippingRate} />;
          const selected = filter === "issues" ? issueOnly : !issueOnly && bucket === filter;
          return (
            <button
              key={String(key)}
              type="button"
              aria-pressed={selected}
              onClick={() => applyFilter(String(filter))}
              className={`h-[4.25rem] min-w-[7.5rem] shrink-0 rounded-2xl border px-3 py-2.5 text-left ${selected ? "border-[var(--ca-navy)] bg-[var(--ca-navy)] text-white" : "border-ca-navy/10 bg-white"}`}
            >
              <span className={`block text-[10px] font-semibold uppercase tracking-wide ${selected ? "text-white/70" : "text-ca-navy/45"}`}>{label}</span>
              <span className="mt-0.5 block font-heading text-xl font-bold tabular-nums">{value ?? "–"}</span>
            </button>
          );
        })}
      </div>

      {products.length > 0 && (
        <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto pb-1">
          <p className="sr-only">Paid by product</p>
          {products.map((product) => (
            <div key={product.name} className="min-w-[9rem] shrink-0 rounded-2xl border border-ca-navy/10 bg-white px-3 py-2">
              <span className="block truncate text-sm font-semibold text-[var(--ca-navy)]">{product.name.replace(/ notes$/i, "")}</span>
              <span className="mt-0.5 block text-xs text-ca-navy/55" title="An order with more than one subject is counted in each subject. These numbers do not have to add up to paid orders.">{product.units} units · {product.orders} orders</span>
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
            className="min-h-11 w-full rounded-2xl border border-ca-navy/10 bg-white px-3 text-sm"
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
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-ca-navy/60">
          {q || bucket || issueOnly || actionOnly || acq ? "No orders match these filters." : "No orders yet."}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-white">
          {orders.map((order) => (
            <CustomerRow key={order.id} order={order} />
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between text-sm">
        <button type="button" disabled={offset === 0} onClick={() => setOffset((n) => Math.max(0, n - 25))} className="min-h-11 rounded-full px-3 disabled:opacity-40">Previous</button>
        <span className="text-ca-navy/50">{offset + 1}–{Math.min(offset + orders.length, total)} of {total}</span>
        <button type="button" disabled={offset + 25 >= total} onClick={() => setOffset((n) => n + 25)} className="min-h-11 rounded-full px-3 disabled:opacity-40">Next</button>
      </div>

      {open && (
        <OrderDetail
          order={open}
          busy={busyId === open.id}
          writesAuthorized={writes}
          canManage={canManage}
          onClose={() => {
            if (window.history.state?.notesOrder) window.history.back();
            else setOpenId(null);
          }}
          onRefresh={() => void load()}
          onCompare={() => setCompareId(open.id)}
          act={(fn, ok) => act(open.id, fn, ok)}
        />
      )}
      {canManage && compare && (
        <CourierPicker
          orderId={compare.id}
          open
          writesAuthorized={writes}
          weight={compare.shipment?.weight_grams || 0}
          length={compare.shipment?.length_cm || 0}
          width={compare.shipment?.width_cm || 0}
          height={compare.shipment?.height_cm || 0}
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

const RATE_HINT =
  "Average booked courier rate across active/completed shipments with a saved rate. Cancelled shipments and customer shipping charges are excluded. Covers the whole store, like the other tiles, not the list filter.";

function ShippingRateTile({ stats }: { stats: ShippingRateStats | null }) {
  const coverage = stats
    ? `${stats.count} shipments with saved rate${stats.unknown ? ` · ${stats.unknown} without a saved rate (excluded)` : ""}`
    : "";
  return (
    <div
      title={coverage ? `${RATE_HINT} ${coverage}.` : RATE_HINT}
      className="h-[4.25rem] min-w-[12rem] shrink-0 rounded-2xl border border-ca-navy/10 bg-white px-3 py-2 text-left"
    >
      <span className="block text-[10px] font-semibold uppercase leading-[14px] tracking-wide text-ca-navy/45">Avg shipping rate</span>
      <span className="block font-heading text-xl font-bold leading-6 tabular-nums text-[var(--ca-navy)]">
        {stats?.avg_paise != null ? formatPaise(stats.avg_paise) : "–"}
      </span>
      <span className="block whitespace-nowrap text-[10px] leading-[14px] tabular-nums text-ca-navy/50">
        {stats?.count && stats.min_paise != null && stats.max_paise != null
          ? `${formatPaise(stats.min_paise)} min · ${formatPaise(stats.max_paise)} max · ${stats.count} rated`
          : "No saved rates yet"}
      </span>
      {coverage && <span className="sr-only">{coverage}</span>}
    </div>
  );
}

type PaidLine = NonNullable<NonNullable<AdminOrder["group"]>["paid_orders"]>[number];

function paidLines(order: AdminOrder): PaidLine[] {
  if (order.group?.paid_orders) return order.group.paid_orders;
  if (order.group && !order.group.paid_count) return [];
  return [
    {
      id: order.id,
      order_no: order.order_no,
      status: order.status,
      total_paise: order.total_paise,
      items: order.items,
      invoice_status: order.invoice_status,
      action_required: order.action_required,
      ops: order.ops,
    },
  ];
}

function narrowProducts(items: Array<{ name: string; qty: number }>): string {
  if (items.length <= 1) return productList(items);
  return `${productList(items.slice(0, 1))} · +${items.length - 1} more`;
}

function InvoiceControl({ line, withLabel }: { line: PaidLine; withLabel: boolean }) {
  const ready = showAdminViewInvoice(line.invoice_status);
  return (
    <span className="flex flex-wrap items-center gap-2 text-[11px] text-ca-navy/45">
      {(withLabel || !ready) && invoiceStatusLabel(line.invoice_status)}
      {ready && <ViewInvoiceButton orderId={line.id} />}
    </span>
  );
}

const DETAILS = "inline-flex min-h-11 shrink-0 items-center rounded-full bg-[var(--ca-navy)] px-3.5 text-sm font-semibold text-white ca-focus";

function OrderLine({ line, multi, showCity }: { line: PaidLine; multi: boolean; showCity: boolean }) {
  const city = destinationLabel(line.ops);
  const full = productList(line.items);
  return (
    <div className="grid gap-2 py-2.5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:gap-x-5 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.75fr)_auto] xl:items-start xl:gap-x-4">
      <div className="min-w-0">
        {multi && (
          <span className="mb-0.5 block text-[11px] font-semibold text-ca-navy/55">
            {orderIndexLabel(line.order_no)}
            {showCity && city ? ` · ${city}` : ""}
          </span>
        )}
        <span className="block text-sm text-ca-navy/85" title={full}>
          <span className="hidden sm:inline">{full}</span>
          <span className="sm:hidden">{narrowProducts(line.items)}</span>
        </span>
        <span className="block text-sm font-semibold tabular-nums text-[var(--ca-navy)]">{formatPaise(line.total_paise)}</span>
        <PackageMeta ops={line.ops} />
      </div>
      <div className="flex min-w-0 items-start gap-2 xl:contents">
        <span className={`mt-px w-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE.green}`}>Paid</span>
        <FulfillmentBlock order={line} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 md:col-span-2 xl:col-span-1 xl:flex-col xl:items-end xl:justify-start">
        <span className={multi ? "" : "xl:hidden"}>
          <InvoiceControl line={line} withLabel={false} />
        </span>
        <Link href={`/admin/notes/orders/${line.id}`} className={DETAILS}>
          View details
        </Link>
      </div>
    </div>
  );
}

function CustomerRow({ order }: { order: AdminOrder }) {
  const lines = paidLines(order);
  const paidCount = order.group ? order.group.paid_count : lines.length;
  const multi = lines.length > 1;
  const cities = [...new Set(lines.map((line) => destinationLabel(line.ops)).filter(Boolean))] as string[];
  const unpaidCity = !lines.length && order.address?.city ? [order.address.city, order.address.state].filter(Boolean).join(", ") : null;
  const sharedCity = cities.length === 1 ? cities[0] : unpaidCity;
  const phone = order.group?.phone || order.phone;
  const single = lines.length === 1 ? lines[0] : null;
  const accent = !paidCount ? "border-l-transparent" : rowAccent(order.status, Boolean(order.action_required));
  return (
    <li className={`border-b border-l-2 border-b-ca-navy/5 px-4 py-3 last:border-b-0 ${accent}`}>
      <div className="grid gap-2.5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,3.15fr)] xl:gap-5">
        <div className="min-w-0">
          <Link href={`/admin/notes/orders/${order.id}`} className="block w-fit max-w-full rounded-lg text-left ca-focus">
            <span className="block truncate font-heading text-base font-bold text-[var(--ca-navy)]">{order.customer_name}</span>
            <span className="block text-sm tabular-nums text-ca-navy/75">{phone || orderIndexLabel(order.order_no)}</span>
            {sharedCity && <span className="block truncate text-[12px] text-ca-navy/55">{sharedCity}</span>}
            {cities.length > 1 && <span className="block text-[12px] text-ca-navy/55">{cities.length} destinations</span>}
          </Link>
          {single && (
            <span className="mt-1 hidden xl:block">
              <InvoiceControl line={single} withLabel />
            </span>
          )}
          <span className="mt-1 block text-[11px] text-ca-navy/45">
            {multi && order.group ? `${paidCount} paid orders · ${formatPaise(order.group.paid_total_paise)} · ` : ""}
            {order.group ? `${order.group.attempts} ${order.group.attempts === 1 ? "attempt" : "attempts"}` : formatAdminWhen(order.placed_at)}
          </span>
          {order.group?.matched_order_no && <span className="block text-[11px] text-ca-navy/55">Matched attempt {order.group.matched_order_no}</span>}
        </div>
        {lines.length ? (
          <div className="min-w-0 divide-y divide-ca-navy/5">
            {lines.map((line) => (
              <OrderLine key={line.id} line={line} multi={multi} showCity={cities.length > 1} />
            ))}
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="block text-sm text-ca-navy/70">No paid order</span>
              <span className="block text-[11px] text-ca-navy/50">
                Previous attempt · {productSummary(order.items)} · {formatPaise(order.total_paise)}
              </span>
            </div>
            <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE.neutral}`}>{fulfillmentLabel(order.status, false)}</span>
            <Link href={`/admin/notes/orders/${order.id}`} className={DETAILS}>
              View details
            </Link>
          </div>
        )}
      </div>
    </li>
  );
}
