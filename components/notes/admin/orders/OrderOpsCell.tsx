import { formatPaise } from "@/lib/store/money";
import { formatAdminWhen, fulfillmentLabel, fulfillmentTone, type BadgeTone } from "@/lib/store/adminConsole";
import { formatPackageDims, formatPackageWeight, PACKAGE_SOURCE_LABEL, type OrderOps } from "@/lib/store/orderOpsDisplay";
import { FulfillmentTimeline } from "./FulfillmentTimeline";

/** Colour per canonical stage key. The stage itself always comes from the shared ladder. */
const STAGE_TONE: Record<string, string> = {
  confirmed: "bg-ca-navy/[0.06] text-[var(--ca-navy)]",
  preparing: "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200/70",
  printing: "bg-violet-50 text-violet-900 ring-1 ring-inset ring-violet-200/70",
  packed: "bg-slate-100 text-slate-800 ring-1 ring-inset ring-slate-300/60",
  pickup: "bg-[rgba(212,175,55,0.15)] text-[var(--ca-gold-dark)] ring-1 ring-inset ring-[rgba(212,175,55,0.4)]",
  shipped: "bg-sky-50 text-sky-900 ring-1 ring-inset ring-sky-200/70",
  transit: "bg-sky-50 text-sky-900 ring-1 ring-inset ring-sky-200/70",
  delivery: "bg-blue-100 text-blue-950 ring-1 ring-inset ring-blue-300/70",
  delivered: "bg-emerald-50 text-emerald-900 ring-1 ring-inset ring-emerald-200/70",
};

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-ca-navy/5 text-[var(--ca-navy)]",
  navy: "bg-[var(--ca-navy)] text-white",
  gold: "bg-[rgba(212,175,55,0.3)] text-[var(--ca-gold-dark)]",
  amber: "bg-amber-100 text-amber-950",
  green: "bg-emerald-50 text-emerald-900",
  red: "bg-red-50 text-red-900",
};

const RECORDED = "Time recorded by Notes tracking sync";

export interface OpsOrder {
  status: string;
  ops?: OrderOps | null;
}

export function StagePill({ order }: { order: OpsOrder }) {
  const stage = order.ops?.stage || null;
  const label = stage ? stage.label : fulfillmentLabel(order.status, false);
  const tone = stage ? STAGE_TONE[stage.key] || TONE.neutral : TONE[fulfillmentTone(order.status, false)];
  return <span className={`inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] ${tone}`}>{label}</span>;
}

function when(value: string | null | undefined): string | null {
  return formatAdminWhen(value || null);
}

function providerNote(provider: string | null): string | null {
  if (provider === "shiprocket") return "via Shiprocket";
  if (provider === "delhivery") return "Delhivery direct";
  return null;
}

/** The sentence beside the dots. Staff should never have to count dots. */
export function timelineText(order: OpsOrder): string {
  const ops = order.ops;
  const stage = ops?.stage;
  if (!ops || !stage) return fulfillmentLabel(order.status, false);
  switch (stage.key) {
    case "packed":
      return ops.courier_not_selected ? "Packed · Courier not selected" : "Packed";
    case "pickup": {
      const at = when(ops.pickup_at);
      return at ? `Pickup scheduled · ${at}` : "Pickup scheduled · date not confirmed";
    }
    case "shipped": {
      const at = when(ops.picked_up_at);
      return at ? `Picked up · ${at}` : "Picked up";
    }
    case "delivered": {
      const at = when(ops.delivered_at);
      return at ? `Delivered · ${at}` : "Delivered";
    }
    default:
      return stage.label;
  }
}

export function FulfillmentBlock({ order }: { order: OpsOrder }) {
  const ops = order.ops;
  const text = timelineText(order);
  const stageKey = ops?.stage?.key;
  const pickedUp = stageKey === "transit" || stageKey === "delivery" ? when(ops?.picked_up_at) : null;
  const latestAt = when(ops?.latest_at);
  const provider = providerNote(ops?.provider || null);
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StagePill order={order} />
        {ops?.courier && (
          <span className="min-w-0 text-[12.5px] font-medium text-ca-navy/85">
            {ops.courier}
            {ops.rate_paise ? <span className="tabular-nums"> · {formatPaise(ops.rate_paise)}</span> : null}
            {provider && <span className="ml-1 text-[11px] font-normal text-ca-navy/45">{provider}</span>}
          </span>
        )}
      </div>
      {ops?.stage ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <FulfillmentTimeline status={order.status} compact />
          <span
            key={text}
            className={`text-[12px] motion-safe:animate-fade-in ${ops.courier_not_selected ? "font-semibold text-[var(--ca-navy)]" : "text-ca-navy/75"}`}
            title={stageKey === "shipped" || stageKey === "delivered" ? RECORDED : undefined}
          >
            {text}
          </span>
        </div>
      ) : null}
      {(pickedUp || ops?.latest_text || latestAt) && (
        <p className="text-[11px] leading-snug text-ca-navy/50">
          {pickedUp && <span title={RECORDED}>Picked up {pickedUp}</span>}
          {pickedUp && (ops?.latest_text || latestAt) ? " · " : null}
          {ops?.latest_text ? `Latest: ${ops.latest_text}${latestAt ? ` · ${latestAt}` : ""}` : latestAt ? `Updated ${latestAt}` : null}
        </p>
      )}
      {ops?.issue && (
        <p className="text-[11px] font-semibold text-red-800">
          <span className="uppercase tracking-[0.08em]">Action required</span> · {ops.issue}
        </p>
      )}
    </div>
  );
}

export function PackageMeta({ ops }: { ops?: OrderOps | null }) {
  if (!ops) return null;
  const pkg = ops.package;
  if (!pkg) {
    return <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-800">Package required</span>;
  }
  return (
    <span className="block text-[11.5px] text-ca-navy/60" title={PACKAGE_SOURCE_LABEL[pkg.source]}>
      <span className="tabular-nums">{formatPackageWeight(pkg.weight_grams)} · {formatPackageDims(pkg)}</span>
      <span className="ml-1.5 text-[10.5px] text-ca-navy/40">{PACKAGE_SOURCE_LABEL[pkg.source]}</span>
    </span>
  );
}

export function destinationLabel(ops?: OrderOps | null): string | null {
  if (!ops?.city) return null;
  return ops.state ? `${ops.city}, ${ops.state}` : ops.city;
}
