"use client";

import { useEffect, useState } from "react";
import { trackClient } from "@/lib/analytics/client";

export default function InterestButton({
  productId,
  source,
  className,
  compact = false,
}: {
  productId: string;
  source: "landing" | "subject" | "pdp";
  className?: string;
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "loading" | "recorded" | "error">("idle");
  const [count, setCount] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/notes/interest?product_id=${encodeURIComponent(productId)}`, { cache: "no-store", credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j.ok) return;
        if (j.recorded) setState("recorded");
        if (typeof j.count === "number" && j.count > 0) setCount(j.count);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [productId]);

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (state === "loading" || state === "recorded") return;
    setState("loading");
    setMsg(null);
    try {
      const res = await fetch("/api/notes/interest", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_id: productId, source }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Unable to record interest right now.");
      setState("recorded");
      if (typeof json.count === "number" && json.count > 0) setCount(json.count);
      trackClient("notes_interest_submitted", {
        product_id: productId,
        availability_state: json.availability_state,
        source,
        duplicate: !!json.duplicate,
      });
    } catch (err) {
      setState("error");
      setMsg((err as Error).message);
    }
  }

  if (state === "recorded") {
    return (
      <div className={className}>
        <p className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-emerald-800" role="status">
          <span aria-hidden="true">✓</span> Interest recorded
        </p>
        {count != null && count > 0 && (
          <p className="mt-1 text-xs text-[var(--ca-navy)]/55">{count} aspirant{count === 1 ? "" : "s"} interested</p>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        disabled={state === "loading"}
        className="ca-focus ns-press inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--ca-navy)] px-5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {state === "loading" ? "Recording…" : compact ? "I want these notes" : "I want these notes"}
      </button>
      {!compact && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--ca-navy)]/55">
          We use student demand to prioritize what we prepare next.
        </p>
      )}
      {msg && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {msg}
        </p>
      )}
    </div>
  );
}
