"use client";

import { useState } from "react";
import { formatPaise } from "@/lib/store/money";

export default function PinChecker({ dispatchDays = 2 }: { dispatchDays?: number }) {
  const [pin, setPin] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(`/api/notes/pin?pin=${encodeURIComponent(pin)}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Could not check this PIN");
      if (!json.serviceable) {
        setErr("We don't currently deliver to this PIN.");
        return;
      }
      const ship = json.shipping_paise ? ` Shipping ${formatPaise(json.shipping_paise)}.` : "";
      const where = [json.city, json.state].filter(Boolean).join(", ");
      setResult(`Delivered by ${json.promised_label}${where ? ` to ${where}` : ""}.${ship}`);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={check} className="rounded-2xl border border-[var(--ca-navy)]/10 bg-white p-4">
      <p className="text-sm font-semibold text-[var(--ca-navy)]">Check delivery date</p>
      <p className="mt-1 text-xs text-[var(--ca-navy)]/55">We'll give you a date, not a range. Dispatch in {dispatchDays} day{dispatchDays === 1 ? "" : "s"} from Chandigarh.</p>
      <div className="mt-3 flex gap-2">
        <input
          inputMode="numeric"
          pattern="[1-9][0-9]{5}"
          maxLength={6}
          autoComplete="postal-code"
          placeholder="6-digit PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="min-h-11 flex-1 rounded-xl border border-[var(--ca-navy)]/15 px-3 text-sm tabular-nums"
        />
        <button type="submit" disabled={busy || pin.length !== 6} className="min-h-11 rounded-xl bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "…" : "Check"}
        </button>
      </div>
      {result && <p className="mt-3 text-sm text-[var(--ca-navy)]">{result}</p>}
      {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
    </form>
  );
}
