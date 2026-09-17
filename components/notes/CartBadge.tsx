"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** Cart count hydrates after mount so ISR pages never embed it. */
export default function CartBadge() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/notes/cart", { cache: "no-store", credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setCount(Number(j?.cart?.item_count || 0));
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <Link
      href="/notes/cart"
      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--ca-navy)]/15 bg-white px-3 text-[13px] font-semibold text-[var(--ca-navy)]"
    >
      Cart
      <span className="tabular-nums text-[var(--ca-gold-dark,#9a7b2f)]">{count == null ? "·" : count}</span>
    </Link>
  );
}
