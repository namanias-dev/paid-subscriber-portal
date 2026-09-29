"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { MapPin, Phone } from "lucide-react";
import { formatPaise } from "@/lib/store/money";
import { formatAdminWhen, orderIndexLabel } from "@/lib/store/adminConsole";
import { opsLines } from "@/lib/store/orderOpsDisplay";
import { productList, productSummary } from "@/lib/store/stages";
import type { AdminOrder } from "./OrderDetail";
import {
  destinationLabel,
  DetailsLink,
  InvoiceAction,
  NeutralPill,
  OpsStrip,
  PackageLine,
  PaidMark,
  StagePill,
  stageAccent,
} from "./OrderOpsCell";

export type PaidLine = NonNullable<NonNullable<AdminOrder["group"]>["paid_orders"]>[number];

export function paidLines(order: AdminOrder): PaidLine[] {
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

/** Both subjects when they fit, otherwise the first and a count. */
function fitProducts(items: Array<{ name: string; qty: number }>, max: number): string {
  const full = productList(items);
  if (items.length <= 1 || full.length <= max) return full;
  return `${productList(items.slice(0, 1))} · +${items.length - 1} more`;
}

/** Everything the card and the desktop row show about a customer, derived once. */
function customerView(order: AdminOrder) {
  const lines = paidLines(order);
  const paidCount = order.group ? order.group.paid_count : lines.length;
  const multi = lines.length > 1;
  const cities = [...new Set(lines.map((line) => destinationLabel(line.ops)).filter(Boolean))] as string[];
  const unpaidCity = !lines.length && order.address?.city ? [order.address.city, order.address.state].filter(Boolean).join(", ") : null;
  const attempts = order.group?.attempts ?? 0;
  let summary: string | null = null;
  if (multi && order.group) {
    summary = `${paidCount} paid orders · ${formatPaise(order.group.paid_total_paise)}${attempts > paidCount ? ` · ${attempts} attempts` : ""}`;
  } else if (lines.length) {
    summary = attempts > 1 ? `${attempts} attempts · ${paidCount} paid` : null;
  } else {
    summary = attempts > 1 ? `${attempts} attempts` : formatAdminWhen(order.placed_at);
  }
  const flagged = lines.find((line) => opsLines(line).alert);
  return {
    lines,
    multi,
    splitCities: cities.length > 1,
    place: cities.length > 1 ? `${cities.length} destinations` : cities[0] || unpaidCity,
    phone: order.group?.phone || order.phone || null,
    summary,
    matched: order.group?.matched_order_no || null,
    accent: lines.length === 1 ? stageAccent(lines[0]) : flagged ? stageAccent(flagged) : multi ? "bg-ca-navy/25" : "bg-ca-navy/10",
  };
}

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** First-load entry only: later mounts (filters, pages) and reduced motion render in place. */
function useEntry(intro: boolean, index: number) {
  const reduce = useReducedMotion();
  return {
    initial: intro && !reduce ? { opacity: 0, y: 6 } : false,
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.28, ease: EASE_OUT, delay: Math.min(index, 10) * 0.04 },
  } as const;
}

function Accent({ className }: { className: string }) {
  return <span aria-hidden className={`absolute bottom-3 left-0 top-3 w-[3px] rounded-r-full ${className}`} />;
}

function CustomerName({ order, className }: { order: AdminOrder; className: string }) {
  return (
    <Link href={`/admin/notes/orders/${order.id}`} className={`block max-w-full rounded font-heading font-bold text-[var(--ca-navy)] ca-focus ${className}`}>
      {order.customer_name}
    </Link>
  );
}

function PhoneText({ phone, orderNo }: { phone: string | null; orderNo: string }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Phone size={13} strokeWidth={2} aria-hidden="true" className="shrink-0 text-ca-navy/40" />
      {phone || orderIndexLabel(orderNo)}
    </span>
  );
}

function PlaceText({ place }: { place: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <MapPin size={13} strokeWidth={2} aria-hidden="true" className="shrink-0 text-ca-navy/40" />
      <span className="truncate">{place}</span>
    </span>
  );
}

function OrderSummary({ line, max, stacked = false }: { line: PaidLine; max: number; stacked?: boolean }) {
  const full = productList(line.items);
  if (stacked) {
    return (
      <div className="min-w-0 space-y-0.5">
        <span className="block truncate text-[13px] font-medium leading-5 text-ca-navy/90" title={full}>
          {fitProducts(line.items, max)}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-semibold leading-5 tabular-nums text-[var(--ca-navy)]">{formatPaise(line.total_paise)}</span>
          <PaidMark />
        </span>
        <PackageLine ops={line.ops} quiet={opsLines(line).alert === "package"} wrap />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
      <span className="truncate text-[13.5px] font-medium leading-5 text-ca-navy/90" title={full}>
        {fitProducts(line.items, max)}
      </span>
      <span className="text-right text-[14px] font-semibold leading-5 tabular-nums text-[var(--ca-navy)]">{formatPaise(line.total_paise)}</span>
      <PackageLine ops={line.ops} quiet={opsLines(line).alert === "package"} />
      <span className="justify-self-end">
        <PaidMark />
      </span>
    </div>
  );
}

function ModuleLabel({ line, showCity }: { line: PaidLine; showCity: boolean }) {
  const city = destinationLabel(line.ops);
  return (
    <span className="truncate text-[11.5px] font-semibold text-ca-navy/55">
      {orderIndexLabel(line.order_no)}
      {showCity && city ? ` · ${city}` : ""}
    </span>
  );
}

function UnpaidSummary({ order }: { order: AdminOrder }) {
  return (
    <div className="min-w-0">
      <span className="block text-[13px] text-ca-navy/70">No paid order</span>
      <span className="block truncate text-[12px] text-ca-navy/50">
        Previous attempt · {productSummary(order.items)} · {formatPaise(order.total_paise)}
      </span>
    </div>
  );
}

interface ViewProps {
  order: AdminOrder;
  index: number;
  intro: boolean;
}

/** Phones and tablets: one card per customer, one module per paid order. */
export function OrderCustomerCardMobile({ order, index, intro }: ViewProps) {
  const view = customerView(order);
  const entry = useEntry(intro, index);
  const single = view.lines.length === 1 ? view.lines[0] : null;
  return (
    <motion.li
      {...entry}
      className="relative min-w-0 overflow-hidden rounded-[18px] border border-ca-navy/[0.08] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(10,26,63,0.04)]"
    >
      <Accent className={view.accent} />
      <div className="flex items-start justify-between gap-3">
        <CustomerName order={order} className="min-w-0 truncate text-[15px] leading-5" />
        {single ? <StagePill order={single} /> : view.multi ? <NeutralPill>{view.lines.length} orders</NeutralPill> : <StagePill order={order} />}
      </div>
      <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] leading-[18px] text-ca-navy/65">
        <PhoneText phone={view.phone} orderNo={order.order_no} />
        {view.place && <PlaceText place={view.place} />}
      </p>
      {(view.summary || view.matched) && (
        <p className="mt-0.5 truncate text-[11px] text-ca-navy/45">
          {view.summary}
          {view.summary && view.matched ? " · " : ""}
          {view.matched ? `Matched ${view.matched}` : ""}
        </p>
      )}

      {view.lines.map((line) => (
        <section key={line.id} className={view.multi ? "mt-2.5 border-t border-ca-navy/[0.06] pt-2.5" : "mt-2.5"} aria-label={`Order ${orderIndexLabel(line.order_no)}`}>
          {view.multi && (
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <ModuleLabel line={line} showCity={view.splitCities} />
              <StagePill order={line} />
            </div>
          )}
          <OrderSummary line={line} max={30} />
          <OpsStrip order={line} className="mt-2" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <InvoiceAction orderId={line.id} status={line.invoice_status} />
            <DetailsLink orderId={line.id} />
          </div>
        </section>
      ))}

      {!view.lines.length && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <UnpaidSummary order={order} />
          <DetailsLink orderId={order.id} compact />
        </div>
      )}
    </motion.li>
  );
}

export const DESKTOP_COLUMNS = "grid-cols-[minmax(0,0.9fr)_minmax(0,3.1fr)]";
export const DESKTOP_ORDER_COLUMNS = "grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)_7.5rem]";

/** ≥1024px: a dense structured row. Customer on the left, one sub-row per paid order. */
export function OrderCustomerRowDesktop({ order, index, intro }: ViewProps) {
  const view = customerView(order);
  const entry = useEntry(intro, index);
  return (
    <motion.li {...entry} className={`group relative grid gap-4 px-4 py-3 transition-colors duration-150 hover:bg-ca-navy/[0.018] ${DESKTOP_COLUMNS}`}>
      <Accent className={view.accent} />
      <div className="min-w-0 space-y-0.5">
        <CustomerName order={order} className="line-clamp-2 break-words text-[15px] leading-5" />
        <p className="text-[12.5px] leading-5 text-ca-navy/70">
          <PhoneText phone={view.phone} orderNo={order.order_no} />
        </p>
        {view.place && (
          <p className="flex text-[12px] leading-[18px] text-ca-navy/60">
            <PlaceText place={view.place} />
          </p>
        )}
        {view.summary && <p className="text-[11px] text-ca-navy/45">{view.summary}</p>}
        {view.matched && <p className="truncate text-[11px] text-ca-navy/50">Matched {view.matched}</p>}
      </div>

      {view.lines.length ? (
        <div className="min-w-0 divide-y divide-ca-navy/[0.06]">
          {view.lines.map((line) => (
            <div key={line.id} className={`grid items-start gap-4 py-2.5 first:pt-0 last:pb-0 ${DESKTOP_ORDER_COLUMNS}`}>
              <div className="min-w-0 space-y-1">
                {view.multi && (
                  <span className="block">
                    <ModuleLabel line={line} showCity={view.splitCities} />
                  </span>
                )}
                <OrderSummary line={line} max={34} stacked />
              </div>
              <OpsStrip order={line} withPill />
              <div className="flex flex-col items-end gap-1.5">
                <DetailsLink orderId={line.id} compact />
                <InvoiceAction orderId={line.id} status={line.invoice_status} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`grid items-center gap-4 ${DESKTOP_ORDER_COLUMNS}`}>
          <UnpaidSummary order={order} />
          <StagePill order={order} />
          <div className="flex justify-end">
            <DetailsLink orderId={order.id} compact />
          </div>
        </div>
      )}
    </motion.li>
  );
}
