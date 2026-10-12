"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { formatISTDateTime } from "@/lib/dates";
import NotesSmsPlanView, { type NotesPlanView } from "@/components/admin/sms/NotesSmsPlanView";

interface Stats { total: number; queued: number; sent: number; delivered: number; failed: number; lastAt: string | null }
interface TemplateInfo {
  key: string; id: string; dltTemplateId: string; dltType: string; messageType: "service" | "promotional";
  trigger: string; approvedText: string; trackerSample: string; sourceRow: number;
  variables: { slot: number; token: string; placeholder: string; label: string; meaning: string }[];
  nonAscii: string[];
  stored: { body: string; dltId: string | null; messageType: string; category: string | null; status: string } | null;
  drift: string[]; hold: string | null; holdText: string | null; automated: boolean; stats7d: Stats | null;
}
interface AutomationInfo {
  trigger: string; enabled: boolean; cutover: string | null; delayMinutes: number | null; armed: boolean; stats7d: Stats | null;
}
interface Overview {
  ok: boolean; source: string; flagOn: boolean; globalEnabled: boolean;
  window: { start: string; end: string; promoStart: string; promoEnd: string };
  notes500: { problem: string | null; text: string | null };
  templates: TemplateInfo[]; automations: AutomationInfo[]; logsAvailable: boolean;
  recent: { id: string; templateId: string | null; status: string; to: string; trigger: string | null; createdAt: string; error: string | null; sentByType: string }[];
}

const AUTOMATION_LABEL: Record<string, { title: string; when: string }> = {
  notes_order_confirmed: { title: "Order confirmed", when: "On payment capture (Verify), cron catch-up within 48h" },
  notes_payment_pending: { title: "Payment pending", when: "Unpaid order, after the delay, within 24h, latest attempt only" },
  notes_checkout_incomplete: { title: "Checkout incomplete", when: "Abandoned checkout (2h idle), consent given, no order since" },
  notes_new_lead_promo: { title: "New lead promotion", when: "New academy lead with explicit consent, promo hours only" },
};

const STATUS_PILL: Record<string, string> = { DELIVERED: "pill-green", SENT: "pill-blue", QUEUED: "pill-amber", FAILED: "pill-red", SKIPPED: "pill-gray" };

function StatsLine({ s }: { s: Stats | null }) {
  if (!s || !s.total) return <span className="text-xs text-muted">No sends in the last 7 days</span>;
  return (
    <span className="flex flex-wrap gap-1 text-[11px]">
      <span className="pill pill-blue">{s.sent} accepted</span>
      <span className="pill pill-green">{s.delivered} delivered</span>
      <span className="pill pill-red">{s.failed} failed</span>
      {s.queued > 0 && <span className="pill pill-amber">{s.queued} queued</span>}
    </span>
  );
}

function ToggleSwitch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-xs font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40 ${on ? "bg-success/15 text-success" : "bg-surface2 text-muted"}`}
    >
      <span className={`relative inline-block h-5 w-9 rounded-full transition-colors ${on ? "bg-success" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all motion-reduce:transition-none ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
      {on ? "On" : "Off"}
    </button>
  );
}

function TemplateCard({ t, isSuperAdmin, onReconcile }: { t: TemplateInfo; isSuperAdmin: boolean; onReconcile: (key: string) => void }) {
  const ready = !t.hold;
  return (
    <article className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-heading text-sm font-semibold text-ink break-words">{t.key}</h3>
          <p className="mt-0.5 text-xs text-muted">
            DLT <span className="font-mono">{t.dltTemplateId}</span> · {t.dltType} · tracker row {t.sourceRow}
          </p>
        </div>
        {ready
          ? <span className="pill pill-green text-[11px]"><CheckCircle2 size={12} /> Ready</span>
          : <span className="pill pill-amber text-[11px]"><AlertTriangle size={12} /> Held</span>}
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Approved text</p>
        <p className="mt-1 rounded-lg border border-line bg-surface p-2.5 font-mono text-xs leading-relaxed text-ink break-words">{t.approvedText}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] text-left text-xs">
          <thead><tr className="text-muted"><th className="py-1 pr-2">Slot</th><th className="py-1 pr-2">Variable</th><th className="py-1">Filled from</th></tr></thead>
          <tbody>
            {t.variables.map((v) => (
              <tr key={v.slot} className="border-t border-line/60">
                <td className="py-1 pr-2 tabular-nums">{v.slot}</td>
                <td className="py-1 pr-2"><span className="font-mono">{v.placeholder}</span> {v.label}</td>
                <td className="py-1 text-ink2">{v.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.holdText && <p className="rounded-lg bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900">{t.holdText}</p>}
      {t.drift.length > 0 && t.stored && (
        <div className="rounded-lg border border-line p-2.5 text-xs">
          <p className="font-semibold text-ink">Stored row differs: {t.drift.join(", ")}</p>
          <p className="mt-1 font-mono text-ink2 break-words">{t.stored.body}</p>
          <p className="mt-1 text-muted">DLT {t.stored.dltId || "—"} · {t.stored.messageType} · category {t.stored.category || "—"} · {t.stored.status}</p>
          {isSuperAdmin && (
            <button type="button" onClick={() => onReconcile(t.key)} className="btn btn-secondary mt-2 min-h-11 text-xs">
              <ShieldCheck size={14} /> Replace with approved text
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatsLine s={t.stats7d} />
        {t.stats7d?.lastAt && <span className="text-[11px] text-muted">Last {formatISTDateTime(t.stats7d.lastAt)}</span>}
      </div>
    </article>
  );
}

function SendBox({ templates }: { templates: TemplateInfo[] }) {
  const { toast } = useToast();
  const [key, setKey] = useState("NOTES_ORDER_CONFIRMED_01");
  const [ref, setRef] = useState("");
  const [plan, setPlan] = useState<NotesPlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const orderBased = key === "NOTES_ORDER_CONFIRMED_01" || key === "NOTES_PAYMENT_PENDING_01";

  async function call(action: "preview" | "send") {
    const value = ref.trim();
    if (!value) return;
    const target = orderBased
      ? (/^[0-9a-f-]{36}$/i.test(value) ? { orderId: value } : { orderNo: value })
      : { checkoutLeadId: value };
    setBusy(true);
    try {
      const res = await fetch("/api/admin/sms/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, templateKey: key, ...target }),
      }).then((r) => r.json());
      if (res.plan) setPlan(res.plan);
      if (action === "preview" && !res.ok) toast(res.error || "Preview failed", "error");
      if (action === "send") {
        if (res.ok) toast("Accepted by the SMS provider. Delivery is confirmed later by the delivery report.", "success");
        else toast(res.reasonText || res.error || "Not sent", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3 p-4">
      <div>
        <h3 className="font-heading text-sm font-semibold text-ink">Preview or send for one order</h3>
        <p className="mt-0.5 text-xs text-muted">Phone, subject, amount and link are read from the order on the server. Nothing here can change them.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="text-xs text-muted">
          Template
          <select className="input mt-1" value={key} onChange={(e) => { setKey(e.target.value); setPlan(null); }}>
            {templates.map((t) => <option key={t.key} value={t.key}>{t.key}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">
          {orderBased ? "Order number" : "Checkout lead ID"}
          <input
            className="input mt-1 font-mono"
            value={ref}
            onChange={(e) => { setRef(e.target.value); setPlan(null); }}
            placeholder={orderBased ? "NIAS-N-2026-001126" : "lead uuid"}
            autoComplete="off"
          />
        </label>
        <div className="flex items-end">
          <button type="button" disabled={busy || !ref.trim()} onClick={() => void call("preview")} className="btn btn-secondary min-h-11 w-full text-sm sm:w-auto">
            Dry run
          </button>
        </div>
      </div>
      {plan && (
        <NotesSmsPlanView
          plan={plan}
          busy={busy}
          onSend={() => {
            if (window.confirm(`Send ${plan.templateKey} to ${plan.destination}? This sends a real SMS.`)) void call("send");
          }}
        />
      )}
    </section>
  );
}

export default function NotesSmsPanel({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { toast } = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetch("/api/admin/sms/notes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => (d.ok ? setData(d) : setError(d.error || "Could not load")))
      .catch(() => setError("Could not load"));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(a: AutomationInfo) {
    const res = await fetch("/api/admin/sms/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: a.trigger, enabled: !a.enabled }),
    }).then((r) => r.json());
    if (res.ok) { toast(a.enabled ? "Automation off." : "Automation on. Only events from now are considered.", "success"); load(); }
    else toast(res.error || "Save failed", "error");
  }

  async function reconcile(key: string) {
    if (!window.confirm(`Replace the stored ${key} row with the approved DLT text, ID and type?`)) return;
    const res = await fetch("/api/admin/sms/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reconcile_template", templateKey: key }),
    }).then((r) => r.json());
    if (res.ok) { toast(res.changed ? "Template now matches the approved registration." : "Already matched.", "success"); load(); }
    else toast(res.error || "Reconcile failed", "error");
  }

  if (error) {
    return (
      <div className="card p-4 text-sm text-ink">
        {error} <button type="button" onClick={load} className="btn btn-secondary ml-2 min-h-11 text-xs"><RefreshCw size={14} /> Retry</button>
      </div>
    );
  }
  if (!data) return <LoadingBlock />;

  const service = data.templates.filter((t) => t.messageType === "service");
  const promo = data.templates.filter((t) => t.messageType === "promotional");
  const tplByTrigger = new Map(data.templates.map((t) => [t.trigger, t]));

  return (
    <div className="space-y-5">
      <section className="card flex flex-wrap items-center gap-x-5 gap-y-2 p-4 text-xs">
        <span>Store SMS switch <span className="font-mono">notes_store_sms</span>: <strong className={data.flagOn ? "text-success" : "text-danger"}>{data.flagOn ? "On" : "Off"}</strong></span>
        <span>Global SMS: <strong className={data.globalEnabled ? "text-success" : "text-danger"}>{data.globalEnabled ? "On" : "Off"}</strong></span>
        <span>Service send window {data.window.start}–{data.window.end} IST · promotions {data.window.promoStart}–{data.window.promoEnd} IST</span>
        <span className="text-muted">Source: {data.source}</span>
        <button type="button" onClick={load} className="btn btn-secondary ml-auto min-h-11 text-xs"><RefreshCw size={14} /> Refresh</button>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-base font-semibold text-ink">Automations</h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Automation</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Last 7 days</th><th className="px-4 py-3 text-right">Enabled</th>
            </tr></thead>
            <tbody>
              {data.automations.map((a) => {
                const t = tplByTrigger.get(a.trigger);
                const label = AUTOMATION_LABEL[a.trigger] || { title: a.trigger, when: "" };
                return (
                  <tr key={a.trigger} className="border-b border-line/60 align-top last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{label.title}</p>
                      <p className="mt-0.5 text-xs text-muted">{label.when}{a.trigger === "notes_payment_pending" && a.delayMinutes ? ` · delay ${a.delayMinutes} min` : ""}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted">{t?.key}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {t?.hold
                        ? <p className="max-w-sm leading-relaxed text-amber-800">{t.holdText}</p>
                        : a.armed
                          ? <span className="text-success">Running since {formatISTDateTime(a.cutover!)}</span>
                          : <span className="text-muted">Off</span>}
                      {!data.flagOn && a.enabled && <p className="mt-1 text-danger">Store SMS switch is off, so nothing sends.</p>}
                    </td>
                    <td className="px-4 py-3"><StatsLine s={a.stats7d} /></td>
                    <td className="px-4 py-3 text-right">
                      <ToggleSwitch
                        on={a.enabled}
                        label={`${label.title} automation`}
                        disabled={!isSuperAdmin || (!a.enabled && !!t?.hold)}
                        onChange={() => void toggle(a)}
                      />
                    </td>
                  </tr>
                );
              })}
              <tr className="align-top">
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">NOTES500 discount</p>
                  <p className="mt-0.5 text-xs text-muted">Configured for manual use only — never automated</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">NOTES_DISCOUNT_NOTES500_01</p>
                </td>
                <td className="px-4 py-3 text-xs" colSpan={3}>
                  {data.notes500.text
                    ? <p className="max-w-xl leading-relaxed text-amber-800">{data.notes500.text}</p>
                    : <span className="text-success">NOTES500 is live (fixed Rs.500).</span>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {!isSuperAdmin && <p className="text-xs text-muted">Only a Super Admin can switch automations.</p>}
      </section>

      <SendBox templates={data.templates} />

      <section className="space-y-3">
        <h2 className="font-heading text-base font-semibold text-ink">Service templates</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {service.map((t) => <TemplateCard key={t.key} t={t} isSuperAdmin={isSuperAdmin} onReconcile={(k) => void reconcile(k)} />)}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-base font-semibold text-ink">Promotional templates</h2>
        <p className="text-xs text-muted">Promotions need explicit consent, respect opt-outs and promo hours, and are capped at one Notes promotion per phone per 7 days.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          {promo.map((t) => <TemplateCard key={t.key} t={t} isSuperAdmin={isSuperAdmin} onReconcile={(k) => void reconcile(k)} />)}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-base font-semibold text-ink">Recent Notes SMS</h2>
        {!data.logsAvailable && <p className="text-xs text-danger">Logs could not be read.</p>}
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">When</th><th className="px-4 py-3">Template</th><th className="px-4 py-3">To</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Status</th>
            </tr></thead>
            <tbody>
              {data.recent.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-muted">No Notes SMS yet.</td></tr>}
              {data.recent.map((l) => (
                <tr key={l.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2.5 text-xs text-muted">{formatISTDateTime(l.createdAt)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{l.templateId}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{l.to}</td>
                  <td className="px-4 py-2.5 text-xs">{l.sentByType === "ADMIN" ? "Staff" : "Automation"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`pill text-[10px] ${STATUS_PILL[l.status] || "pill-gray"}`}>{l.status === "SENT" ? "ACCEPTED" : l.status}</span>
                    {l.error && <span className="ml-1 text-[11px] text-danger">{l.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">Accepted means the provider took the request. Delivered comes only from the delivery report.</p>
      </section>
    </div>
  );
}
