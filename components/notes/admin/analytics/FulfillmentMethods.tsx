import type { MethodRow, NotesIntel } from "@/lib/analytics/notesIntel";
import { formatPaise } from "@/lib/store/money";

function money(paise: number | null): string {
  return paise == null ? "—" : formatPaise(paise);
}

function duration(ms: number | null): string {
  if (ms == null) return "—";
  const hours = ms / 3_600_000;
  if (hours < 1) return "under 1 h";
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

function MethodCard({ title, row, accent }: { title: string; row: MethodRow; accent: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2.5">
      <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${accent}`}>{title}</p>
      <p className="mt-0.5 font-heading text-xl font-bold tabular-nums text-[var(--ca-navy)]">
        {row.orders} <span className="text-sm font-semibold text-ca-navy/55">orders</span>
      </p>
      <p className="text-[11.5px] tabular-nums text-ca-navy/60">
        {row.sharePct == null ? "—" : `${row.sharePct}%`} of paid · {row.units} units
      </p>
      <p className="text-[11.5px] tabular-nums text-ca-navy/60">
        {money(row.revenuePaise)} revenue · AOV {money(row.aovPaise)}
      </p>
    </div>
  );
}

/**
 * Fulfillment method mix for the paid cohort (sums reconcile to the KPI row) and
 * Academy Pickup operations. Descriptive only: no "overdue" without a policy.
 */
export default function FulfillmentMethods({ intel }: { intel: NotesIntel | null }) {
  if (!intel) return null;
  const { delivery, pickup } = intel.methods;
  const ops = intel.pickupOps;
  const label = "text-[10px] font-semibold uppercase tracking-[0.14em] text-ca-navy/45";
  const noPickup = pickup.orders === 0 && ops.readyNow === 0 && ops.collectedInRange === 0;
  return (
    <section className="mt-3 rounded-2xl bg-white/70 p-3 ring-1 ring-ca-navy/[0.05]" aria-label="Fulfillment method">
      <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Fulfillment method</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <MethodCard title="Delivery" row={delivery} accent="text-ca-navy/55" />
        </div>
        <div className="lg:col-span-3">
          <MethodCard title="Academy Pickup" row={pickup} accent="text-[var(--ca-gold-dark)]" />
        </div>
        <div className="rounded-xl bg-white px-3 py-2.5 sm:col-span-2 lg:col-span-6">
          <p className={label}>Academy Pickup operations</p>
          {noPickup ? (
            <p className="mt-2 text-sm text-ca-navy/60">No Academy Pickup orders in this period yet.</p>
          ) : (
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
              {([
                ["Ready now", String(ops.readyNow), "Waiting at the academy right now"],
                ["Waiting > 1 day", String(ops.waitingOver1d), "Ready for more than 24 hours"],
                ["Waiting > 3 days", String(ops.waitingOver3d), "Ready for more than 72 hours"],
                ["Oldest ready", duration(ops.oldestReadyMs), "Longest current wait"],
                ["Collected", String(ops.collectedInRange), "Collected in the selected range"],
                ["Ready / collected today", `${ops.readyToday} / ${ops.collectedToday}`, "IST business day"],
                ["Median paid → ready", duration(ops.medianPaidToReadyMs), ops.paidToReadySample ? `Based on ${ops.paidToReadySample} order${ops.paidToReadySample === 1 ? "" : "s"}` : "No orders became ready in range"],
                ["Median ready → collected", duration(ops.medianReadyToCollectedMs), ops.readyToCollectedSample ? `Based on ${ops.readyToCollectedSample} collected order${ops.readyToCollectedSample === 1 ? "" : "s"}` : "No orders collected in range"],
              ] as const).map(([name, value, hint]) => (
                <div key={name} className="min-w-0" title={hint}>
                  <dt className="truncate text-[11px] text-ca-navy/55">{name}</dt>
                  <dd className="font-heading text-lg font-bold tabular-nums text-[var(--ca-navy)]">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-2 text-[11px] text-ca-navy/45">Academy Pickup orders have no courier shipment. They are excluded from shipping rates, coverage and anomalies. Customer delivery charge: ₹0.</p>
        </div>
      </div>
    </section>
  );
}
