"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import type { RateAnomaly, ShippingIntel as ShippingIntelData } from "@/lib/analytics/notesIntel";
import { formatPaise } from "@/lib/store/money";
import { formatPackageWeight } from "@/lib/store/orderOpsDisplay";

const BOOKED_NOTE = "Based on the rate saved when the courier was booked. Final provider billing may differ. Customer shipping charged at checkout is not used.";

function money(value: number | null): string {
  return value == null ? "—" : formatPaise(value);
}

function range(min: number | null, max: number | null): string {
  if (min == null || max == null) return "—";
  return min === max ? formatPaise(min) : `${formatPaise(min)}–${formatPaise(max)}`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-ca-navy/[0.03] px-3 py-2" title={hint}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-ca-navy/45">{label}</p>
      <p className="mt-0.5 font-heading text-lg font-bold tabular-nums text-[var(--ca-navy)]">{value}</p>
    </div>
  );
}

function Bars({ rows, max, tone = "navy" }: { rows: Array<{ key: string; label: string; sub?: string; value: number; text: string }>; max: number; tone?: "navy" | "gold" }) {
  const reduce = useReducedMotion();
  return (
    <ol className="space-y-2">
      {rows.map((row) => (
        <li key={row.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <p className="min-w-0 truncate text-[var(--ca-navy)]">
              <span className="font-semibold">{row.label}</span>
              {row.sub ? <span className="ml-2 text-ca-navy/45">{row.sub}</span> : null}
            </p>
            <p className="shrink-0 tabular-nums text-[var(--ca-navy)]">{row.text}</p>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-ca-navy/[0.06]">
            <motion.div
              className={`h-1.5 rounded-full ${tone === "gold" ? "bg-[var(--ca-gold-dark)]" : "bg-[var(--ca-navy)]"}`}
              initial={reduce ? false : { width: 0 }}
              animate={{ width: row.value > 0 ? `${Math.max(2, Math.round((row.value / Math.max(1, max)) * 100))}%` : "0%" }}
              transition={reduce ? { duration: 0 } : { duration: 0.35, ease: "easeOut" }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function AnomalyRow({ row }: { row: RateAnomaly }) {
  const typical = `${row.comparison === "state" ? `Typical ${row.weightBand} ${row.state}` : `Typical ${row.weightBand} nationally`}: ${formatPaise(row.peerLowPaise)}–${formatPaise(row.peerHighPaise)} (${row.peerCount} shipments)`;
  return (
    <tr className="border-t border-ca-navy/5 align-top">
      <td className="py-2 pr-3">
        <Link href={`/admin/notes/orders/${row.orderId}`} className="ca-focus font-semibold text-[var(--ca-navy)] underline-offset-2 hover:underline">
          {row.orderLabel}
        </Link>
        <p className="text-xs text-ca-navy/50 md:hidden">{row.city}, {row.state}</p>
      </td>
      <td className="hidden py-2 pr-3 text-ca-navy/75 md:table-cell">{row.city}<span className="block text-xs text-ca-navy/45">{row.state}</span></td>
      <td className="hidden whitespace-nowrap py-2 pr-3 tabular-nums text-ca-navy/75 md:table-cell">{row.weightGrams ? formatPackageWeight(row.weightGrams) : "—"}</td>
      <td className="hidden whitespace-nowrap py-2 pr-3 text-ca-navy/75 lg:table-cell">{row.courier}<span className="block text-xs text-ca-navy/45">{row.provider}</span></td>
      <td className="whitespace-nowrap py-2 pr-3 tabular-nums" title={typical}>
        <span className="font-semibold text-[var(--ca-navy)]">{formatPaise(row.ratePaise)}</span>
        <span className="mt-0.5 block w-max rounded-full bg-[#fce9a8]/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ca-gold-dark)]">High rate</span>
      </td>
      <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-ca-navy/75">{formatPaise(row.peerMedianPaise)}</td>
      <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-[var(--ca-navy)]">+{formatPaise(row.differencePaise)}<span className="block text-xs text-ca-navy/50">+{row.differencePct}%</span></td>
      <td className="hidden py-2 pr-3 text-xs text-ca-navy/65 xl:table-cell">
        {row.reason}
        <span className="block text-ca-navy/45">{typical}{row.burdenPct != null ? ` · ${row.burdenPct}% of order value` : ""}</span>
      </td>
      <td className="py-2 text-right">
        <Link href={`/admin/notes/orders/${row.orderId}`} className="ca-focus whitespace-nowrap text-xs font-semibold text-ca-navy/70 hover:text-[var(--ca-navy)]">
          View order →
        </Link>
      </td>
    </tr>
  );
}

export default function ShippingIntel({ shipping, anomalies, rule }: { shipping: ShippingIntelData | null; anomalies: RateAnomaly[]; rule: string }) {
  const [allStates, setAllStates] = useState(false);
  const [showProviders, setShowProviders] = useState(false);

  if (!shipping) {
    return (
      <section className="mt-4 rounded-2xl bg-white p-4">
        <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Shipping intelligence</h2>
        <p className="mt-2 text-sm text-ca-navy/55">Shipping analytics are unavailable right now.</p>
      </section>
    );
  }
  const none = shipping.count === 0;
  const states = allStates ? shipping.byState : shipping.byState.slice(0, 8);
  const distMax = Math.max(1, ...shipping.distribution.map((bucket) => bucket.count));
  const cityRows = shipping.byCity.slice(0, 8);
  const cityMax = Math.max(1, ...cityRows.map((row) => row.avgPaise ?? 0));

  return (
    <section className="mt-4 rounded-2xl bg-white p-4" aria-labelledby="notes-shipping-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="notes-shipping-heading" className="font-heading text-lg font-bold text-[var(--ca-navy)]">Shipping intelligence</h2>
          <p className="mt-1 text-sm text-ca-navy/55" title={BOOKED_NOTE}>
            Booked courier rates for orders paid in range. Final provider billing may differ.
          </p>
        </div>
        <p className="text-xs tabular-nums text-ca-navy/55" title="Delivery orders paid in range with a booked shipment, and how many of those have a saved courier rate. Academy Pickup orders never ship and are not counted.">
          Booked rate coverage <span className="font-semibold text-[var(--ca-navy)]">{shipping.count} of {shipping.booked}</span> shipments · {shipping.paidOrders} delivery orders
        </p>
      </div>

      {none ? (
        <p className="mt-3 text-sm text-ca-navy/55">No shipping rates available.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-5 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Avg booked rate" value={money(shipping.avgPaise)} hint={BOOKED_NOTE} />
                <Stat label="Median" value={money(shipping.medianPaise)} hint="Half of booked shipments cost less than this. Less sensitive to outliers than the average." />
                <Stat label="Min" value={money(shipping.minPaise)} />
                <Stat label="Max" value={money(shipping.maxPaise)} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="At or under ₹100" value={shipping.atOrUnder100Pct == null ? "—" : `${shipping.atOrUnder100Pct}%`} hint={`${shipping.atOrUnder100} of ${shipping.count} shipments with a known booked rate`} />
                <Stat label="Over ₹100" value={`${shipping.over100} ${shipping.over100 === 1 ? "shipment" : "shipments"}`} hint="Surfaced for review. A rate over ₹100 is not automatically wrong." />
                <Stat label="Shipping burden" value={shipping.avgBurdenPct == null ? "—" : `${shipping.avgBurdenPct}%`} hint="Average booked courier rate as a share of the captured order amount." />
              </div>

              <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-ca-navy/45">Rate distribution</h3>
              <div className="mt-2">
                <Bars rows={shipping.distribution.map((bucket) => ({ key: bucket.id, label: bucket.label, value: bucket.count, text: `${bucket.count}` }))} max={distMax} />
              </div>

              <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-ca-navy/45">Shipping by state</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-sm sm:min-w-[34rem]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-ca-navy/45">
                      <th className="py-2 pr-3 font-semibold">State</th>
                      <th className="py-2 pr-3 font-semibold" title="Shipments with a saved booked rate / booked shipments">With rate</th>
                      <th className="py-2 pr-3 font-semibold">Avg</th>
                      <th className="hidden py-2 pr-3 font-semibold sm:table-cell">Median</th>
                      <th className="hidden py-2 pr-3 font-semibold sm:table-cell">Min–max</th>
                      <th className="hidden py-2 pr-3 font-semibold md:table-cell">Avg weight</th>
                      <th className="hidden py-2 pr-3 font-semibold md:table-cell">Top courier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {states.map((row) => (
                      <tr key={row.code} className="border-t border-ca-navy/5">
                        <td className="py-2 pr-3 text-[var(--ca-navy)]">{row.name}</td>
                        <td className="whitespace-nowrap py-2 pr-3 tabular-nums" title={`${row.count} of ${row.shipments} booked shipments have a saved rate`}>{row.count}<span className="text-ca-navy/40">/{row.shipments}</span></td>
                        <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{money(row.avgPaise)}</td>
                        <td className="hidden whitespace-nowrap py-2 pr-3 tabular-nums sm:table-cell">{money(row.medianPaise)}</td>
                        <td className="hidden whitespace-nowrap py-2 pr-3 tabular-nums sm:table-cell">{range(row.minPaise, row.maxPaise)}</td>
                        <td className="hidden whitespace-nowrap py-2 pr-3 tabular-nums md:table-cell">{row.avgWeightGrams ? formatPackageWeight(row.avgWeightGrams) : "—"}</td>
                        <td className="hidden whitespace-nowrap py-2 pr-3 text-ca-navy/70 md:table-cell">{row.topCourier || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {shipping.byState.length > 8 ? (
                <button type="button" onClick={() => setAllStates((value) => !value)} className="mt-2 min-h-9 text-sm font-semibold text-[var(--ca-navy)]">
                  {allStates ? "Show top states" : `View all ${shipping.byState.length} states`}
                </button>
              ) : null}

              <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-ca-navy/45">Most expensive cities · avg booked rate</h3>
              <div className="mt-2">
                {cityRows.length ? (
                  <Bars
                    tone="gold"
                    rows={cityRows.map((row) => ({
                      key: row.key,
                      label: row.city,
                      sub: `${row.state} · ${row.count} ${row.count === 1 ? "shipment" : "shipments"}${row.count > 1 && row.medianPaise != null ? ` · median ${formatPaise(row.medianPaise)} · ${range(row.minPaise, row.maxPaise)}` : ""}`,
                      value: row.avgPaise ?? 0,
                      text: money(row.avgPaise),
                    }))}
                    max={cityMax}
                  />
                ) : (
                  <p className="text-sm text-ca-navy/55">No shipping rates available.</p>
                )}
              </div>
            </div>

            <div className="min-w-0 lg:col-span-5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ca-navy/45">Courier performance</h3>
                <button type="button" onClick={() => setShowProviders((value) => !value)} className="min-h-9 text-xs font-semibold text-ca-navy/70">
                  {showProviders ? "By courier service" : "By provider"}
                </button>
              </div>
              {showProviders ? (
                <ol className="mt-2 space-y-2">
                  {shipping.byProvider.map((row) => (
                    <li key={row.provider} className="rounded-xl border border-ca-navy/[0.07] px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-[var(--ca-navy)]">{row.provider}</p>
                        <p className="tabular-nums text-sm text-[var(--ca-navy)]">{money(row.avgPaise)}</p>
                      </div>
                      <p className="text-xs tabular-nums text-ca-navy/55">
                        {row.shipments} booked · {row.count} with rate{row.medianPaise != null ? ` · median ${formatPaise(row.medianPaise)}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <ol className="mt-2 space-y-2">
                  {shipping.byCourier.map((row) => (
                    <li key={row.key} className="rounded-xl border border-ca-navy/[0.07] px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="min-w-0 truncate font-semibold text-[var(--ca-navy)]">
                          {row.courier}
                          <span className="ml-2 text-xs font-normal text-ca-navy/45">{row.provider}</span>
                        </p>
                        <p className="shrink-0 tabular-nums text-sm text-[var(--ca-navy)]" title={BOOKED_NOTE}>{money(row.avgPaise)}</p>
                      </div>
                      <p className="mt-0.5 text-xs tabular-nums text-ca-navy/55">
                        {row.shipments} booked{row.sharePct != null ? ` (${row.sharePct}%)` : ""}
                        {row.medianPaise != null ? ` · median ${formatPaise(row.medianPaise)}` : ""}
                        {row.count > 1 ? ` · ${range(row.minPaise, row.maxPaise)}` : ""}
                      </p>
                      <p className="text-xs tabular-nums text-ca-navy/55">
                        Picked up {row.pickedUp}/{row.shipments} · Delivered {row.delivered}
                        {row.count < row.shipments ? ` · ${row.shipments - row.count} without saved rate` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </>
      )}

      <div className="mt-6 border-t border-ca-navy/5 pt-4">
        <h3 className="font-heading text-base font-bold text-[var(--ca-navy)]">Rate anomalies</h3>
        <p className="mt-1 text-xs text-ca-navy/55">{rule} Decision support only. Nothing is changed automatically.</p>
        {anomalies.length === 0 ? (
          <p className="mt-2 text-sm text-ca-navy/55">{none ? "No shipping rates available." : "No unusually high booked rates in this period."}</p>
        ) : (
          <div className="relative mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-ca-navy/45">
                  <th className="py-2 pr-3 font-semibold">Order</th>
                  <th className="hidden py-2 pr-3 font-semibold md:table-cell">City / State</th>
                  <th className="hidden py-2 pr-3 font-semibold md:table-cell">Package</th>
                  <th className="hidden py-2 pr-3 font-semibold lg:table-cell">Courier</th>
                  <th className="py-2 pr-3 font-semibold">Booked rate</th>
                  <th className="py-2 pr-3 font-semibold">Peer median</th>
                  <th className="py-2 pr-3 font-semibold">Difference</th>
                  <th className="hidden py-2 pr-3 font-semibold xl:table-cell">Reason</th>
                  <th className="py-2"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((row) => <AnomalyRow key={row.orderId} row={row} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
