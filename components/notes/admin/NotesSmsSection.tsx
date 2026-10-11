"use client";

import { useCallback, useEffect, useState } from "react";
import NotesSmsPlanView, { type NotesPlanView } from "@/components/admin/sms/NotesSmsPlanView";

type Target = { orderId: string } | { checkoutLeadId: string };

export const ORDER_SMS_TEMPLATES = [
  { key: "NOTES_ORDER_CONFIRMED_01", label: "Order confirmed" },
  { key: "NOTES_PAYMENT_PENDING_01", label: "Payment pending" },
];

export const LEAD_SMS_TEMPLATES = [
  { key: "NOTES_CHECKOUT_INCOMPLETE_01", label: "Checkout incomplete" },
  { key: "NOTES_NEW_LEAD_PROMO_01", label: "Notes promotion" },
  { key: "NOTES_DISCOUNT_NOTES500_01", label: "NOTES500 offer" },
];

/**
 * Approved Notes SMS for one order or checkout lead. The server picks the
 * phone, subject, amount and link from that record; staff only choose which
 * approved template. Hidden for staff without SMS permission.
 */
export default function NotesSmsSection({ target, templates }: { target: Target; templates: { key: string; label: string }[] }) {
  const [plans, setPlans] = useState<Partial<Record<string, NotesPlanView>>>({});
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const targetKey = JSON.stringify(target);

  const call = useCallback(async (templateKey: string, action: "preview" | "send") => {
    const res = await fetch("/api/admin/sms/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, templateKey, ...JSON.parse(targetKey) }),
    });
    if (res.status === 401 || (action === "preview" && res.status === 403)) return { denied: true as const };
    return { denied: false as const, body: await res.json() };
  }, [targetKey]);

  const load = useCallback(async () => {
    const next: Partial<Record<string, NotesPlanView>> = {};
    for (const t of templates) {
      const r = await call(t.key, "preview");
      if (r.denied) {
        setHidden(true);
        return;
      }
      if (r.body?.plan) next[t.key] = r.body.plan;
    }
    setPlans(next);
  }, [call, templates]);

  useEffect(() => {
    setPlans({});
    setMessage(null);
    void load();
  }, [load]);

  if (hidden) return null;

  async function send(key: string, label: string, plan: NotesPlanView) {
    if (!window.confirm(`Send "${label}" SMS to ${plan.destination}? This sends a real SMS.`)) return;
    setBusy(key);
    setMessage(null);
    try {
      const r = await call(key, "send");
      if (r.denied) setMessage("You do not have permission to send customer SMS.");
      else if (r.body.ok) setMessage("Accepted by the SMS provider. Delivery is confirmed later by the delivery report.");
      else setMessage(r.body.reasonText || r.body.error || "Not sent.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Customer SMS</p>
      <p className="mt-1 text-xs text-[var(--ca-navy)]/55">Approved DLT templates, sent only to this record&apos;s phone with this record&apos;s details.</p>
      <div className="mt-3 space-y-3">
        {templates.map((t) => {
          const plan = plans[t.key];
          return (
            <div key={t.key}>
              <p className="mb-1 text-sm font-semibold text-[var(--ca-navy)]">{t.label}</p>
              {plan
                ? <NotesSmsPlanView plan={plan} busy={busy === t.key} onSend={() => void send(t.key, t.label, plan)} />
                : <p className="text-xs text-[var(--ca-navy)]/50">Checking…</p>}
            </div>
          );
        })}
      </div>
      {message && <p className="mt-3 text-xs text-[var(--ca-navy)]/70" role="status">{message}</p>}
    </section>
  );
}
