"use client";

import { useState } from "react";
import { trackClient } from "@/lib/analytics/client";

export default function DiscountCodeField({
  enabled,
  appliedCode,
  appliedLabel,
  notice,
  onChanged,
}: {
  enabled: boolean;
  appliedCode: string | null;
  appliedLabel: string | null;
  notice: string | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return notice ? <p className="text-sm text-[var(--ca-navy)]/70">{notice}</p> : null;

  async function apply() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/notes/discount/validate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "apply", code: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.valid) {
        const message = json.message || "We couldn’t check this code right now. Please try again.";
        setError(message);
        const reason = ["invalid", "expired", "not_applicable", "limit", "customer_limit", "unavailable"].includes(json.reason)
          ? json.reason
          : "invalid";
        trackClient("notes_discount_rejected", { coupon_code: trimmed.toUpperCase(), error_reason: reason });
        return;
      }
      setCode("");
      setOpen(false);
      trackClient("notes_discount_applied", { coupon_code: json.code, discount_amount: json.discount_paise });
      onChanged();
    } catch {
      setError("We couldn’t check this code right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch("/api/notes/discount/validate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "remove" }),
      });
      trackClient("notes_discount_removed", { coupon_code: appliedCode });
      onChanged();
    } catch {
      setError("We couldn’t check this code right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (appliedCode && appliedLabel) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <p>
          <span className="font-medium text-[var(--ca-navy)]">{appliedCode}</span>
          <span className="text-[var(--ca-navy)]/65"> · {appliedLabel} off</span>
        </p>
        <button type="button" onClick={() => void remove()} disabled={busy} className="ca-focus min-h-11 shrink-0 text-sm font-semibold text-[var(--ca-navy)]/70">
          {busy ? "Removing…" : "Remove"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="ca-focus flex min-h-11 w-full items-center justify-between text-sm text-[var(--ca-navy)]/70"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) trackClient("notes_discount_opened", {});
        }}
      >
        <span>Have a discount code?</span>
        <span aria-hidden="true" className={`text-xs transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open && (
        <div className="mt-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="notes-discount-code">Discount code</label>
            <input
              id="notes-discount-code"
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(null); }}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Discount code"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "notes-discount-error" : undefined}
              className="min-h-11 w-full rounded-xl border border-[var(--ca-navy)]/15 px-3 uppercase"
            />
            <button type="button" onClick={() => void apply()} disabled={busy || !code.trim()} className="ca-focus min-h-11 shrink-0 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Checking…" : "Apply"}
            </button>
          </div>
          {error && <p id="notes-discount-error" role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
      {notice && <p className="mt-1 text-sm text-[var(--ca-navy)]/70" role="status">{notice}</p>}
    </div>
  );
}
