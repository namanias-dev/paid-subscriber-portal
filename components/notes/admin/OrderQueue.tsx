"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatPaise } from "@/lib/store/money";
import {
  fulfillmentLabel,
  fulfillmentTone,
  formatAdminWhen,
  invoiceStatusLabel,
  orderIndexLabel,
  pickupFailedActivity,
  primaryAction,
  PRIMARY_LABEL,
  type BadgeTone,
} from "@/lib/store/adminConsole";
import OrderDetail, { type AdminOrder } from "./orders/OrderDetail";
import CourierPicker from "./orders/CourierPicker";
import { ViewInvoiceButton } from "./orders/InvoiceActions";

const FILTERS = [
  { key: "", label: "All", count: "total" },
  { key: "new", label: "New", count: "new" },
  { key: "preparing", label: "Preparing", count: "preparing" },
  { key: "packed", label: "Packed", count: "packed" },
  { key: "pickup", label: "Pickup", count: "pickup" },
  { key: "shipped", label: "Shipped", count: "transit" },
  { key: "delivered", label: "Delivered", count: "delivered" },
  { key: "issues", label: "Issues", count: "issues" },
] as const;

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
    offset: Number(params.get("offset") || 0),
  };
}

export default function NotesOrderQueue() {
  const initial = typeof window === "undefined" ? { bucket: "", q: "", sort: "newest", action: false, offset: 0 } : readParams();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [bucket, setBucket] = useState(initial.bucket === "issues" ? "" : initial.bucket);
  const [issueOnly, setIssueOnly] = useState(initial.bucket === "issues");
  const [actionOnly, setActionOnly] = useState(initial.action);
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

  const writeUrl = useCallback((next: { bucket: string; issue: boolean; action: boolean; q: string; sort: string; offset: number }) => {
    const params = new URLSearchParams();
    if (next.issue) params.set("status", "issues");
    else if (next.bucket) params.set("status", next.bucket);
    if (next.action) params.set("action", "required");
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
    if (q.trim()) params.set("q", q.trim());
    if (sort) params.set("sort", sort);
    params.set("limit", "25");
    params.set("offset", String(offset));
    const res = await fetch(`/api/admin/notes/orders?${params}`, { cache: "no-store" });
    const json = await res.json();
    const rows = (json.orders || []) as AdminOrder[];
    setOrders(rows);
    setCounts(json.counts || {});
    setTotal(json.total || rows.length);
    setWrites(Boolean(json.writes_authorized));
    setLoading(false);
  }, [bucket, issueOnly, actionOnly, q, sort, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyFilter(key: string) {
    const issues = key === "issues";
    setIssueOnly(issues);
    setBucket(issues ? "" : key);
    setActionOnly(false);
    setOffset(0);
    writeUrl({ bucket: issues ? "" : key, issue: issues, action: false, q, sort, offset: 0 });
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
      <header className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Notes Store</p>
        <h1 className="font-heading text-3xl font-bold text-[var(--ca-navy)]">Orders</h1>
      </header>

      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto pb-1">
        {[
          ["total", "Total", ""],
          ["new", "New", "new"],
          ["packed", "Ready to ship", "packed"],
          ["pickup", "Pickup", "pickup"],
          ["transit", "In transit", "shipped"],
          ["issues", "Issues", "issues"],
        ].map(([countKey, label, filter]) => (
          <button
            key={label}
            type="button"
            onClick={() => (filter === "issues" ? applyFilter("issues") : applyFilter(filter))}
            className="min-w-[8.5rem] shrink-0 rounded-2xl border border-[var(--ca-navy)]/10 bg-white px-3 py-3 text-left"
          >
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-navy)]/45">{label}</span>
            <span className="mt-1 block font-heading text-2xl font-bold text-[var(--ca-navy)]">{counts[countKey] ?? "–"}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            queryRef.current = q;
            writeUrl({ bucket, issue: issueOnly, action: actionOnly, q, sort, offset: 0 });
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
            writeUrl({ bucket, issue: issueOnly, action: actionOnly, q, sort: e.target.value, offset: 0 });
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
            writeUrl({ bucket, issue: issueOnly, action: !actionOnly, q, sort, offset: 0 });
          }}
          className={`min-h-10 rounded-full px-3 text-sm font-semibold ${actionOnly ? "bg-amber-800 text-white" : "bg-white text-[var(--ca-navy)]"}`}
        >
          Action required
        </button>
      </div>

      {msg && <p className="mb-3 rounded-xl bg-white px-3 py-2 text-sm text-[var(--ca-navy)]">{msg}</p>}

      {loading ? (
        <div className="space-y-2" aria-hidden>
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
        </div>
      ) : orders.length === 0 ? (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-[var(--ca-navy)]/60">
          {q || bucket || issueOnly || actionOnly ? "No orders match these filters." : "No orders yet."}
        </p>
      ) : (
        <>
          <ul className="hidden overflow-hidden rounded-2xl bg-white md:block">
            {orders.map((order) => {
              const failed = pickupFailedActivity(order.shipment?.tracking_activity);
              const action = primaryAction({ status: order.status, awb: order.shipment?.awb, pickupFailed: failed, openIssue: order.issue?.open, paymentPending: order.status === "PAYMENT_PENDING" });
              return (
                <li key={order.id} className={`grid grid-cols-[1.3fr_1fr_0.7fr_0.8fr_0.8fr_auto] items-center gap-3 border-b border-[var(--ca-navy)]/5 px-4 py-3 ${order.action_required ? "border-l-2 border-l-amber-500" : ""}`}>
                  <div>
                    <button type="button" onClick={() => openOrder(order.id)} className="text-left">
                      <span className="block font-heading text-base font-bold text-[var(--ca-navy)]">{orderIndexLabel(order.order_no)}</span>
                      <span className="block font-mono text-[11px] text-[var(--ca-navy)]/50">{order.order_no}</span>
                      <span className="block text-sm text-[var(--ca-navy)]">{order.customer_name}</span>
                    </button>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ca-navy)]/45">
                      {invoiceStatusLabel(order.invoice_status)}
                      {order.invoice_status === "READY" && <ViewInvoiceButton orderId={order.id} />}
                    </span>
                  </div>
                  <span className="text-sm text-[var(--ca-navy)]/75">{order.items[0] ? `${order.items[0].name} × ${order.items[0].qty}` : "—"}</span>
                  <span className="text-sm font-semibold tabular-nums">{formatPaise(order.total_paise)}</span>
                  <span className={`w-fit rounded-full px-2 py-1 text-[11px] font-semibold ${TONE[fulfillmentTone(order.status, failed)]}`}>{fulfillmentLabel(order.status, failed)}</span>
                  <span className="text-xs text-[var(--ca-navy)]/60">{order.shipment?.courier || "—"}<br />{formatAdminWhen(order.shipment?.tracking_event_at || order.updated_at || order.placed_at)}</span>
                  <button type="button" onClick={() => openOrder(order.id)} className="min-h-11 rounded-full px-3 text-sm font-semibold text-[var(--ca-navy)]">{PRIMARY_LABEL[action]}</button>
                </li>
              );
            })}
          </ul>
          <ul className="space-y-2 md:hidden">
            {orders.map((order) => {
              const failed = pickupFailedActivity(order.shipment?.tracking_activity);
              return (
                <li key={order.id} className={`rounded-2xl bg-white p-4 ${order.action_required ? "border-l-2 border-l-amber-500" : ""}`}>
                  <button type="button" onClick={() => openOrder(order.id)} className="w-full text-left">
                    <span className="flex items-start justify-between gap-3">
                      <span>
                        <span className="block font-heading text-lg font-bold">{orderIndexLabel(order.order_no)}</span>
                        <span className="block font-mono text-[11px] text-[var(--ca-navy)]/50">{order.order_no}</span>
                        <span className="mt-1 block text-sm">{order.customer_name}</span>
                        <span className="mt-1 block text-[11px] text-[var(--ca-navy)]/45">{invoiceStatusLabel(order.invoice_status)}</span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{formatPaise(order.total_paise)}</span>
                    </span>
                    <span className="mt-3 flex items-center justify-between gap-2">
                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${TONE[fulfillmentTone(order.status, failed)]}`}>{fulfillmentLabel(order.status, failed)}</span>
                      <span className="text-xs text-[var(--ca-navy)]/55">{order.items.length} item{order.items.length === 1 ? "" : "s"}</span>
                    </span>
                  </button>
                  {order.invoice_status === "READY" && (
                    <div className="mt-3">
                      <ViewInvoiceButton orderId={order.id} />
                    </div>
                  )}
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
