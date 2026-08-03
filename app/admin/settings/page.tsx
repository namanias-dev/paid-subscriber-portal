"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/ui";
import { Section, Field, FormActions } from "@/components/admin/FormKit";
import { useToast } from "@/components/ui/Toast";
import { DEFAULT_BRAND } from "@/lib/homeDefaults";
import { isDemoMode, RAZORPAY_ENABLED, EMAIL_ENABLED } from "@/lib/config";
import type { BrandConfig } from "@/lib/types";

const ALERT_LABELS: { key: string; label: string }[] = [
  { key: "seat_booked", label: "Seat booked (full detail)" },
  { key: "full_payment", label: "Payment received / full payment" },
  { key: "installment_overdue", label: "Overdue (daily 10 AM + 7d/30d)" },
  { key: "webinar_registration", label: "Webinar registration — listing or detail (on PAID only)" },
  { key: "webinar_milestone", label: "Webinar paid milestone (every 25)" },
  { key: "webinar_reminder_24h", label: "Webinar 24h reminder" },
  { key: "no_leads_6h", label: "No leads for 6h (business hours)" },
  { key: "no_logins_3h", label: "No logins for 3h (business hours)" },
  { key: "gateway_failure", label: "Payment failed (immediate)" },
];

type ReportSettingsState = {
  channel_id: string;
  digest_enabled: boolean;
  digest_frequency: "2h" | "3h" | "6h" | "daily";
  quiet_hours_start: string;
  quiet_hours_end: string;
  alerts: Record<string, boolean>;
  last_digest_at: string | null;
  last_digest_error: string | null;
  last_alert_at: string | null;
};

export default function SettingsAdmin() {
  const { toast } = useToast();
  const [brand, setBrand] = useState<BrandConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [isSuper, setIsSuper] = useState(false);
  const [allowAdminCsv, setAllowAdminCsv] = useState(false);
  const [csvSaving, setCsvSaving] = useState(false);
  const [reports, setReports] = useState<ReportSettingsState | null>(null);
  const [reportsSaving, setReportsSaving] = useState(false);
  const [reportsBusy, setReportsBusy] = useState(false);
  const [envChannel, setEnvChannel] = useState(false);

  const loadReports = useCallback(() => {
    fetch("/api/admin/telegram/reports")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.ok) return;
        const s = d.settings || {};
        setEnvChannel(!!d.envChannelConfigured);
        setReports({
          channel_id: s.channel_id || "",
          digest_enabled: s.digest_enabled !== false,
          digest_frequency: s.digest_frequency || "2h",
          quiet_hours_start: s.quiet_hours_start != null ? String(s.quiet_hours_start) : "",
          quiet_hours_end: s.quiet_hours_end != null ? String(s.quiet_hours_end) : "",
          alerts: s.alerts || {},
          last_digest_at: s.last_digest_at || null,
          last_digest_error: s.last_digest_error || null,
          last_alert_at: s.last_alert_at || null,
        });
      })
      .catch(() => null);
  }, []);

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
    fetch("/api/admin/leads/export-permission")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setIsSuper(!!d.isSuperAdmin);
          setAllowAdminCsv(!!d.allowAdminCsvExport);
        }
      })
      .catch(() => null);
    loadReports();
  }, [loadReports]);

  const set = (patch: Partial<BrandConfig>) => setBrand((b) => ({ ...(b || {}), ...patch }));

  async function toggleCsvExport(next: boolean) {
    setCsvSaving(true);
    try {
      const res = await fetch("/api/admin/leads/export-permission", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowAdminCsvExport: next }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        setAllowAdminCsv(!!data.allowAdminCsvExport);
        toast(next ? "Admin CSV export enabled" : "Admin CSV export disabled", "success");
      } else toast(data.error || "Could not update", "error");
    } catch {
      toast("Could not update", "error");
    } finally {
      setCsvSaving(false);
    }
  }

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

  async function saveReports() {
    if (!reports) return;
    setReportsSaving(true);
    try {
      const res = await fetch("/api/admin/telegram/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: reports.channel_id.trim() || null,
          digest_enabled: reports.digest_enabled,
          digest_frequency: reports.digest_frequency,
          quiet_hours_start: reports.quiet_hours_start === "" ? null : Number(reports.quiet_hours_start),
          quiet_hours_end: reports.quiet_hours_end === "" ? null : Number(reports.quiet_hours_end),
          alerts: reports.alerts,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        toast("Reports settings saved", "success");
        loadReports();
      } else toast(data.error || "Failed to save reports", "error");
    } catch {
      toast("Failed to save reports", "error");
    } finally {
      setReportsSaving(false);
    }
  }

  async function sendDigest(action: "send_digest_now" | "send_test_report" | "test_post") {
    setReportsBusy(true);
    try {
      const res = await fetch("/api/admin/telegram/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        toast(
          action === "test_post"
            ? "Test post sent"
            : action === "send_test_report"
              ? "Test report sent"
              : "Digest sent",
          "success",
        );
        loadReports();
      } else toast(data.reason || data.error || "Send failed", "error");
    } catch {
      toast("Send failed", "error");
    } finally {
      setReportsBusy(false);
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

        <Section title="Reports" desc="Telegram channel digests (every 2h IST, silent) and real-time event alerts. Uses Overview metrics — same numbers as the dashboard.">
          {!reports ? (
            <p className="text-sm text-muted sm:col-span-2">Loading reports settings…</p>
          ) : (
            <>
              <Field label="Channel ID" full hint={envChannel ? "Env TELEGRAM_REPORTS_CHANNEL_ID is set; field overrides when filled." : "Or set TELEGRAM_REPORTS_CHANNEL_ID in Vercel."}>
                <input
                  className="input font-mono"
                  value={reports.channel_id}
                  onChange={(e) => setReports({ ...reports, channel_id: e.target.value })}
                  placeholder="-100…"
                />
              </Field>
              <Field label="Digest frequency">
                <select
                  className="input"
                  value={reports.digest_frequency}
                  onChange={(e) =>
                    setReports({
                      ...reports,
                      digest_frequency: e.target.value as "2h" | "3h" | "6h" | "daily",
                    })
                  }
                >
                  <option value="2h">Every 2 hours</option>
                  <option value="3h">Every 3 hours (skip 3am)</option>
                  <option value="6h">Every 6 hours</option>
                  <option value="daily">Daily only (6 AM)</option>
                </select>
              </Field>
              <Field label="Digests enabled">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={reports.digest_enabled}
                    onChange={(e) => setReports({ ...reports, digest_enabled: e.target.checked })}
                  />
                  Post scheduled digests
                </label>
              </Field>
              <Field label="Quiet hours start (IST)">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={23}
                  value={reports.quiet_hours_start}
                  onChange={(e) => setReports({ ...reports, quiet_hours_start: e.target.value })}
                  placeholder="e.g. 23"
                />
              </Field>
              <Field label="Quiet hours end (IST)">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={23}
                  value={reports.quiet_hours_end}
                  onChange={(e) => setReports({ ...reports, quiet_hours_end: e.target.value })}
                  placeholder="e.g. 6"
                />
              </Field>
              <div className="sm:col-span-2 space-y-2">
                <p className="text-sm font-medium text-ink">Event alerts</p>
                {ALERT_LABELS.map((a) => (
                  <label key={a.key} className="flex items-center gap-2 text-sm text-ink2">
                    <input
                      type="checkbox"
                      checked={reports.alerts[a.key] !== false}
                      onChange={(e) =>
                        setReports({
                          ...reports,
                          alerts: { ...reports.alerts, [a.key]: e.target.checked },
                        })
                      }
                    />
                    {a.label}
                  </label>
                ))}
              </div>
              <div className="sm:col-span-2 flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary" disabled={reportsSaving} onClick={() => void saveReports()}>
                  {reportsSaving ? "Saving…" : "Save reports"}
                </button>
                <button type="button" className="btn btn-secondary" disabled={reportsBusy} onClick={() => void sendDigest("test_post")}>
                  {reportsBusy ? "Sending…" : "Test post"}
                </button>
                <button type="button" className="btn btn-primary" disabled={reportsBusy} onClick={() => void sendDigest("send_digest_now")}>
                  {reportsBusy ? "Sending…" : "Send digest now"}
                </button>
              </div>
              <div className="sm:col-span-2 text-xs text-muted space-y-1">
                <p>Last digest: {reports.last_digest_at ? new Date(reports.last_digest_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</p>
                <p>Last alert: {reports.last_alert_at ? new Date(reports.last_alert_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</p>
                <p className={reports.last_digest_error ? "text-red-600" : ""}>
                  Last error: {reports.last_digest_error || "—"}
                </p>
              </div>
            </>
          )}
        </Section>

        {isSuper && (
          <Section title="Permissions" desc="Super Admin controls for Lead CRM data export. Staff never get CSV export.">
            <label className="flex items-start gap-3 rounded-xl border border-line p-3 sm:col-span-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={allowAdminCsv}
                disabled={csvSaving}
                onChange={(e) => void toggleCsvExport(e.target.checked)}
              />
              <span>
                <span className="font-medium text-ink">Allow CSV export for Admin role</span>
                <span className="mt-0.5 block text-xs text-muted">Default OFF. When ON, accounts with the Admin role see Export CSV on Lead CRM. Super Admin always can. Staff never can.</span>
              </span>
            </label>
          </Section>
        )}

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
