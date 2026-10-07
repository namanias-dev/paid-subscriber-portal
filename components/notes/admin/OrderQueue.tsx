"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, RotateCw, Search } from "lucide-react";
import { formatPaise } from "@/lib/store/money";
import { BUSINESS_CHANNELS } from "@/lib/analytics/notesCommerce";
import OrderDetail, { type AdminOrder } from "./orders/OrderDetail";
import CourierPicker from "./orders/CourierPicker";
import { DESKTOP_COLUMNS, DESKTOP_ORDER_COLUMNS, OrderCustomerCardMobile, OrderCustomerRowDesktop } from "./orders/CustomerViews";
import type { ShippingRateStats } from "@/lib/store/orderOpsDisplay";

const REFRESH_MS = 45_000;
const REFRESH_MIN_GAP_MS = 10_000;
const PAGE = 25;

const FILTERS = [
  { key: "", label: "All customers", count: "customers" },
  { key: "paid", label: "Paid customers", count: "paid_customers" },
  { key: "new", label: "New", count: "new" },
  { key: "preparing", label: "Preparing", count: "preparing" },
  { key: "printing", label: "Printing", count: "printing" },
  { key: "packed", label: "Packed", count: "packed" },
  { key: "pickup", label: "Courier pickup", count: "pickup" },
  { key: "shipped", label: "Shipped", count: "transit" },
  { key: "delivered", label: "Delivered", count: "delivered" },
  { key: "ready_for_collection", label: "Ready for collection", count: "ready_for_collection" },
  { key: "collected", label: "Collected", count: "collected" },
  { key: "issues", label: "Issues", count: "issues" },
] as const;

/** Fulfillment method is its own axis, independent of the status chips. */
const METHOD_FILTERS = [
  { key: "", label: "All fulfilment" },
  { key: "delivery", label: "Delivery" },
  { key: "academy_pickup", label: "Academy Pickup" },
] as const;

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The list renders only after the client-side admin session check, so there is no server pass to match. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => false);
}

function readParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    bucket: params.get("status") || "",
    q: params.get("q") || "",
    sort: params.get("sort") || "newest",
    action: params.get("action") === "required",
    acq: params.get("acq") || "",
    fulfillment: params.get("fulfillment") || "",
    code: params.get("code") || "",
    offset: Number(params.get("offset") || 0),
  };
}

export default function NotesOrderQueue() {
  const initial = typeof window === "undefined" ? { bucket: "", q: "", sort: "newest", action: false, acq: "", fulfillment: "", code: "", offset: 0 } : readParams();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [shippingRate, setShippingRate] = useState<ShippingRateStats | null>(null);
  const [products, setProducts] = useState<Array<{ name: string; orders: number; units: number }>>([]);
  const [total, setTotal] = useState(0);
  const [bucket, setBucket] = useState(initial.bucket === "issues" ? "" : initial.bucket);
  const [issueOnly, setIssueOnly] = useState(initial.bucket === "issues");
  const [actionOnly, setActionOnly] = useState(initial.action);
  const [acq, setAcq] = useState(initial.acq);
  const [fulfillment, setFulfillment] = useState(initial.fulfillment === "delivery" || initial.fulfillment === "academy_pickup" ? initial.fulfillment : "");
  const fulfillmentRef = useRef(fulfillment);
  fulfillmentRef.current = fulfillment;
  const [code, setCode] = useState(initial.code);
  const codeRef = useRef(code);
  codeRef.current = code;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const queryRef = useRef(q);
  const desktop = useIsDesktop();
  const intro = useRef(true);
  const railRef = useRef<HTMLDivElement>(null);

  const writeUrl = useCallback((next: { bucket: string; issue: boolean; action: boolean; acq: string; q: string; sort: string; offset: number; fulfillment?: string; code?: string }) => {
    const params = new URLSearchParams();
    if (next.issue) params.set("status", "issues");
    else if (next.bucket) params.set("status", next.bucket);
    if (next.action) params.set("action", "required");
    if (next.acq) params.set("acq", next.acq);
    const method = next.fulfillment ?? fulfillmentRef.current;
    if (method) params.set("fulfillment", method);
    const codeValue = next.code ?? codeRef.current;
    if (codeValue) params.set("code", codeValue);
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
    if (!opts?.silent) {
      setLoading(true);
      setLoadError(null);
    }
    const params = new URLSearchParams();
    if (bucket) params.set("bucket", bucket);
    if (issueOnly) params.set("issue", "open");
    if (actionOnly) params.set("action", "required");
    if (acq) params.set("acq", acq);
    if (fulfillment) params.set("fulfillment", fulfillment);
    if (code) params.set("code", code);
    if (q.trim()) params.set("q", q.trim());
    if (sort) params.set("sort", sort);
    params.set("limit", String(PAGE));
    params.set("offset", String(offset));
    let json: Record<string, unknown> & { orders?: AdminOrder[]; counts?: Record<string, unknown> & { products?: Array<{ name: string; orders: number; units: number }>; shipping_rate?: ShippingRateStats } };
    try {
      const res = await fetch(`/api/admin/notes/orders?${params}`, { cache: "no-store" });
      if (opts?.silent && !res.ok) return;
      json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `Request failed (${res.status})`);
    } catch (error) {
      if (opts?.silent || seq !== requestSeq.current) return;
      setLoadError(error instanceof Error && error.message ? error.message : "Network error");
      setLoading(false);
      return;
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
    setLoadError(null);
    setLoading(false);
  }, [bucket, issueOnly, actionOnly, acq, fulfillment, code, q, sort, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading && orders.length) intro.current = false;
  }, [loading, orders.length]);

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

  useEffect(() => {
    const rail = railRef.current;
    const chip = rail?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!rail || !chip || rail.scrollWidth <= rail.clientWidth) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    const left = chip.offsetLeft - 16;
    const right = chip.offsetLeft + chip.offsetWidth + 16 - rail.clientWidth;
    if (rail.scrollLeft > left) rail.scrollTo({ left, behavior });
    else if (rail.scrollLeft < right) rail.scrollTo({ left: right, behavior });
  }, [bucket, issueOnly, actionOnly]);

  function applyFilter(key: string) {
    const issues = key === "issues";
    setIssueOnly(issues);
    setBucket(issues ? "" : key);
    setActionOnly(false);
    setOffset(0);
    writeUrl({ bucket: issues ? "" : key, issue: issues, action: false, acq, q, sort, offset: 0 });
  }

  function clearFilters() {
    setIssueOnly(false);
    setBucket("");
    setActionOnly(false);
    setAcq("");
    setFulfillment("");
    setCode("");
    setQ("");
    setOffset(0);
    writeUrl({ bucket: "", issue: false, action: false, acq: "", q: "", sort, offset: 0, fulfillment: "", code: "" });
  }

  const open = orders.find((row) => row.id === openId) || null;
  const compare = orders.find((row) => row.id === compareId) || null;
  const filtered = Boolean(q || bucket || issueOnly || actionOnly || acq || fulfillment || code);

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

  const kpis: Array<[string, string, string, number | string | undefined]> = [
    ["paid", "Paid orders", "paid", counts.paid],
    ["sales", "Paid sales", "paid", counts.paid_sales_paise != null ? formatPaise(Number(counts.paid_sales_paise)) : "–"],
    ["rate", "", "", undefined],
    ["new", "New", "new", counts.new],
    ["preparing", "Preparing", "preparing", counts.preparing],
    ["printing", "Printing", "printing", counts.printing],
    ["packed", "Packed", "packed", counts.packed],
    ["pickup", "Courier pickup", "pickup", counts.pickup],
    ["transit", "In transit", "shipped", counts.transit],
    ["delivered", "Delivered", "delivered", counts.delivered],
    ["ready_for_collection", "Ready for collection", "ready_for_collection", counts.ready_for_collection],
    ["issues", "Issues", "issues", counts.issues],
  ];

  return (
    <div className="mx-auto max-w-6xl pb-16 lg:pb-0">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 sm:mb-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Notes Store</p>
          <h1 className="font-heading text-2xl font-bold text-[var(--ca-navy)] sm:text-3xl">Orders</h1>
          <p className="mt-0.5 text-xs text-ca-navy/55">
            {counts.paid ?? "–"} paid orders · {counts.paid_customers ?? "–"} paid customers · {counts.attempts ?? "–"} payment attempts
          </p>
        </div>
        <div className="flex gap-1.5">
          {showAnalytics && (
            <Link href="/admin/notes/analytics" className="inline-flex min-h-10 items-center rounded-full border border-ca-navy/15 bg-white px-4 text-sm font-semibold text-[var(--ca-navy)] transition duration-150 hover:-translate-y-px active:scale-[0.98] motion-reduce:transform-none">
              Analytics
            </Link>
          )}
          <Link href="/admin/notes/leads" className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-semibold text-ca-navy/70 hover:text-[var(--ca-navy)]">
            Checkout leads
          </Link>
        </div>
      </header>

      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:mb-4 sm:px-0">
        {kpis.map(([key, label, filter, value]) => {
          if (key === "rate") return <ShippingRateTile key="rate" stats={shippingRate} />;
          const selected = filter === "issues" ? issueOnly : !issueOnly && bucket === filter;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected}
              onClick={() => applyFilter(filter)}
              className={`h-[3.75rem] min-w-[7.25rem] shrink-0 rounded-2xl border px-3 py-2 text-left transition-colors duration-150 sm:h-[4.25rem] sm:min-w-[7.5rem] sm:py-2.5 ${
                selected ? "border-[var(--ca-navy)] bg-[var(--ca-navy)] text-white" : "border-ca-navy/10 bg-white hover:border-ca-navy/20"
              }`}
            >
              <span className={`block text-[10px] font-semibold uppercase tracking-wide ${selected ? "text-white/70" : "text-ca-navy/45"}`}>{label}</span>
              <span className="mt-0.5 block font-heading text-lg font-bold tabular-nums sm:text-xl">{value ?? "–"}</span>
            </button>
          );
        })}
        {products.map((product) => (
          <ProductTile key={product.name} product={product} className="sm:hidden" />
        ))}
      </div>

      {products.length > 0 && (
        <div className="-mx-1 mb-4 hidden gap-2 overflow-x-auto px-1 pb-1 sm:flex">
          <p className="sr-only">Paid by product</p>
          {products.map((product) => (
            <ProductTile key={product.name} product={product} />
          ))}
        </div>
      )}

      <div className="mb-2.5 flex items-center gap-2 sm:mb-3">
        <form
          className="relative min-w-0 flex-1"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            queryRef.current = q;
            writeUrl({ bucket, issue: issueOnly, action: actionOnly, acq, q, sort, offset: 0 });
            void load();
          }}
        >
          <Search size={15} strokeWidth={2} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ca-navy/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Order, customer, phone, email, AWB"
            aria-label="Search orders"
            className="min-h-11 w-full rounded-2xl border border-ca-navy/10 bg-white pl-9 pr-3 text-sm"
          />
        </form>
        <select
          aria-label="Sort orders"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setOffset(0);
            writeUrl({ bucket, issue: issueOnly, action: actionOnly, acq, q, sort: e.target.value, offset: 0 });
          }}
          className="min-h-11 w-[7.5rem] shrink-0 rounded-full border border-ca-navy/10 bg-white px-3 text-sm sm:w-auto"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="value_desc">Highest value</option>
          <option value="value_asc">Lowest value</option>
          <option value="updated">Recently updated</option>
          <option value="action">Action required first</option>
        </select>
      </div>

      <div ref={railRef} className="no-scrollbar relative -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:mb-4 sm:flex-wrap sm:overflow-visible sm:px-0">
        {FILTERS.map((filter) => {
          const active = filter.key === "issues" ? issueOnly : !issueOnly && bucket === filter.key;
          const count = counts[filter.count];
          return (
            <button
              key={filter.key || "all"}
              type="button"
              aria-pressed={active}
              onClick={() => applyFilter(filter.key)}
              className={`min-h-10 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition-colors duration-150 ${
                active ? "border-[var(--ca-navy)] bg-[var(--ca-navy)] text-white" : "border-ca-navy/10 bg-white text-[var(--ca-navy)] hover:border-ca-navy/25"
              }`}
            >
              {filter.label}
              {count != null && <span className={`ml-1.5 tabular-nums ${active ? "text-white/70" : "text-ca-navy/45"}`}>{count}</span>}
            </button>
          );
        })}
        <div role="group" aria-label="Fulfillment method" className="flex shrink-0 gap-0.5 rounded-full border border-ca-navy/10 bg-white p-0.5">
          {METHOD_FILTERS.map((option) => {
            const active = fulfillment === option.key;
            return (
              <button
                key={option.key || "all-methods"}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setFulfillment(option.key);
                  setOffset(0);
                  writeUrl({ bucket, issue: issueOnly, action: actionOnly, acq, q, sort, offset: 0, fulfillment: option.key });
                }}
                className={`min-h-9 whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold transition-colors duration-150 ${
                  active ? "bg-[var(--ca-navy)] text-white" : "text-[var(--ca-navy)] hover:bg-ca-navy/[0.04]"
                }`}
              >
                {option.label}
                {option.key === "academy_pickup" && counts.pickup_active != null && (
                  <span className={`ml-1.5 tabular-nums ${active ? "text-white/70" : "text-ca-navy/45"}`} title="Active Academy Pickup orders">{counts.pickup_active}</span>
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-pressed={actionOnly}
          onClick={() => {
            setActionOnly((v) => !v);
            setOffset(0);
            writeUrl({ bucket, issue: issueOnly, action: !actionOnly, acq, q, sort, offset: 0 });
          }}
          className={`min-h-10 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition-colors duration-150 ${
            actionOnly ? "border-amber-800 bg-amber-800 text-white" : "border-ca-navy/10 bg-white text-[var(--ca-navy)] hover:border-ca-navy/25"
          }`}
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
          className="min-h-10 shrink-0 rounded-full border border-ca-navy/10 bg-white px-3 text-[13px]"
        >
          <option value="">All sources</option>
          {BUSINESS_CHANNELS.filter((channel) => channel !== "Unknown").map((channel) => (
            <option key={channel} value={channel}>{channel}</option>
          ))}
        </select>
      </div>

      {code && (
        <p className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-ca-navy/[0.08] bg-white px-3 py-2 text-sm text-[var(--ca-navy)]">
          <span>Discount code {code}</span>
          <button type="button" className="min-h-11 font-semibold" onClick={() => { setCode(""); setOffset(0); writeUrl({ bucket, issue: issueOnly, action: actionOnly, acq, q, sort, offset: 0, code: "" }); }}>Clear</button>
        </p>
      )}

      {msg && <p className="mb-3 rounded-xl border border-ca-navy/[0.08] bg-white px-3 py-2 text-sm text-[var(--ca-navy)]">{msg}</p>}

      {loading ? (
        <ListSkeleton desktop={desktop} />
      ) : loadError ? (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200/80 bg-white px-4 py-3.5">
          <AlertTriangle size={16} strokeWidth={2.25} aria-hidden="true" className="mt-0.5 shrink-0 text-red-700" />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-[var(--ca-navy)]">Couldn&apos;t load orders</p>
            <p className="truncate text-[12px] text-ca-navy/60">{loadError}</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-[var(--ca-navy)] px-3.5 text-[13px] font-semibold text-white transition duration-150 active:scale-[0.98] motion-reduce:transform-none"
          >
            <RotateCw size={14} strokeWidth={2.25} aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-ca-navy/[0.08] bg-white px-6 py-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-ca-navy/[0.05] text-ca-navy/50">
            <Inbox size={18} strokeWidth={2} aria-hidden="true" />
          </span>
          <p className="text-[14px] font-semibold text-[var(--ca-navy)]">{filtered ? "No orders match these filters" : "No orders yet"}</p>
          {filtered && (
            <button type="button" onClick={clearFilters} className="min-h-11 rounded-full px-3 text-[13px] font-semibold text-ca-navy/70 hover:text-[var(--ca-navy)]">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        desktop ? (
          <div className="overflow-hidden rounded-2xl border border-ca-navy/[0.08] bg-white shadow-[0_1px_2px_rgba(10,26,63,0.04)]">
            <div aria-hidden className={`grid gap-4 border-b border-ca-navy/[0.06] bg-ca-navy/[0.02] px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ca-navy/45 ${DESKTOP_COLUMNS}`}>
              <span>Customer</span>
              <span className={`grid gap-4 ${DESKTOP_ORDER_COLUMNS}`}>
                <span>Order · Package</span>
                <span>Fulfillment</span>
                <span className="text-right">Action</span>
              </span>
            </div>
            <ul className="divide-y divide-ca-navy/[0.06]">
              {orders.map((order, index) => (
                <OrderCustomerRowDesktop key={order.id} order={order} index={index} intro={intro.current} />
              ))}
            </ul>
          </div>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2 md:items-start md:gap-2.5">
            {orders.map((order, index) => (
              <OrderCustomerCardMobile key={order.id} order={order} index={index} intro={intro.current} />
            ))}
          </ul>
        )
      )}

      {!loading && !loadError && orders.length > 0 && (
        <nav aria-label="Pagination" className="mt-3 flex items-center justify-between gap-2 text-[13px] sm:mt-4">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - PAGE))}
            className="inline-flex min-h-11 items-center gap-0.5 rounded-full border border-ca-navy/10 bg-white pl-2.5 pr-3.5 font-semibold text-[var(--ca-navy)] disabled:border-transparent disabled:bg-transparent disabled:opacity-40"
          >
            <ChevronLeft size={15} strokeWidth={2.25} aria-hidden="true" />
            Prev
          </button>
          <span className="tabular-nums text-ca-navy/50">
            {offset + 1}–{Math.min(offset + orders.length, total)} of {total}
          </span>
          <button
            type="button"
            disabled={offset + PAGE >= total}
            onClick={() => setOffset((n) => n + PAGE)}
            className="inline-flex min-h-11 items-center gap-0.5 rounded-full border border-ca-navy/10 bg-white pl-3.5 pr-2.5 font-semibold text-[var(--ca-navy)] disabled:border-transparent disabled:bg-transparent disabled:opacity-40"
          >
            Next
            <ChevronRight size={15} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </nav>
      )}

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

function ProductTile({ product, className = "" }: { product: { name: string; orders: number; units: number }; className?: string }) {
  return (
    <div className={`h-[3.75rem] min-w-[8.5rem] shrink-0 rounded-2xl border border-ca-navy/10 bg-white px-3 py-2 sm:h-auto sm:min-w-[9rem] ${className}`}>
      <span className="block truncate text-sm font-semibold text-[var(--ca-navy)]">{product.name.replace(/ notes$/i, "")}</span>
      <span className="mt-0.5 block text-xs text-ca-navy/55" title="An order with more than one subject is counted in each subject. These numbers do not have to add up to paid orders.">
        {product.units} units · {product.orders} orders
      </span>
    </div>
  );
}

function ListSkeleton({ desktop }: { desktop: boolean }) {
  const bar = "rounded bg-ca-navy/[0.06] motion-safe:animate-pulse";
  if (desktop) {
    return (
      <div role="status" className="overflow-hidden rounded-2xl border border-ca-navy/[0.08] bg-white">
        <span className="sr-only">Loading orders</span>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} aria-hidden className={`grid gap-4 border-b border-ca-navy/[0.06] px-4 py-3 last:border-b-0 ${DESKTOP_COLUMNS}`}>
            <div className="space-y-2">
              <div className={`h-4 w-32 ${bar}`} />
              <div className={`h-3 w-24 ${bar}`} />
              <div className={`h-3 w-28 ${bar}`} />
            </div>
            <div className={`grid gap-4 ${DESKTOP_ORDER_COLUMNS}`}>
              <div className="space-y-2">
                <div className={`h-4 w-28 ${bar}`} />
                <div className={`h-4 w-20 ${bar}`} />
                <div className={`h-3 w-32 ${bar}`} />
              </div>
              <div className={`h-[5.25rem] rounded-xl ${bar}`} />
              <div className={`ml-auto h-11 w-28 rounded-full ${bar}`} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div role="status">
      <span className="sr-only">Loading orders</span>
      <ul aria-hidden className="grid gap-2 md:grid-cols-2 md:gap-2.5">
        {[0, 1, 2].map((i) => (
          <li key={i} className="rounded-[18px] border border-ca-navy/[0.08] bg-white px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <div className={`h-4 w-36 ${bar}`} />
                <div className={`h-3 w-48 ${bar}`} />
              </div>
              <div className={`h-5 w-16 rounded-md ${bar}`} />
            </div>
            <div className="mt-3 flex justify-between">
              <div className={`h-4 w-32 ${bar}`} />
              <div className={`h-4 w-16 ${bar}`} />
            </div>
            <div className={`mt-1.5 h-3 w-40 ${bar}`} />
            <div className={`mt-2.5 h-[4.25rem] rounded-xl ${bar}`} />
            <div className="mt-2.5 flex justify-between">
              <div className={`h-11 w-24 rounded-full ${bar}`} />
              <div className={`h-11 w-32 rounded-full ${bar}`} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const RATE_HINT =
  "Average booked courier rate across active/completed shipments with a saved rate. Cancelled shipments and customer shipping charges are excluded. Covers the whole store, like the other tiles, not the list filter.";

function ShippingRateTile({ stats }: { stats: ShippingRateStats | null }) {
  const coverage = stats
    ? `${stats.count} shipments with saved rate${stats.unknown ? ` · ${stats.unknown} without a saved rate (excluded)` : ""}`
    : "";
  const range = stats?.count && stats.min_paise != null && stats.max_paise != null ? `${formatPaise(stats.min_paise)} min · ${formatPaise(stats.max_paise)} max · ` : null;
  return (
    <div
      title={coverage ? `${RATE_HINT} ${coverage}.` : RATE_HINT}
      className="h-[3.75rem] min-w-[8.5rem] shrink-0 rounded-2xl border border-ca-navy/10 bg-white px-3 py-1.5 text-left sm:h-[4.25rem] sm:min-w-[12rem] sm:py-2"
    >
      <span className="block text-[10px] font-semibold uppercase leading-[14px] tracking-wide text-ca-navy/45">Avg shipping rate</span>
      <span className="block font-heading text-lg font-bold leading-6 tabular-nums text-[var(--ca-navy)] sm:text-xl">
        {stats?.avg_paise != null ? formatPaise(stats.avg_paise) : "–"}
      </span>
      <span className="block whitespace-nowrap text-[10px] leading-[14px] tabular-nums text-ca-navy/50">
        {stats?.count ? (
          <>
            {range && <span className="hidden sm:inline">{range}</span>}
            {stats.count} rated
          </>
        ) : (
          "No saved rates yet"
        )}
      </span>
      {coverage && <span className="sr-only">{coverage}</span>}
    </div>
  );
}
