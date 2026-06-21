"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/ui";
import { Section, Field, FormActions } from "@/components/admin/FormKit";
import { useToast } from "@/components/ui/Toast";
import { DEFAULT_BRAND } from "@/lib/homeDefaults";
import { isDemoMode, RAZORPAY_ENABLED, EMAIL_ENABLED } from "@/lib/config";
import type { BrandConfig } from "@/lib/types";

export default function SettingsAdmin() {
  const { toast } = useToast();
  const [brand, setBrand] = useState<BrandConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/home");
        const data = await res.json();
        setBrand(data.ok ? data.settings.brand : DEFAULT_BRAND);
      } catch {
        setBrand(DEFAULT_BRAND);
      }
    })();
  }, []);

  const set = (patch: Partial<BrandConfig>) => setBrand((b) => ({ ...(b || {}), ...patch }));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/home", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) toast("Settings saved", "success");
      else toast(data.error || "Failed to save", "error");
    } catch {
      toast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  const status = [
    { label: "Mode", value: isDemoMode ? "Demo (mock data)" : "Live (Supabase)", ok: !isDemoMode },
    { label: "Razorpay payments", value: RAZORPAY_ENABLED ? "Connected" : "Not configured", ok: RAZORPAY_ENABLED },
    { label: "Email (Resend)", value: EMAIL_ENABLED ? "Connected" : "Not configured", ok: EMAIL_ENABLED },
  ];

  if (!brand) {
    return (
      <div>
        <PageHeader title="Settings" subtitle="Brand, contact & integration status" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="pb-24">
      <PageHeader title="Settings" subtitle="Edit brand, contact details, WhatsApp & map — saved live." />

      <div className="space-y-4">
        <Section title="Brand" desc="Shown in the footer and across the site.">
          <Field label="Academy name (full)">
            <input className="input" value={brand.name || ""} onChange={(e) => set({ name: e.target.value })} placeholder={DEFAULT_BRAND.name} />
          </Field>
          <Field label="Short name">
            <input className="input" value={brand.short_name || ""} onChange={(e) => set({ short_name: e.target.value })} placeholder={DEFAULT_BRAND.short_name} />
          </Field>
          <Field label="Tagline" full>
            <input className="input" value={brand.tagline || ""} onChange={(e) => set({ tagline: e.target.value })} placeholder={DEFAULT_BRAND.tagline} />
          </Field>
        </Section>

        <Section title="Contact" desc="Phone, WhatsApp & email used in the footer, contact page and buttons.">
          <Field label="Support phone" hint="Shown as a click-to-call link.">
            <input className="input" value={brand.support_phone || ""} onChange={(e) => set({ support_phone: e.target.value })} placeholder={DEFAULT_BRAND.support_phone} />
          </Field>
          <Field label="WhatsApp number" hint="10-digit Indian number. Opens wa.me chat.">
            <input className="input" value={brand.whatsapp || ""} onChange={(e) => set({ whatsapp: e.target.value })} placeholder="9876543210" />
          </Field>
          <Field label="Support email" full>
            <input className="input" type="email" value={brand.support_email || ""} onChange={(e) => set({ support_email: e.target.value })} placeholder={DEFAULT_BRAND.support_email} />
          </Field>
        </Section>

        <Section title="Address & Google Maps" desc="The address and map shown on the contact page, home page and footer.">
          <Field label="Address" full>
            <input className="input" value={brand.address || ""} onChange={(e) => set({ address: e.target.value })} placeholder={DEFAULT_BRAND.address} />
          </Field>
          <Field label="Google Maps link (Get Directions)" full hint="Paste the 'Share' link from Google Maps. Used by the Get Directions button. Leave empty to auto-search the address.">
            <input className="input" value={brand.maps_url || ""} onChange={(e) => set({ maps_url: e.target.value })} placeholder="https://maps.app.goo.gl/..." />
          </Field>
          <Field label="Google Maps embed URL (map preview)" full hint="Optional. In Google Maps → Share → Embed a map → copy the src URL. Leave empty to derive from the address.">
            <input className="input" value={brand.maps_embed_url || ""} onChange={(e) => set({ maps_embed_url: e.target.value })} placeholder="https://www.google.com/maps/embed?pb=..." />
          </Field>
        </Section>

        <Section title="Social links">
          <Field label="Instagram"><input className="input" value={brand.instagram || ""} onChange={(e) => set({ instagram: e.target.value })} placeholder="https://instagram.com/..." /></Field>
          <Field label="YouTube"><input className="input" value={brand.youtube || ""} onChange={(e) => set({ youtube: e.target.value })} placeholder="https://youtube.com/..." /></Field>
          <Field label="Telegram"><input className="input" value={brand.telegram || ""} onChange={(e) => set({ telegram: e.target.value })} placeholder="https://t.me/..." /></Field>
        </Section>

        <Section title="Integration status" desc="Configure these via environment variables in Vercel.">
          <div className="space-y-2 sm:col-span-2">
            {status.map((s) => (
              <div key={s.label} className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm">
                <span className="text-ink2">{s.label}</span>
                <span className={`pill ${s.ok ? "pill-green" : "pill-amber"}`}>{s.value}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <FormActions saving={saving} onSave={save} cancelHref="/admin" saveLabel="Save Settings" />
    </div>
  );
}
