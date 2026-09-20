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
  const [tone, setTone] = useState<"ok" | "err" | null>(null);

  async function onClick() {
    if (busy || disabled) return;
    setBusy(true);
    setMsg(null);
    setTone(null);
    try {
      const res = await fetch("/api/notes/cart", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_id: productId, qty: 1 }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Unable to add Notes right now.");
      trackClient("notes_added_to_cart", { product_id: productId, buy_now: buyNow });
      window.dispatchEvent(new CustomEvent("notes-cart-updated", { detail: { count: json.cart?.item_count } }));
      if (buyNow) {
        router.push("/notes/checkout");
        return;
      }
      setTone("ok");
      setMsg("Added to cart");
      setTimeout(() => {
        setMsg(null);
        setTone(null);
      }, 1600);
    } catch (e) {
      setTone("err");
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy || disabled}
        aria-disabled={busy || disabled}
        className={
          buyNow
            ? "ca-focus ns-press inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--ca-navy)] px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            : "ca-focus ns-press inline-flex min-h-12 w-full items-center justify-center rounded-full border border-[var(--ca-navy)]/20 bg-white px-5 text-sm font-semibold text-[var(--ca-navy)] transition hover:border-[var(--ca-gold)] disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        {busy ? "Adding…" : msg && tone === "ok" && !buyNow ? msg : label}
      </button>
      <span className="sr-only" aria-live="polite">
        {msg || ""}
      </span>
      {tone === "err" && msg && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {msg}
        </p>
      )}
    </div>
  );
}
