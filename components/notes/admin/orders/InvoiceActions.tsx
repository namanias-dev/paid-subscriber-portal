"use client";

import { useState } from "react";

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

export function ViewInvoiceButton({ orderId, prominent = false }: { orderId: string; prominent?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
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
        className={`min-h-11 rounded-full px-3 text-xs font-semibold disabled:opacity-60 ${focus} ${
          prominent
            ? "bg-[var(--ca-navy)] text-white"
            : "border border-[var(--ca-navy)]/15 bg-white text-[var(--ca-navy)]"
        }`}
      >
        {busy ? "Opening…" : "View Invoice"}
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
