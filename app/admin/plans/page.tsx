"use client";

import { PageHeader } from "@/components/admin/ui";
import { PLANS } from "@/lib/config";
import { clientRazorpayLink } from "@/lib/publicLinks";
import { formatINR } from "@/lib/dates";

export default function PlansAdmin() {
  return (
    <div>
      <PageHeader title="Subscription Plans" subtitle="Pricing & features for the daily-content membership" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLANS.map((p) => {
          const link = clientRazorpayLink(p.id);
          return (
            <div key={p.id} className="card p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg">{p.name}</h3>
                {p.badge && <span className="pill pill-blue">{p.badge}</span>}
              </div>
              <p className="mt-1 text-sm text-muted">{p.durationLabel}</p>
              <p className="mt-3 font-heading text-2xl text-primary">{formatINR(p.price)}</p>
              <ul className="mt-3 space-y-1 text-sm text-ink2">
                {p.bullets.map((b) => <li key={b}>✓ {b}</li>)}
              </ul>
              <div className="mt-4">
                <span className={`pill ${link ? "pill-green" : "pill-amber"}`}>{link ? "Razorpay linked" : "Link via env var"}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-sm text-muted">Configure each plan&apos;s Razorpay link via its <code>NEXT_PUBLIC_RAZORPAY_LINK_*</code> environment variable. In demo mode payments are simulated.</p>
    </div>
  );
}
