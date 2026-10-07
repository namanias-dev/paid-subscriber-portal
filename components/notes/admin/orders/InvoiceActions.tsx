"use client";

import { useState } from "react";
import { ReceiptText } from "lucide-react";

async function openAuthorizedInvoice(orderId: string, attachment: boolean): Promise<boolean> {
  const tab = window.open("", "_blank");
  try {
    const res = await fetch(
      `/api/admin/notes/orders/${orderId}/invoice?download=1&format=json${attachment ? "&attachment=1" : ""}`,
      { cache: "no-store" },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || typeof json.url !== "string" || !tab) {
      tab?.close();
      return false;
    }
    tab.opener = null;
    tab.location.href = json.url;
    return true;
  } catch {
    tab?.close();
    return false;
  }
}

function stopRow(event: React.MouseEvent) {
  event.stopPropagation();
  event.preventDefault();
}

const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ca-navy)]";

export function ViewInvoiceButton({ orderId, prominent = false, chip = false }: { orderId: string; prominent?: boolean; chip?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const look = chip
    ? "inline-flex items-center gap-1.5 border border-ca-navy/[0.12] bg-white text-[12.5px] text-[var(--ca-navy)] transition duration-150 hover:-translate-y-px hover:border-ca-navy/25 active:scale-[0.98] motion-reduce:transform-none"
    : prominent
      ? "bg-[var(--ca-navy)] text-xs text-white"
      : "border border-[var(--ca-navy)]/15 bg-white text-xs text-[var(--ca-navy)]";
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        aria-label="View Invoice"
        disabled={busy}
        onClick={(event) => {
          stopRow(event);
          if (busy) return;
          setBusy(true);
          setError(false);
          void openAuthorizedInvoice(orderId, false)
            .then((ok) => setError(!ok))
            .finally(() => setBusy(false));
        }}
        className={`min-h-11 rounded-full px-3 font-semibold disabled:opacity-60 ${focus} ${look}`}
      >
        {chip && <ReceiptText size={14} strokeWidth={2} aria-hidden="true" />}
        {busy ? "Opening…" : chip ? "Invoice" : "View Invoice"}
      </button>
      {error && <span className="mt-1 text-[11px] text-amber-900">Unable to open invoice. Try again.</span>}
    </span>
  );
}

export function DownloadInvoiceButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        aria-label="Download PDF"
        disabled={busy}
        onClick={(event) => {
          stopRow(event);
          if (busy) return;
          setBusy(true);
          setError(false);
          void openAuthorizedInvoice(orderId, true)
            .then((ok) => setError(!ok))
            .finally(() => setBusy(false));
        }}
        className={`min-h-11 rounded-full border border-[var(--ca-navy)]/15 bg-white px-3 text-xs font-semibold text-[var(--ca-navy)] disabled:opacity-60 ${focus}`}
      >
        {busy ? "Downloading…" : "Download PDF"}
      </button>
      {error && <span className="mt-1 text-[11px] text-amber-900">Unable to open invoice. Try again.</span>}
    </span>
  );
}
