"use client";

import { useEffect, useState } from "react";
import { ImageUploadField } from "@/components/admin/FormFields";
import { formatRegisteredAddress } from "@/lib/store/invoice/address";

interface Settings {
  display_name?: string | null;
  legal_name?: string | null;
  trade_name?: string | null;
  address_line?: string | null;
  address_floor_display?: string | null;
  address_floor_raw?: string | null;
  address_sector?: string | null;
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
  logo_url?: string | null;
  show_bank_details?: boolean | null;
  constitution?: string | null;
  gst_registration_status?: string | null;
  registration_type?: string | null;
}

export default function InvoiceSettingsCard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [futureOnly, setFutureOnly] = useState<string | null>(null);
  const [form, setForm] = useState<Settings>({});

  useEffect(() => {
    void fetch("/api/admin/notes/invoice-settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!json.ok) return;
        setSettings(json.settings || {});
        setWarning(json.warning);
        setFutureOnly(json.futureOnly || null);
        setForm(json.settings || {});
      });
  }, []);

  if (!settings) return null;

  return (
    <section className="mb-6 rounded-3xl border border-[var(--ca-navy)]/10 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ca-navy)]/50">Invoice and tax</p>
      <p className="mt-1 text-sm text-[var(--ca-navy)]/70">
        GST registration: {settings.gst_registration_status === "GST_REGISTERED" ? `Registered — ${settings.registration_type === "REGULAR" ? "Regular" : settings.registration_type || "Regular"}` : "Not configured"}.
        Prefix {settings.invoice_prefix || "NIA"}. Prices are tax-inclusive.
      </p>
      {futureOnly && <p className="mt-2 text-sm text-[var(--ca-navy)]/70">{futureOnly}</p>}
      <div className="mt-3 space-y-0.5 text-sm leading-5 text-[var(--ca-navy)]">
        {form.legal_name && <p className="font-semibold">{form.legal_name}</p>}
        {form.trade_name && <p>{form.trade_name}</p>}
        {form.gstin && <p className="whitespace-nowrap">GSTIN: {form.gstin}</p>}
        {formatRegisteredAddress({
          floorDisplay: form.address_floor_display,
          building: form.address_line,
          sector: form.address_sector,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
        }).map((line) => (
          <p key={line}>{line.replace(/, India$/, "")}</p>
        ))}
        {form.state_code && <p>State code: {form.state_code}</p>}
        <p>Registration: {settings.registration_type === "REGULAR" ? "Regular" : settings.registration_type || "Not set"}</p>
      </div>
      {form.address_floor_raw && form.address_floor_raw !== form.address_floor_display && (
        <p className="mt-1 text-xs text-[var(--ca-navy)]/50">Certificate floor text kept internally as {form.address_floor_raw}. Invoices show {form.address_floor_display}.</p>
      )}
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
          ["trade_name", "Trade name"],
          ["address_floor_display", "Floor"],
          ["address_line", "Building"],
          ["address_sector", "Sector"],
          ["city", "City"],
          ["state", "State"],
          ["state_code", "State code"],
          ["pincode", "PIN"],
          ["gstin", "GSTIN"],
          ["pan", "PAN"],
          ["constitution", "Constitution"],
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
        <label className="block text-xs text-[var(--ca-navy)]/60">
          GST registration
          <select
            value={form.gst_registration_status || ""}
            onChange={(e) => setForm((cur) => ({ ...cur, gst_registration_status: e.target.value }))}
            className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm text-[var(--ca-navy)]"
          >
            <option value="">Not set</option>
            <option value="GST_REGISTERED">Registered</option>
            <option value="NOT_GST_REGISTERED">Not registered</option>
          </select>
        </label>
        <label className="block text-xs text-[var(--ca-navy)]/60">
          Registration type
          <select
            value={form.registration_type || ""}
            onChange={(e) => setForm((cur) => ({ ...cur, registration_type: e.target.value }))}
            className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm text-[var(--ca-navy)]"
          >
            <option value="">Not set</option>
            <option value="REGULAR">Regular</option>
            <option value="COMPOSITION">Composition</option>
          </select>
        </label>
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
        <div className="sm:col-span-2">
          <ImageUploadField
            label="Invoice Logo"
            folder="branding"
            previewFit="contain"
            value={form.logo_url}
            onChange={(url) => setForm((cur) => ({ ...cur, logo_url: url }))}
            hint="PNG or JPEG. Extra padding is trimmed and the mark is scaled for the PDF. If the file cannot be read, the invoice still prints the academy name."
          />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-[var(--ca-navy)] sm:col-span-2">
          <input type="checkbox" checked={Boolean(form.show_bank_details)} onChange={(e) => setForm((cur) => ({ ...cur, show_bank_details: e.target.checked }))} />
          Show bank details on invoice (off by default; no account details are stored here)
        </label>
        <button type="submit" className="min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white sm:col-span-2 sm:w-fit">Save legal details</button>
      </form>
    </section>
  );
}
