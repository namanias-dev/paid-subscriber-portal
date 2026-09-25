"use client";

import { useEffect, useState } from "react";

interface Settings {
  display_name?: string | null;
  legal_name?: string | null;
  address_line?: string | null;
  city?: string | null;
  state?: string | null;
  state_code?: string | null;
  pincode?: string | null;
  gstin?: string | null;
  pan?: string | null;
  support_phone?: string | null;
  support_email?: string | null;
  invoice_prefix?: string | null;
  document_mode?: string | null;
  legal_footer?: string | null;
}

export default function InvoiceSettingsCard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [form, setForm] = useState<Settings>({});

  useEffect(() => {
    void fetch("/api/admin/notes/invoice-settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!json.ok) return;
        setSettings(json.settings || {});
        setWarning(json.warning);
        setForm(json.settings || {});
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
            body: JSON.stringify(form),
          }).then(() => window.location.reload());
        }}
      >
        {([
          ["legal_name", "Legal supplier name"],
          ["address_line", "Registered address"],
          ["city", "City"],
          ["state", "State"],
          ["state_code", "State code"],
          ["pincode", "PIN"],
          ["gstin", "GSTIN"],
          ["pan", "PAN"],
          ["support_phone", "Support phone"],
          ["support_email", "Support email"],
          ["invoice_prefix", "Invoice prefix"],
          ["legal_footer", "Legal footer"],
        ] as const).map(([key, label]) => (
          <label key={key} className="block text-xs text-[var(--ca-navy)]/60">
            {label}
            <input
              value={form[key] || ""}
              onChange={(e) => setForm((cur) => ({ ...cur, [key]: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm text-[var(--ca-navy)]"
            />
          </label>
        ))}
        <label className="block text-xs text-[var(--ca-navy)]/60 sm:col-span-2">
          Document mode
          <select
            value={form.document_mode || "auto"}
            onChange={(e) => setForm((cur) => ({ ...cur, document_mode: e.target.value }))}
            className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm text-[var(--ca-navy)]"
          >
            <option value="auto">Automatic</option>
            <option value="TAX_INVOICE">Tax invoice</option>
            <option value="BILL_OF_SUPPLY">Bill of supply</option>
            <option value="INVOICE">Invoice</option>
          </select>
        </label>
        <button type="submit" className="min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white sm:col-span-2 sm:w-fit">Save legal details</button>
      </form>
    </section>
  );
}
