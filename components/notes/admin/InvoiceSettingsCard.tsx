"use client";

import { useEffect, useState } from "react";

interface Settings {
  legal_name?: string | null;
  gstin?: string | null;
  address_line?: string | null;
  invoice_prefix?: string | null;
  document_mode?: string | null;
}

export default function InvoiceSettingsCard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [legal, setLegal] = useState("");
  const [gstin, setGstin] = useState("");

  useEffect(() => {
    void fetch("/api/admin/notes/invoice-settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!json.ok) return;
        setSettings(json.settings || {});
        setWarning(json.warning);
        setLegal(json.settings?.legal_name || "");
        setGstin(json.settings?.gstin || "");
      });
  }, []);

  if (!settings) return null;

  return (
    <section className="mb-6 rounded-3xl border border-[var(--ca-navy)]/10 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ca-navy)]/50">Invoice and tax</p>
      <p className="mt-1 text-sm text-[var(--ca-navy)]/70">
        Prefix {settings.invoice_prefix || "NIA"}. Prices are tax-inclusive. Issued invoices are not edited.
      </p>
      {warning && <p className="mt-2 text-sm text-amber-800">{warning}</p>}
      <form
        className="mt-3 grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void fetch("/api/admin/notes/invoice-settings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ legal_name: legal, gstin }),
          });
        }}
      >
        <input value={legal} onChange={(e) => setLegal(e.target.value)} placeholder="Legal supplier name" className="min-h-11 rounded-xl border px-3 text-sm" />
        <input value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="GSTIN, when the CA confirms it" className="min-h-11 rounded-xl border px-3 text-sm" />
        <button type="submit" className="min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white sm:col-span-2 sm:w-fit">Save legal details</button>
      </form>
    </section>
  );
}
