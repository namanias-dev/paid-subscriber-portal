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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/notes/overview", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setCards(json.cards);
        setPrep(json.prepare_top || []);
        setLow(json.low_stock || []);
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
                <div className="rounded-xl border border-line bg-white p-3">
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
        </>
      )}
    </div>
  );
}
