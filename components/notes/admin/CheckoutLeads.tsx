"use client";

import { useCallback, useEffect, useState } from "react";
import { formatPaise } from "@/lib/store/money";
import { businessChannel } from "@/lib/analytics/notesCommerce";
import type { AttributionTouch } from "@/lib/attribution";
import { leadPriority, maskPhone, type CheckoutStage, type SalesStatus } from "@/lib/store/checkoutLeadLogic";

interface LeadRow {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  cart_snapshot: Array<{ name?: string; qty?: number; sku?: string }>;
  cart_value_paise: number;
  checkout_stage: CheckoutStage;
  sales_status: SalesStatus;
  was_abandoned: boolean;
  attribution_json: { last_touch?: { source?: string; medium?: string; campaign?: string; content?: string } ; first_touch?: { source?: string; medium?: string; campaign?: string; content?: string } } | null;
  marketing_consent: boolean;
  address_snapshot: { line1?: string; city?: string; state?: string; pincode?: string } | null;
  fulfillment_method?: string | null;
  order_id: string | null;
  converted_value_paise: number | null;
  sales_note: string | null;
  is_test: boolean;
  last_activity_at: string;
  sales_alert?: { lines: string[] };
}

const FILTERS = [
  ["open", "Open"],
  ["abandoned", "Abandoned"],
  ["payment", "Payment started"],
  ["converted", "Converted"],
  ["all", "All"],
] as const;

const SALES: SalesStatus[] = ["NEW", "CONTACTED", "FOLLOW_UP", "NOT_INTERESTED", "DO_NOT_CONTACT"];

export default function CheckoutLeads() {
  const [filter, setFilter] = useState("open");
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [canUpdate, setCanUpdate] = useState(false);

  const load = useCallback(async (next = filter) => {
    const res = await fetch(`/api/admin/notes/leads?filter=${next}`, { cache: "no-store" });
    const json = await res.json();
    setLeads(json.leads || []);
    setCanUpdate(Boolean(json.can_update));
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lead");
    if (!id) return;
    setOpenId(id);
    setFilter("all");
    void load("all");
  }, [load]);

  const open = leads.find((row) => row.id === openId) || null;

  async function patch(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/notes/leads", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.url) {
      await navigator.clipboard.writeText(json.url);
      setMsg("Recovery link copied. It restores this browser's checkout and does not include the phone.");
    } else setMsg(json.ok ? "Saved" : "Could not update");
    await load();
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Notes Store</p>
        <h1 className="font-heading text-3xl font-bold text-[var(--ca-navy)]">Checkout leads</h1>
        <p className="mt-1 text-sm text-[var(--ca-navy)]/60">People who entered a mobile number at checkout and have not necessarily paid. Promotional messages stay off until a messaging provider and consent are both in place.</p>
      </header>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => { setFilter(key); void load(key); }} className={`min-h-10 rounded-full px-3 text-sm font-semibold ${filter === key ? "bg-[var(--ca-navy)] text-white" : "bg-white text-[var(--ca-navy)]"}`}>
            {label}
          </button>
        ))}
      </div>
      {msg && <p className="mb-3 rounded-xl bg-white px-3 py-2 text-sm text-[var(--ca-navy)]">{msg}</p>}
      <div className="space-y-2">
        {leads.length === 0 && <p className="rounded-2xl bg-white p-8 text-center text-sm text-[var(--ca-navy)]/60">No leads in this view.</p>}
        {leads.map((lead) => {
          const touch = (lead.attribution_json?.last_touch || lead.attribution_json?.first_touch) as AttributionTouch | undefined;
          const product = lead.cart_snapshot?.[0]?.name || "Notes";
          return (
            <button key={lead.id} type="button" onClick={() => setOpenId(lead.id)} className="block w-full rounded-2xl bg-white px-4 py-3 text-left">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-[var(--ca-navy)]">{lead.name || "Checkout"} · {maskPhone(lead.phone)}{lead.is_test ? " · QA" : ""}</span>
                <span className="text-sm text-[var(--ca-navy)]/60">{formatPaise(lead.cart_value_paise || 0)}</span>
              </span>
              <span className="mt-1 block text-sm text-[var(--ca-navy)]/70">{product} · {lead.checkout_stage.replaceAll("_", " ")} · {businessChannel(touch)} · {leadPriority(lead.checkout_stage)}</span>
            </button>
          );
        })}
      </div>
      {open && (
        <aside className="fixed inset-0 z-40 flex justify-end bg-[var(--ca-navy)]/30">
          <button type="button" aria-label="Close lead" className="hidden flex-1 sm:block" onClick={() => setOpenId(null)} />
          <div className="h-full w-full overflow-y-auto bg-[#f7f5ef] p-4 sm:max-w-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-heading text-2xl font-bold text-[var(--ca-navy)]">{open.name || "Checkout lead"}</h2>
                <p className="text-sm text-[var(--ca-navy)]/70">{open.phone}</p>
              </div>
              <button type="button" onClick={() => setOpenId(null)} className="min-h-11 text-sm text-[var(--ca-navy)]/60">Close</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="min-h-11 rounded-full bg-[var(--ca-navy)] px-4 py-2 text-sm font-semibold text-white" href={`tel:+91${open.phone}`}>Call</a>
              <button type="button" className="min-h-11 rounded-full bg-white px-4 text-sm font-semibold" onClick={() => void navigator.clipboard.writeText(open.phone).then(() => setMsg("Phone copied"))}>Copy phone</button>
              {canUpdate && <button type="button" className="min-h-11 rounded-full bg-white px-4 text-sm font-semibold" onClick={() => void patch({ id: open.id, recovery: true })}>Copy recovery link</button>}
            </div>
            {open.sales_status === "DO_NOT_CONTACT" && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">Do not contact. Promotional messages must not be sent.</p>}
            <dl className="mt-4 space-y-2 text-sm text-[var(--ca-navy)]">
              <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Stage</dt><dd>{open.checkout_stage}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Cart</dt><dd>{(open.cart_snapshot || []).map((line) => `${line.name} × ${line.qty}`).join(", ") || "—"}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Source</dt><dd>{businessChannel(open.attribution_json?.last_touch as AttributionTouch | undefined)} · {open.attribution_json?.last_touch?.campaign || "—"} · {open.attribution_json?.last_touch?.content || ""}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">First touch</dt><dd>{businessChannel(open.attribution_json?.first_touch as AttributionTouch | undefined)} · {open.attribution_json?.first_touch?.campaign || "—"}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Consent</dt><dd>{open.marketing_consent ? "Updates and offers allowed" : "No promotional consent"}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Email</dt><dd>{open.email || "—"}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Address</dt><dd>{open.fulfillment_method === "ACADEMY_PICKUP"
                ? `Academy Pickup${open.address_snapshot?.pincode ? ` · lives in ${[open.address_snapshot.city, open.address_snapshot.pincode].filter(Boolean).join(" ")}` : ""}`
                : open.address_snapshot?.line1 ? `${open.address_snapshot.line1}, ${open.address_snapshot.city} ${open.address_snapshot.pincode}` : "Not completed"}</dd></div>
              {open.order_id && <div><dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Order</dt><dd>{open.checkout_stage === "CONVERTED" ? "Converted" : "Payment started"} · {open.order_id.slice(0, 8)}</dd></div>}
              {!!open.sales_alert?.lines?.length && (
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Activity</dt>
                  {open.sales_alert.lines.map((line) => <dd key={line}>{line}</dd>)}
                </div>
              )}
            </dl>
            {canUpdate ? (
              <>
                <div className="mt-4 flex flex-wrap gap-2">
                  {SALES.map((status) => (
                    <button key={status} type="button" onClick={() => void patch({ id: open.id, sales_status: status })} className={`min-h-10 rounded-full px-3 text-xs font-semibold ${open.sales_status === status ? "bg-[var(--ca-navy)] text-white" : "bg-white"}`}>
                      {status.replaceAll("_", " ")}
                    </button>
                  ))}
                </div>
                <label className="mt-4 block text-sm">
                  <span className="mb-1 block font-medium">Sales note</span>
                  <textarea defaultValue={open.sales_note || ""} rows={3} className="w-full rounded-xl border px-3 py-2" onBlur={(e) => void patch({ id: open.id, sales_status: open.sales_status, sales_note: e.target.value })} />
                </label>
              </>
            ) : (
              <div className="mt-4 text-sm text-[var(--ca-navy)]">
                <p className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">Sales status</p>
                <p>{open.sales_status.replaceAll("_", " ")}</p>
                {open.sales_note && <p className="mt-2">{open.sales_note}</p>}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
