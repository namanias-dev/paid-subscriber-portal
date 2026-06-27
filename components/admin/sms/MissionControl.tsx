"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";
import { Activity, Send, Workflow, FileText, ScrollText, BarChart3, Settings as SettingsIcon, RefreshCw, Download, AlertTriangle, CheckCircle2, Power } from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { formatISTDateTime } from "@/lib/dates";

// ---- shared types (mirror API responses) ----
interface TemplateRow {
  id: string; name: string; use_case: string; message_type: string; status: string;
  is_active: boolean; gateway_template_id: string | null; body_template: string; variables: string[];
  trigger_event: string | null; audience_type: string | null;
  worstCaseChars: number; worstCaseSegments: number; over155: boolean; bodyErrors: string[];
}
interface RuleRow {
  trigger: string; template_id: string | null; template_name: string | null; template_ready: boolean;
  enabled: boolean; delay_minutes: number | null; schedule_time: string | null; offset_minutes: number | null;
  audience_type: string | null; last_run_at: string | null;
}
interface LogRow {
  id: string; created_at: string; normalized_mobile: string; student_name: string | null; template_name: string | null;
  status: string; segments: number | null; trigger_event: string | null; sent_by_type: string;
  message_body: string; error_message: string | null; gateway_response: unknown; audience_type: string | null;
}
interface Meta { isSuperAdmin: boolean; webinars: { id: string; slug: string; title: string; datetime: string }[]; leadSources: string[]; leadStages: string[] }

const TABS = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "send", label: "Send SMS", icon: Send },
  { id: "automations", label: "Automations", icon: Workflow },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const;
type TabId = (typeof TABS)[number]["id"];

const STATUS_TONE: Record<string, string> = {
  SENT: "text-success", DELIVERED: "text-success", FAILED: "text-danger", QUEUED: "text-muted", UNKNOWN: "text-muted",
  draft: "pill-gray", pending: "pill-amber", approved: "pill-blue", active: "pill-green", inactive: "pill-gray",
};

export default function MissionControl() {
  const [tab, setTab] = useState<TabId>("overview");
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => { fetch("/api/admin/sms/meta").then((r) => r.json()).then((d) => d.ok && setMeta(d)).catch(() => {}); }, []);

  return (
    <div className="space-y-5 pb-16">
      <div>
        <h1 className="font-heading text-2xl font-extrabold">SMS Mission Control</h1>
        <p className="text-sm text-muted">Send, automate and audit every SMS across the student lifecycle — in-house, DLT-compliant.</p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-medium transition ${tab === t.id ? "border-b-2 border-primary text-primary" : "text-muted hover:text-ink"}`}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "send" && <SendTab meta={meta} />}
      {tab === "automations" && <AutomationsTab canEdit={!!meta?.isSuperAdmin} />}
      {tab === "templates" && <TemplatesTab canEdit={!!meta?.isSuperAdmin} />}
      {tab === "logs" && <LogsTab />}
      {tab === "analytics" && <AnalyticsTab />}
      {tab === "settings" && <SettingsTab canEdit={!!meta?.isSuperAdmin} />}
    </div>
  );
}

// ============================ OVERVIEW ============================
function OverviewTab() {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/sms/overview").then((r) => r.json()).then((d) => setData(d.ok ? d.overview : null)).catch(() => setData(null)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function retry(id: string) {
    const r = await fetch("/api/admin/sms/logs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry", id }) }).then((x) => x.json());
    toast(r.ok ? "Resent." : "Retry failed.", r.ok ? "success" : "error");
    load();
  }

  if (loading) return <LoadingBlock />;
  if (!data) return <p className="text-sm text-muted">No data.</p>;
  const ks = data.killSwitch;

  return (
    <div className="space-y-5">
      <div className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${ks.effectiveOn ? "border-line bg-surface" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        <Power size={16} /> {ks.effectiveOn ? "SMS sending is ON." : "SMS sending is OFF (kill switch or SMS_ENABLED=false). No messages will go out."}
        <button onClick={load} className="btn btn-secondary ml-auto text-xs"><RefreshCw size={13} /> Refresh</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Sent today" value={data.today.sent + data.today.delivered} />
        <Kpi label="Failed" value={data.today.failed} tone="red" />
        <Kpi label="Queued" value={data.today.queued} />
        <Kpi label="Auto / Manual" value={`${data.byTrigger.auto} / ${data.byTrigger.manual}`} />
        <Kpi label="Daily cap" value={data.dailyCap.cap ? `${data.dailyCap.used} / ${data.dailyCap.cap}` : `${data.dailyCap.used} / ∞`} />
      </div>

      <div className="card p-4">
        <p className="mb-3 text-sm font-semibold">Last 24 hours</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data.trend24h}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={3} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="sent" stroke="#16a34a" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="failed" stroke="#dc2626" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <p className="mb-2 text-sm font-semibold">Sends by template (today)</p>
          {data.byTemplate.length === 0 ? <p className="text-sm text-muted">No sends yet today.</p> : (
            <ul className="space-y-1.5 text-sm">
              {data.byTemplate.map((t: any) => (
                <li key={t.template} className="flex justify-between"><span className="text-ink2">{t.name}</span><span className="font-semibold tabular-nums">{t.count}</span></li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-4">
          <p className="mb-2 text-sm font-semibold">Recent failures</p>
          {data.recentFailures.length === 0 ? <p className="text-sm text-muted">None. 🎉</p> : (
            <ul className="space-y-2 text-sm">
              {data.recentFailures.map((l: LogRow) => (
                <li key={l.id} className="flex items-center justify-between gap-2">
                  <span className="truncate"><span className="font-mono text-xs">{l.normalized_mobile}</span> · {l.template_name} <span className="text-danger">({l.error_message || "failed"})</span></span>
                  <button onClick={() => retry(l.id)} className="btn btn-secondary shrink-0 text-xs"><RefreshCw size={12} /> Retry</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================ SEND ============================
function SendTab({ meta }: { meta: Meta | null }) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [audType, setAudType] = useState("person");
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [webinarSlug, setWebinarSlug] = useState("");
  const [source, setSource] = useState("");
  const [stage, setStage] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch("/api/admin/sms/templates").then((r) => r.json()).then((d) => d.ok && setTemplates(d.templates)).catch(() => {}); }, []);

  const sendable = templates.filter((t) => (t.status === "active" || t.status === "approved") && t.gateway_template_id);
  const needsWebinar = audType.startsWith("webinar_");

  function buildAudience() {
    return { type: audType, mobile, name, webinarSlug: needsWebinar ? webinarSlug : null, source: audType === "leads" ? source : null, stage: audType === "leads" ? stage : null };
  }

  async function doPreview() {
    setBusy(true);
    const r = await fetch("/api/admin/sms/audience", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience: buildAudience(), templateId }) }).then((x) => x.json());
    setPreview(r.ok ? r : null);
    setBusy(false);
    if (!r.ok) toast(r.error || "Preview failed", "error");
  }
  async function doSend() {
    if (!templateId) return toast("Pick a template.", "error");
    if (!preview) { await doPreview(); return; }
    if (!confirm(`Send "${templates.find((t) => t.id === templateId)?.name}" to ${preview.count} recipient(s)?`)) return;
    setBusy(true);
    const r = await fetch("/api/admin/sms/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience: buildAudience(), templateId }) }).then((x) => x.json());
    setBusy(false);
    if (r.ok) { toast(`Sent ${r.sent}/${r.requested}. ${Object.keys(r.skipped || {}).length ? "Skipped: " + Object.entries(r.skipped).map(([k, v]) => `${k}:${v}`).join(", ") : ""}`, "success"); setPreview(null); }
    else toast(r.error || "Send failed", "error");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card space-y-3 p-4">
        <Field label="Template (Approved / Active only)">
          <select className="input" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setPreview(null); }}>
            <option value="">Select a template…</option>
            {sendable.map((t) => <option key={t.id} value={t.id}>{t.name}{t.message_type === "promotional" ? " · promo" : ""}</option>)}
          </select>
          {sendable.length === 0 && <p className="mt-1 text-xs text-amber-700">No Approved/Active templates yet — set a DLT ID and activate one in the Templates tab.</p>}
        </Field>

        <Field label="Audience">
          <select className="input" value={audType} onChange={(e) => { setAudType(e.target.value); setPreview(null); }}>
            <optgroup label="Direct"><option value="person">A specific person</option></optgroup>
            <optgroup label="Payments"><option value="payment_pending">Pending</option><option value="payment_failed">Failed</option><option value="payment_paid">Paid</option><option value="payment_abandoned">Abandoned</option><option value="payment_all">All payments</option></optgroup>
            <optgroup label="Webinar"><option value="webinar_registered">Registered</option><option value="webinar_not_registered">NOT registered</option><option value="webinar_attendees">Attended</option><option value="webinar_no_show">No-show</option></optgroup>
            <optgroup label="People"><option value="leads">Leads</option><option value="users_with_mobile">All users with mobile</option><option value="all">Everyone (guarded)</option></optgroup>
          </select>
        </Field>

        {audType === "person" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Mobile"><input className="input" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="10-digit" /></Field>
            <Field label="Name (optional)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          </div>
        )}
        {needsWebinar && (
          <Field label="Webinar">
            <select className="input" value={webinarSlug} onChange={(e) => setWebinarSlug(e.target.value)}>
              <option value="">Select webinar…</option>
              {(meta?.webinars || []).map((w) => <option key={w.id} value={w.slug}>{w.title}</option>)}
            </select>
          </Field>
        )}
        {audType === "leads" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Source"><select className="input" value={source} onChange={(e) => setSource(e.target.value)}><option value="">Any</option>{(meta?.leadSources || []).map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            <Field label="Stage"><select className="input" value={stage} onChange={(e) => setStage(e.target.value)}><option value="">Any</option>{(meta?.leadStages || []).map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={doPreview} disabled={busy} className="btn btn-secondary">{busy ? "…" : "Preview"}</button>
          <button onClick={doSend} disabled={busy || !templateId} className="btn btn-primary"><Send size={15} /> {preview ? `Send to ${preview.count}` : "Preview & send"}</button>
        </div>
      </div>

      <div className="card space-y-3 p-4">
        <p className="text-sm font-semibold">Preview</p>
        {!preview ? <p className="text-sm text-muted">Run a preview to see recipient count, the filled message and cap impact.</p> : (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="pill pill-blue">{preview.count} recipients</span>
              <span className="pill pill-gray">{preview.audienceLabel}</span>
              {preview.promotionalForCold && <span className="pill pill-amber">Promo route + consent for cold numbers</span>}
              {preview.willExceedDaily && <span className="pill pill-amber">Exceeds remaining daily cap ({preview.remainingDaily})</span>}
            </div>
            {preview.preview ? (
              <div className="rounded-xl bg-surface p-3 text-sm">
                <p className="whitespace-pre-wrap">{preview.preview.text}</p>
                <p className="mt-2 text-xs text-muted">{preview.preview.length} chars · {preview.preview.segments} segment(s)</p>
                {preview.preview.errors?.length > 0 && <p className="mt-1 text-xs text-danger">{preview.preview.errors.join("; ")}</p>}
                {preview.preview.missing?.length > 0 && <p className="mt-1 text-xs text-amber-700">Missing: {preview.preview.missing.join(", ")}</p>}
                {preview.preview.warnings?.length > 0 && <p className="mt-1 text-xs text-amber-700">{preview.preview.warnings.join("; ")}</p>}
              </div>
            ) : <p className="text-sm text-muted">Select a template to see the filled message.</p>}
            {preview.dailyCap && <p className="text-xs text-muted">Daily cap {preview.dailyCap}; remaining today {preview.remainingDaily}. Per-mobile cap {preview.perMobileCap || "∞"}.</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ============================ AUTOMATIONS ============================
function AutomationsTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => { setLoading(true); fetch("/api/admin/sms/automations").then((r) => r.json()).then((d) => setRules(d.ok ? d.rules : [])).finally(() => setLoading(false)); }, []);
  useEffect(() => { load(); }, [load]);

  async function patch(trigger: string, body: Record<string, unknown>) {
    const r = await fetch("/api/admin/sms/automations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger, ...body }) }).then((x) => x.json());
    if (r.ok) { toast("Saved.", "success"); load(); } else toast(r.error || "Save failed", "error");
  }

  if (loading) return <LoadingBlock />;
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
          <th className="px-4 py-3">Trigger</th><th className="px-4 py-3">Template</th><th className="px-4 py-3">Schedule</th><th className="px-4 py-3">Audience</th><th className="px-4 py-3">Last run</th><th className="px-4 py-3 text-right">Enabled</th>
        </tr></thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.trigger} className="border-b border-line/60 last:border-0">
              <td className="px-4 py-3 font-medium text-ink">{r.trigger}</td>
              <td className="px-4 py-3">{r.template_name || "—"} {!r.template_ready && <span className="pill pill-amber text-[10px]">no DLT/active</span>}</td>
              <td className="px-4 py-3 text-xs text-ink2">
                {r.schedule_time && <>at {r.schedule_time} IST</>}
                {r.delay_minutes != null && <>+{r.delay_minutes}m delay</>}
                {r.offset_minutes != null && <>end +{r.offset_minutes}m</>}
                {!r.schedule_time && r.delay_minutes == null && r.offset_minutes == null && "on event"}
              </td>
              <td className="px-4 py-3 text-xs">{r.audience_type || "—"}</td>
              <td className="px-4 py-3 text-xs text-muted">{r.last_run_at ? formatISTDateTime(r.last_run_at) : "—"}</td>
              <td className="px-4 py-3 text-right">
                <button disabled={!canEdit || !r.template_ready} onClick={() => patch(r.trigger, { enabled: !r.enabled })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-40 ${r.enabled ? "bg-success/15 text-success" : "bg-surface2 text-muted"}`}>
                  {r.enabled ? "ON" : "OFF"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!canEdit && <p className="p-3 text-xs text-muted">Only a Super Admin can toggle or edit automations.</p>}
    </div>
  );
}

// ============================ TEMPLATES ============================
function TemplatesTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const load = useCallback(() => { setLoading(true); fetch("/api/admin/sms/templates").then((r) => r.json()).then((d) => setTemplates(d.ok ? d.templates : [])).finally(() => setLoading(false)); }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingBlock />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <a href="/api/admin/sms/dlt?format=md" className="btn btn-secondary text-sm"><Download size={15} /> Export DLT (Markdown)</a>
        <a href="/api/admin/sms/dlt?format=csv" className="btn btn-secondary text-sm"><Download size={15} /> Export DLT (CSV)</a>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <th className="px-4 py-3">Template</th><th className="px-4 py-3">Use</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">DLT ID</th><th className="px-4 py-3">Worst-case</th><th className="px-4 py-3 text-right">Edit</th>
          </tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 font-medium text-ink">{t.name}{t.message_type === "promotional" && <span className="pill pill-amber ml-1 text-[10px]">promo</span>}</td>
                <td className="px-4 py-3 text-xs">{t.use_case}</td>
                <td className="px-4 py-3"><span className={`pill text-[10px] ${STATUS_TONE[t.status] || "pill-gray"}`}>{t.status}</span></td>
                <td className="px-4 py-3 font-mono text-xs">{t.gateway_template_id || <span className="text-amber-700">missing</span>}</td>
                <td className="px-4 py-3 text-xs">{t.worstCaseChars}c · {t.worstCaseSegments}seg {t.over155 && <span className="text-amber-700">⚠️</span>}</td>
                <td className="px-4 py-3 text-right"><button onClick={() => setEditing(t)} className="btn btn-secondary text-xs">Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <TemplateEditor t={editing} canEdit={canEdit} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); toast("Saved.", "success"); }} />}
    </div>
  );
}

function TemplateEditor({ t, canEdit, onClose, onSaved }: { t: TemplateRow; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [body, setBody] = useState(t.body_template);
  const [dlt, setDlt] = useState(t.gateway_template_id || "");
  const [status, setStatus] = useState(t.status);
  const [busy, setBusy] = useState(false);
  const len = useMemo(() => [...body].length, [body]);
  const rupee = body.includes("₹");

  async function save() {
    setBusy(true);
    const r = await fetch("/api/admin/sms/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, body_template: body, gateway_template_id: dlt, status }) }).then((x) => x.json());
    setBusy(false);
    if (r.ok) onSaved(); else toast(r.error || "Save failed", "error");
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-xl overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{t.name}</h3>
        <p className="mt-0.5 text-xs text-muted">{t.use_case} · {t.message_type} · variables: {t.variables.join(", ") || "none"}</p>
        <div className="mt-4 space-y-3">
          <Field label="Body (use {variable} tokens; must byte-match approved DLT text)">
            <textarea className="input min-h-[110px] font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit} />
            <p className={`mt-1 text-xs ${len > 155 ? "text-amber-700" : "text-muted"}`}>{len} chars{len > 155 ? " (> 155 — warns)" : ""}{rupee ? " · ❌ contains ₹ (use Rs)" : ""}</p>
          </Field>
          <Field label="DLT Template ID (required before Approved/Active)">
            <input className="input font-mono text-sm" value={dlt} onChange={(e) => setDlt(e.target.value)} disabled={!canEdit} placeholder="paste registered DLT id" />
          </Field>
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} disabled={!canEdit}>
              {["draft", "pending", "approved", "active", "inactive"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">Editing the body or DLT id of an Approved/Active template re-opens it as Draft.</p>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary">Close</button>
          {canEdit && <button onClick={save} disabled={busy} className="btn btn-primary">{busy ? "…" : "Save"}</button>}
        </div>
      </div>
    </div>
  );
}

// ============================ LOGS ============================
function LogsTab() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [mobile, setMobile] = useState("");
  const [open, setOpen] = useState<LogRow | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (mobile) q.set("mobile", mobile);
    fetch(`/api/admin/sms/logs?${q.toString()}`).then((r) => r.json()).then((d) => setLogs(d.ok ? d.logs : [])).finally(() => setLoading(false));
  }, [status, mobile]);
  useEffect(() => { load(); }, [load]);

  async function retry(id: string) {
    const r = await fetch("/api/admin/sms/logs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry", id }) }).then((x) => x.json());
    toast(r.ok ? "Resent." : "Retry failed.", r.ok ? "success" : "error"); load();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{["QUEUED", "SENT", "DELIVERED", "FAILED", "UNKNOWN"].map((s) => <option key={s}>{s}</option>)}</select>
        <input className="input w-40" placeholder="mobile…" value={mobile} onChange={(e) => setMobile(e.target.value)} />
        <button onClick={load} className="btn btn-secondary text-sm"><RefreshCw size={14} /> Apply</button>
        <a href={`/api/admin/sms/logs?format=csv${status ? `&status=${status}` : ""}${mobile ? `&mobile=${mobile}` : ""}`} className="btn btn-secondary text-sm"><Download size={14} /> CSV</a>
      </div>
      {loading ? <LoadingBlock /> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">When</th><th className="px-4 py-3">Mobile</th><th className="px-4 py-3">Template</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">By</th><th className="px-4 py-3 text-right">Actions</th>
            </tr></thead>
            <tbody>
              {logs.length === 0 ? <tr><td colSpan={6} className="p-8 text-center text-sm text-muted">No logs.</td></tr> : logs.map((l) => (
                <tr key={l.id} className="border-b border-line/60 last:border-0 hover:bg-surface2/50">
                  <td className="px-4 py-2.5 text-xs text-muted">{formatISTDateTime(l.created_at)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{l.normalized_mobile}</td>
                  <td className="px-4 py-2.5">{l.template_name}</td>
                  <td className={`px-4 py-2.5 font-semibold ${STATUS_TONE[l.status] || ""}`}>{l.status}</td>
                  <td className="px-4 py-2.5 text-xs">{l.sent_by_type}{l.trigger_event ? ` · ${l.trigger_event}` : ""}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => setOpen(l)} className="btn btn-secondary text-xs">View</button>
                    {l.status === "FAILED" && <button onClick={() => retry(l.id)} className="btn btn-secondary ml-1 text-xs"><RefreshCw size={12} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(null)}>
          <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{open.template_name}</h3>
            <p className="mt-1 text-xs text-muted">{open.normalized_mobile} · {formatISTDateTime(open.created_at)} · {open.status}</p>
            <div className="mt-3 rounded-xl bg-surface p-3 text-sm whitespace-pre-wrap">{open.message_body}</div>
            {open.error_message && <p className="mt-2 text-xs text-danger">Error: {open.error_message}</p>}
            <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted">Gateway response</summary><pre className="mt-2 overflow-x-auto rounded bg-surface p-2">{JSON.stringify(open.gateway_response, null, 2)}</pre></details>
            <div className="mt-4 flex justify-end"><button onClick={() => setOpen(null)} className="btn btn-secondary">Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================ ANALYTICS ============================
function AnalyticsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/admin/sms/analytics?days=30").then((r) => r.json()).then((d) => setData(d.ok ? d.analytics : null)).finally(() => setLoading(false)); }, []);
  if (loading) return <LoadingBlock />;
  if (!data) return <p className="text-sm text-muted">No data.</p>;
  return (
    <div className="space-y-5">
      <div className="card p-4">
        <p className="mb-3 text-sm font-semibold">Sends over time (30 days)</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data.sendsOverTime}><CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis dataKey="day" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip /><Bar dataKey="sent" fill="#16a34a" /><Bar dataKey="failed" fill="#dc2626" /></BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <p className="mb-2 text-sm font-semibold">Delivery rate by template</p>
          <ul className="space-y-1.5 text-sm">{data.deliveryByTemplate.map((t: any) => (<li key={t.template} className="flex justify-between"><span className="text-ink2">{t.name}</span><span className="tabular-nums">{t.sent}/{t.total} · {t.rate}%</span></li>))}{data.deliveryByTemplate.length === 0 && <li className="text-muted">No sends yet.</li>}</ul>
        </div>
        <div className="card p-4">
          <p className="mb-2 text-sm font-semibold">Conversion-adjacent <span className="font-normal text-muted">(correlation, not attribution)</span></p>
          <ul className="space-y-1.5 text-sm">
            <li className="flex justify-between"><span className="text-ink2">Invites sent → later paid</span><span className="tabular-nums">{data.correlation.inviteThenRegistered}/{data.correlation.inviteSent}</span></li>
            <li className="flex justify-between"><span className="text-ink2">Post-webinar (T19) → course enrolled</span><span className="tabular-nums">{data.correlation.t19ThenEnrolled}/{data.correlation.t19Sent}</span></li>
          </ul>
          <p className="mt-3 text-xs text-muted">Estimated cost: {data.cost.segments} segments × Rs {data.cost.ratePerSegment} ≈ Rs {data.cost.estimate}</p>
        </div>
      </div>
    </div>
  );
}

// ============================ SETTINGS ============================
function SettingsTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { fetch("/api/admin/sms/settings").then((r) => r.json()).then((d) => { if (d.ok) { setData(d); setForm(d.settings); } }); }, []);
  useEffect(() => { load(); }, [load]);
  if (!data || !form) return <LoadingBlock />;
  const env = data.env;

  async function save() {
    setBusy(true);
    const r = await fetch("/api/admin/sms/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }).then((x) => x.json());
    setBusy(false);
    if (r.ok) { toast("Saved.", "success"); setForm(r.settings); } else toast(r.error || "Save failed", "error");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card space-y-2 p-4">
        <p className="text-sm font-semibold">Gateway (read-only — secrets never shown)</p>
        <EnvRow label="SMS sending (env)" ok={env.enabledByEnv} text={env.enabledByEnv ? "enabled" : "SMS_ENABLED=false"} />
        <EnvRow label="Gateway configured" ok={env.gatewayConfigured} text={env.gatewayConfigured ? "all keys present" : "missing keys"} />
        <EnvRow label="Auth key" ok={env.authKeySet} text={env.authKeySet ? "set" : "not set"} />
        <EnvRow label="Username" ok={env.usernameSet} text={env.usernameSet ? "set" : "not set"} />
        <EnvRow label="Password" ok={env.passwordSet} text={env.passwordSet ? "set" : "not set"} />
        <div className="mt-2 space-y-1 text-xs text-muted">
          <p>Sender: {env.senderId} · Route: {env.route} · Number format: {env.numberFormat}</p>
          <p>Base URL: {env.baseUrl}</p>
          <p>login_url: {env.loginUrl}</p>
          <p>webinars: {env.webinarsUrl} · course: {env.courseUrl}</p>
        </div>
      </div>

      <div className="card space-y-3 p-4">
        <p className="text-sm font-semibold">Controls</p>
        <label className="flex items-center justify-between text-sm"><span>Master kill switch (soft)</span>
          <button disabled={!canEdit} onClick={() => setForm({ ...form, enabled: !form.enabled })} className={`rounded-full px-3 py-1 text-xs font-semibold ${form.enabled ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>{form.enabled ? "ON" : "OFF"}</button>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Daily cap (0=∞)"><input type="number" className="input" value={form.dailyCap} onChange={(e) => setForm({ ...form, dailyCap: Number(e.target.value) })} disabled={!canEdit} /></Field>
          <Field label="Per-mobile/day (0=∞)"><input type="number" className="input" value={form.perMobileDailyCap} onChange={(e) => setForm({ ...form, perMobileDailyCap: Number(e.target.value) })} disabled={!canEdit} /></Field>
          <Field label="Window start (IST)"><input className="input" value={form.windowStart} onChange={(e) => setForm({ ...form, windowStart: e.target.value })} disabled={!canEdit} /></Field>
          <Field label="Window end (IST)"><input className="input" value={form.windowEnd} onChange={(e) => setForm({ ...form, windowEnd: e.target.value })} disabled={!canEdit} /></Field>
          <Field label="T19 offset (min)"><input type="number" className="input" value={form.t19OffsetMinutes} onChange={(e) => setForm({ ...form, t19OffsetMinutes: Number(e.target.value) })} disabled={!canEdit} /></Field>
          <Field label="T19 fallback all-registered"><select className="input" value={form.t19FallbackAllRegistered ? "1" : "0"} onChange={(e) => setForm({ ...form, t19FallbackAllRegistered: e.target.value === "1" })} disabled={!canEdit}><option value="1">Yes</option><option value="0">No</option></select></Field>
        </div>
        {canEdit ? <button onClick={save} disabled={busy} className="btn btn-primary">{busy ? "…" : "Save settings"}</button> : <p className="text-xs text-muted">Only a Super Admin can change settings.</p>}
      </div>
    </div>
  );
}

// ============================ small bits ============================
function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: "red" }) {
  return <div className="card p-4"><p className="text-xs uppercase tracking-wide text-muted">{label}</p><p className={`mt-1 font-heading text-2xl font-extrabold tabular-nums ${tone === "red" ? "text-danger" : ""}`}>{value}</p></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted">{label}</span>{children}</label>;
}
function EnvRow({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return <div className="flex items-center justify-between text-sm"><span className="text-ink2">{label}</span><span className={`inline-flex items-center gap-1 text-xs ${ok ? "text-success" : "text-amber-700"}`}>{ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{text}</span></div>;
}
