"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ChevronRight, CircleCheck, Clock3, Package } from "lucide-react";
import { fulfillmentLabel, fulfillmentTone, invoiceStatusLabel, showAdminViewInvoice, type BadgeTone } from "@/lib/store/adminConsole";
import { formatPackageDims, formatPackageWeight, opsLines, PACKAGE_SOURCE_LABEL, type OrderOps } from "@/lib/store/orderOpsDisplay";
import { FulfillmentTimeline } from "./FulfillmentTimeline";
import { METHOD_BADGE, type FulfillmentMethod } from "@/lib/store/fulfillment";
import { ViewInvoiceButton } from "./InvoiceActions";

export interface OpsOrder {
  status: string;
  ops?: OrderOps | null;
}

interface StageStyle {
  pill: string;
  strip: string;
  accent: string;
}

/** Colour per canonical stage key. The stage itself always comes from the shared ladder. */
const STAGE_STYLE: Record<string, StageStyle> = {
  confirmed: { pill: "bg-ca-navy/[0.06] text-[var(--ca-navy)] ring-ca-navy/10", strip: "bg-ca-navy/[0.035]", accent: "bg-ca-navy/30" },
  preparing: { pill: "bg-amber-50 text-amber-900 ring-amber-200/80", strip: "bg-[#faf6ec]", accent: "bg-amber-500/70" },
  printing: { pill: "bg-violet-50 text-violet-900 ring-violet-200/80", strip: "bg-violet-50/70", accent: "bg-violet-500/70" },
  packed: { pill: "bg-slate-100 text-slate-800 ring-slate-300/70", strip: "bg-slate-100/70", accent: "bg-slate-600/70" },
  pickup: {
    pill: "bg-[rgba(212,175,55,0.15)] text-[var(--ca-gold-dark)] ring-[rgba(212,175,55,0.4)]",
    strip: "bg-[rgba(212,175,55,0.09)]",
    accent: "bg-[var(--ca-gold)]",
  },
  shipped: { pill: "bg-sky-50 text-sky-900 ring-sky-200/80", strip: "bg-sky-50/80", accent: "bg-sky-600/80" },
  transit: { pill: "bg-blue-50 text-blue-900 ring-blue-200/80", strip: "bg-blue-50/70", accent: "bg-blue-700/75" },
  delivery: { pill: "bg-[var(--ca-navy)] text-white ring-[var(--ca-navy)]", strip: "bg-ca-navy/[0.06]", accent: "bg-[var(--ca-navy)]" },
  delivered: { pill: "bg-emerald-50 text-emerald-900 ring-emerald-200/80", strip: "bg-emerald-50/70", accent: "bg-emerald-600/80" },
  // Academy Pickup rungs
  ready: {
    pill: "bg-[rgba(212,175,55,0.15)] text-[var(--ca-gold-dark)] ring-[rgba(212,175,55,0.4)]",
    strip: "bg-[rgba(212,175,55,0.09)]",
    accent: "bg-[var(--ca-gold)]",
  },
  collected: { pill: "bg-emerald-50 text-emerald-900 ring-emerald-200/80", strip: "bg-emerald-50/70", accent: "bg-emerald-600/80" },
};

const AGE_TEXT = { neutral: "text-ca-navy/60", amber: "text-amber-900", strong: "font-semibold text-amber-950" } as const;

/** Order-level fulfilment method. Quiet for Delivery, gold for Academy Pickup; never louder than the stage. */
export function MethodBadge({ method }: { method?: FulfillmentMethod | null }) {
  const pickup = method === "ACADEMY_PICKUP";
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded px-1.5 py-[1px] text-[10px] font-semibold tracking-[0.08em] ring-1 ring-inset ${
        pickup ? "bg-[rgba(212,175,55,0.12)] text-[var(--ca-gold-dark)] ring-[rgba(212,175,55,0.35)]" : "bg-transparent text-ca-navy/50 ring-ca-navy/15"
      }`}
    >
      {METHOD_BADGE[pickup ? "ACADEMY_PICKUP" : "DELIVERY"]}
    </span>
  );
}

const ALERT_STYLE = {
  package: { strip: "bg-amber-50 ring-1 ring-inset ring-amber-300/60", accent: "bg-amber-600", text: "text-amber-950", icon: "text-amber-700" },
  issue: { strip: "bg-red-50/80 ring-1 ring-inset ring-red-200/70", accent: "bg-red-700/70", text: "text-red-950", icon: "text-red-700" },
} as const;

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-ca-navy/5 text-[var(--ca-navy)] ring-ca-navy/10",
  navy: "bg-[var(--ca-navy)] text-white ring-[var(--ca-navy)]",
  gold: "bg-[rgba(212,175,55,0.2)] text-[var(--ca-gold-dark)] ring-[rgba(212,175,55,0.4)]",
  amber: "bg-amber-100 text-amber-950 ring-amber-200",
  green: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  red: "bg-red-50 text-red-900 ring-red-200",
};

const RECORDED = "Time recorded by Notes tracking sync";
const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const PILL = "inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset";

function styleFor(order: OpsOrder): StageStyle | null {
  const key = order.ops?.stage?.key;
  return key ? STAGE_STYLE[key] || null : null;
}

export function StagePill({ order }: { order: OpsOrder }) {
  const stage = order.ops?.stage || null;
  const label = stage ? stage.label : fulfillmentLabel(order.status, false);
  const tone = styleFor(order)?.pill || TONE[fulfillmentTone(order.status, false)];
  return <span className={`${PILL} ${tone}`}>{label}</span>;
}

export function NeutralPill({ children }: { children: React.ReactNode }) {
  return <span className={`${PILL} ${TONE.neutral}`}>{children}</span>;
}

/** 3px accent colour for a card or row: an open issue outranks the stage colour. */
export function stageAccent(order: OpsOrder): string {
  const alert = opsLines(order).alert;
  if (alert) return ALERT_STYLE[alert].accent;
  return styleFor(order)?.accent || "bg-ca-navy/15";
}

/** Text that crossfades with a short slide when it changes, without moving the layout. */
function Swap({
  id,
  className,
  title,
  layout = "truncate",
  children,
}: {
  id: string;
  className?: string;
  title?: string;
  layout?: "truncate" | "clamp" | "row";
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const slide = reduce ? 0 : 4;
  return (
    <span className={`relative block min-w-0 overflow-hidden ${className || ""}`} title={title}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={id}
          className={layout === "clamp" ? "line-clamp-2" : layout === "row" ? "flex min-w-0 items-baseline" : "block truncate"}
          initial={{ opacity: 0, y: slide }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -slide }}
          transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * The operation strip: what is happening now, the one supporting fact, and the ladder.
 * `withPill` puts the stage pill inside the strip (desktop rows); cards show it in their header.
 */
export function OpsStrip({ order, withPill = false, className = "" }: { order: OpsOrder; withPill?: boolean; className?: string }) {
  const stage = order.ops?.stage || null;
  const lines = opsLines(order);
  const alert = lines.alert ? ALERT_STYLE[lines.alert] : null;
  const tint = alert?.strip || styleFor(order)?.strip || "bg-ca-navy/[0.035]";
  const count = stage ? (
    <span className="shrink-0 text-[11px] font-medium tabular-nums text-ca-navy/45">
      {stage.position} of {stage.total}
    </span>
  ) : null;
  return (
    <div className={`min-w-0 rounded-xl px-3 py-[7px] ${tint} ${className}`}>
      {withPill && (
        <div className="mb-1 flex items-center justify-between gap-2">
          <StagePill order={order} />
          {count}
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2">
        {alert && <AlertTriangle size={15} strokeWidth={2.25} aria-hidden="true" className={`shrink-0 ${alert.icon}`} />}
        <Swap
          id={`${lines.headline}|${lines.rate || ""}`}
          className={`flex-1 text-[13px] font-semibold leading-5 ${alert ? alert.text : "text-[var(--ca-navy)]"}`}
          title={lines.recorded && !lines.detail ? RECORDED : lines.headline}
          layout="row"
        >
          <span className="min-w-0 truncate">{lines.headline}</span>
          {lines.rate && (
            <span className={`shrink-0 whitespace-pre ${lines.rate === "Rate unavailable" ? "font-normal text-ca-navy/50" : "tabular-nums"}`}> · {lines.rate}</span>
          )}
        </Swap>
        {!withPill && count}
      </div>
      {lines.detail && (
        <Swap
          id={lines.detail}
          layout={withPill ? "clamp" : "truncate"}
          className={`text-[12px] leading-[18px] ${alert ? `${alert.text} opacity-80` : lines.age ? AGE_TEXT[lines.age] : "text-ca-navy/60"}`}
          title={lines.recorded ? RECORDED : lines.detail}
        >
          {lines.detail}
        </Swap>
      )}
      {order.ops?.method === "ACADEMY_PICKUP" && order.ops.next && !alert && (
        <p className="truncate text-[11.5px] leading-4 text-ca-navy/55">Next: {order.ops.next}</p>
      )}
      {lines.quotes && (
        <p className="truncate text-[11px] leading-4 text-ca-navy/45" title="Saved courier comparison. Open details for the full price history.">{lines.quotes}</p>
      )}
      {stage && (
        <div className="mt-1 flex h-2.5 items-center">
          <FulfillmentTimeline status={order.status} method={order.ops?.method || "DELIVERY"} compact fill />
        </div>
      )}
    </div>
  );
}

/** `quiet` when the status strip already carries the Package required action. */
export function PackageLine({ ops, quiet = false, wrap = false }: { ops?: OrderOps | null; quiet?: boolean; wrap?: boolean }) {
  // Academy Pickup has no courier package; nothing to weigh or enter.
  if (!ops || ops.method === "ACADEMY_PICKUP") return null;
  const pkg = ops.package;
  if (!pkg && quiet) {
    return (
      <span className="flex min-w-0 items-center gap-1 text-[12px] text-ca-navy/45">
        <Package size={13} strokeWidth={2} aria-hidden="true" className="shrink-0" />
        Package not entered
      </span>
    );
  }
  if (!pkg) {
    return (
      <span className="flex min-w-0 items-center gap-1 text-[12px] font-semibold text-amber-800">
        <AlertTriangle size={13} strokeWidth={2.25} aria-hidden="true" className="shrink-0" />
        Package required
      </span>
    );
  }
  const source = PACKAGE_SOURCE_LABEL[pkg.source];
  return (
    <span className={`flex min-w-0 gap-1 text-[12px] text-ca-navy/65 ${wrap ? "items-start" : "items-center"}`} title={source}>
      <Package size={13} strokeWidth={2} aria-hidden="true" className={`shrink-0 text-ca-navy/45 ${wrap ? "mt-[3px]" : ""}`} />
      <span className={wrap ? "min-w-0" : "truncate"}>
        <span className="whitespace-nowrap tabular-nums">
          {formatPackageWeight(pkg.weight_grams)} · {formatPackageDims(pkg)}
        </span>{" "}
        <span className="whitespace-nowrap text-[11px] text-ca-navy/40">{source}</span>
      </span>
    </span>
  );
}

export function PaidMark() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] font-medium text-emerald-800">
      <CircleCheck size={13} strokeWidth={2.25} aria-hidden="true" />
      Paid
    </span>
  );
}

/** Invoice button when ready; otherwise only the states staff must notice. */
export function InvoiceAction({ orderId, status }: { orderId: string; status: string | null | undefined }) {
  if (showAdminViewInvoice(status)) return <ViewInvoiceButton orderId={orderId} chip />;
  const label = invoiceStatusLabel(status);
  if (label === "Invoice generating") {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] text-ca-navy/55">
        <Clock3 size={13} strokeWidth={2} aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (label === "Invoice needs attention") {
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-amber-800">
        <AlertTriangle size={13} strokeWidth={2.25} aria-hidden="true" />
        {label}
      </span>
    );
  }
  return null;
}

export function DetailsLink({ orderId, compact = false }: { orderId: string; compact?: boolean }) {
  return (
    <Link
      href={`/admin/notes/orders/${orderId}`}
      className={`group/cta inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-[var(--ca-navy)] font-semibold text-white transition duration-150 hover:-translate-y-px hover:bg-[#0d2250] active:scale-[0.98] motion-reduce:transform-none ca-focus ${
        compact ? "pl-3 pr-2 text-[12.5px]" : "pl-4 pr-3 text-[13px]"
      }`}
    >
      View details
      <ChevronRight size={15} strokeWidth={2.25} aria-hidden="true" className="transition-transform duration-150 group-hover/cta:translate-x-0.5 motion-reduce:transform-none" />
    </Link>
  );
}

export function destinationLabel(ops?: OrderOps | null): string | null {
  if (!ops?.city) return null;
  return ops.state ? `${ops.city}, ${ops.state}` : ops.city;
}
