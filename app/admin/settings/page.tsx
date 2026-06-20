"use client";

import { PageHeader } from "@/components/admin/ui";
import { ACADEMY, SUPPORT, isDemoMode, RAZORPAY_ENABLED, EMAIL_ENABLED } from "@/lib/config";

export default function SettingsAdmin() {
  const rows = [
    { label: "Academy name", value: ACADEMY.name },
    { label: "Tagline", value: ACADEMY.tagline },
    { label: "Address", value: ACADEMY.address },
    { label: "Support phone", value: SUPPORT.phone },
    { label: "Support email", value: SUPPORT.email },
    { label: "Instagram", value: ACADEMY.instagram },
    { label: "YouTube", value: ACADEMY.youtube },
    { label: "Telegram", value: ACADEMY.telegram },
  ];

  const status = [
    { label: "Mode", value: isDemoMode ? "Demo (mock data)" : "Live (Supabase)", ok: !isDemoMode },
    { label: "Razorpay payments", value: RAZORPAY_ENABLED ? "Connected" : "Not configured", ok: RAZORPAY_ENABLED },
    { label: "Email (Resend)", value: EMAIL_ENABLED ? "Connected" : "Not configured", ok: EMAIL_ENABLED },
  ];

  return (
    <div>
      <PageHeader title="Settings" subtitle="Brand, contact & integration status" />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-base">Brand & contact</h3>
          <dl className="space-y-2 text-sm">
            {rows.map((r) => (
              <div key={r.label} className="flex justify-between gap-3 border-b border-line pb-2 last:border-0">
                <dt className="text-muted">{r.label}</dt>
                <dd className="truncate text-right text-ink">{r.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">Edit these in <code>lib/config.ts</code> and environment variables.</p>
        </div>

        <div className="card p-5">
          <h3 className="mb-3 text-base">Integration status</h3>
          <div className="space-y-2">
            {status.map((s) => (
              <div key={s.label} className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm">
                <span className="text-ink2">{s.label}</span>
                <span className={`pill ${s.ok ? "pill-green" : "pill-amber"}`}>{s.value}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Add Supabase, Razorpay & Resend keys in Vercel to go live. See DEPLOY.md.</p>
        </div>
      </div>
    </div>
  );
}
