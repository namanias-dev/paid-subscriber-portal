"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** Cart count hydrates after mount so ISR pages never embed it. */
export default function CartBadge() {
  const [count, setCount] = useState<number | null>(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/notes/cart", { cache: "no-store", credentials: "same-origin" })
        .then((r) => r.json())
        .then((j) => {
          if (!cancelled) setCount(Number(j?.cart?.item_count || 0));
        })
        .catch(() => {
          if (!cancelled) setCount(0);
        });
    void load();
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ count?: number }>).detail;
      if (typeof detail?.count === "number") setCount(detail.count);
      else void load();
      setPulse(true);
      window.setTimeout(() => setPulse(false), 500);
    };
    window.addEventListener("notes-cart-updated", onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener("notes-cart-updated", onUpdate);
    };
  }, []);

  return (
    <Link
      href="/notes/cart"
      className={`inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--ca-navy)]/15 bg-white px-3 text-[13px] font-semibold text-[var(--ca-navy)] ${pulse ? "ns-gold-rim" : ""}`}
    >
      Cart
      <span className="tabular-nums text-[var(--ca-gold-dark,#9a7b2f)]" aria-live="polite">
        {count == null ? "·" : count}
      </span>
    </Link>
  );
}
