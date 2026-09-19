"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trackClient } from "@/lib/analytics/client";

export default function AddToCartButton({
  productId,
  label = "Add to cart",
  buyNow = false,
  disabled = false,
}: {
  productId: string;
  label?: string;
  buyNow?: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onClick() {
    if (busy || disabled) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/notes/cart", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_id: productId, qty: 1 }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not add to cart");
      trackClient("notes_added_to_cart", { product_id: productId, buy_now: buyNow });
      if (buyNow) {
        router.push("/notes/checkout");
        return;
      }
      setMsg("Added");
      setTimeout(() => setMsg(null), 1600);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      aria-disabled={busy || disabled}
      className={
        buyNow
          ? "ca-focus inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--ca-navy)] px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          : "ca-focus inline-flex min-h-12 w-full items-center justify-center rounded-full border border-[var(--ca-navy)]/20 bg-white px-5 text-sm font-semibold text-[var(--ca-navy)] transition hover:border-[var(--ca-gold)] disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {busy ? "Adding…" : msg && !buyNow ? msg : label}
    </button>
  );
}
