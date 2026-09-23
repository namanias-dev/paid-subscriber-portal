"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import StoreStatusControl from "@/components/notes/admin/StoreStatusControl";

interface Cards {
  orders_today: number;
  awaiting_preparation: number;
  ready_to_ship: number;
  in_transit: number;
  problems: number;
  copies_to_prepare: number;
  low_stock: number;
  out_of_stock: number;
}

interface PrepRow {
  product_id: string;
  name: string;
  subject: string | null;
  demand: number;
  ready_stock: number | null;
  additional_required: number;
}

interface LowRow {
  id: string;
  name: string;
  subject: string | null;
  sellable: number;
}

interface InterestRow {
  product_id: string;
  name: string;
  subject: string | null;
  total: number;
}

interface PreferenceRow {
  id: string;
  name: string;
  raw_count: number;
  available: boolean;
}

const ACTION_DEFS: Array<{ key: string; label: string; href: string }> = [
  { key: "awb_missing", label: "AWB missing", href: "/admin/notes?bucket=packed" },
  { key: "shipment_failed", label: "Shipment creation failed", href: "/admin/notes?bucket=packed" },
  { key: "pickup_overdue", label: "Pickup overdue", href: "/admin/notes?bucket=packed" },
  { key: "tracking_stale", label: "Tracking stale", href: "/admin/notes?bucket=shipped" },
  { key: "delivery_delayed", label: "Delivery delayed", href: "/admin/notes?bucket=shipped" },
  { key: "delivery_failed", label: "Delivery failed", href: "/admin/notes?bucket=problem" },
  { key: "ndr", label: "NDR", href: "/admin/notes?bucket=problem" },
  { key: "rto", label: "RTO", href: "/admin/notes?bucket=problem" },
  { key: "return_waiting", label: "Return awaiting action", href: "/admin/notes?bucket=problem" },
  { key: "refund_manual", label: "Refund awaiting manual gateway processing", href: "/admin/notes?bucket=problem" },
];

const CARD_DEFS: Array<{ key: keyof Cards; label: string; href?: string; tone?: "warn" | "danger" }> = [
  { key: "orders_today", label: "Orders today" },
  { key: "awaiting_preparation", label: "Awaiting preparation", href: "/admin/notes?bucket=preparing", tone: "warn" },
  { key: "copies_to_prepare", label: "Copies to prepare", href: "/admin/notes/preparation", tone: "warn" },
  { key: "ready_to_ship", label: "Ready to ship", href: "/admin/notes?bucket=packed", tone: "warn" },
  { key: "in_transit", label: "In transit", href: "/admin/notes?bucket=shipped" },
  { key: "problems", label: "Problems", href: "/admin/notes?bucket=problem", tone: "danger" },
  { key: "low_stock", label: "Low stock", href: "/admin/notes/products", tone: "warn" },
  { key: "out_of_stock", label: "Out of stock", href: "/admin/notes/products", tone: "danger" },
];

export default function NotesOverview() {
  const [cards, setCards] = useState<Cards | null>(null);
  const [prep, setPrep] = useState<PrepRow[]>([]);
  const [low, setLow] = useState<LowRow[]>([]);
  const [interest, setInterest] = useState<InterestRow[]>([]);
  const [preferences, setPreferences] = useState<PreferenceRow[]>([]);
  const [actions, setActions] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/notes/overview", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setCards(json.cards);
        setPrep(json.prepare_top || []);
        setLow(json.low_stock || []);
        setInterest(json.interest_top || []);
        setPreferences(json.preference_top || []);
        setActions(json.action_required || {});
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <PageHeader title="Notes Store" subtitle="What needs attention today. Tap a card to jump straight to the work." />

      <StoreStatusControl />

      {loading || !cards ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CARD_DEFS.map((c) => {
              const value = cards[c.key];
              const active = value > 0;
              const toneCls =
                c.tone === "danger" && active
                  ? "text-red-700"
                  : c.tone === "warn" && active
                    ? "text-amber-700"
                    : "text-ink";
              const inner = (
                <div className="rounded-xl border border-line bg-white p-3.5 shadow-sm">
                  <p className="text-xs text-muted">{c.label}</p>
                  <p className={`font-heading text-2xl font-bold tabular-nums ${toneCls}`}>{value}</p>
                </div>
              );
              return c.href ? (
                <Link key={c.key} href={c.href} className="block transition hover:-translate-y-0.5">
                  {inner}
                </Link>
              ) : (
                <div key={c.key}>{inner}</div>
              );
            })}
          </div>

          <section className="mt-6 rounded-xl border border-line bg-white p-4">
            <h3 className="font-heading text-base font-bold text-ink">Action required</h3>
            {ACTION_DEFS.every((item) => !(actions[item.key] > 0)) ? (
              <p className="mt-3 text-sm text-muted">Nothing is waiting on a courier, return, or refund.</p>
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {ACTION_DEFS.filter((item) => actions[item.key] > 0).map((item) => (
                  <li key={item.key}>
                    <Link href={item.href} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 text-sm">
                      <span>{item.label}</span>
                      <span className="font-semibold tabular-nums text-amber-700">{actions[item.key]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-line bg-white p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-heading text-base font-bold text-ink">Prepare next</h3>
                <Link href="/admin/notes/preparation" className="text-xs font-semibold text-[var(--primary)]">
                  Full queue →
                </Link>
              </div>
              {prep.length === 0 ? (
                <p className="mt-3 text-sm text-muted">Nothing awaiting preparation.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {prep.map((r) => (
                    <li key={r.product_id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">
                        {r.name}
                        {r.subject ? <span className="text-muted"> · {r.subject}</span> : null}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-amber-700">
                        prepare {r.additional_required}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-line bg-white p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-heading text-base font-bold text-ink">Low stock</h3>
                <Link href="/admin/notes/products" className="text-xs font-semibold text-[var(--primary)]">
                  Catalogue →
                </Link>
              </div>
              {low.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No ready-stock titles are low.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {low.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">
                        {r.name}
                        {r.subject ? <span className="text-muted"> · {r.subject}</span> : null}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-amber-700">{r.sellable} left</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="mt-4 rounded-xl border border-line bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-base font-bold text-ink">Most requested upcoming notes</h3>
              <Link href="/admin/notes/interest" className="text-xs font-semibold text-[var(--primary)]">
                Notes demand →
              </Link>
            </div>
            <p className="mt-1 text-xs text-muted">Potential demand only. Paid preparation sits in the queue above.</p>
            {preferences.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {preferences.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      {r.name}
                      <span className="text-muted"> · {r.available ? "available" : "not yet"}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{r.raw_count}</span>
                  </li>
                ))}
              </ul>
            )}
            {interest.length === 0 && preferences.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No student preference or upcoming interest yet.</p>
            ) : interest.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {interest.map((r) => (
                  <li key={r.product_id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      {r.subject || r.name}
                      {r.subject ? <span className="text-muted"> · {r.name}</span> : null}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{r.total} interested</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
