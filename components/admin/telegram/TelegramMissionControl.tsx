"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity, Send, Workflow, FileText, Inbox, BarChart3, Settings as SettingsIcon,
  RefreshCw, AlertTriangle, CheckCircle2, Plus, Trash2, Clock, MessageCircle, ExternalLink, Save, Eye,
} from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import TimeframeFilter from "@/components/admin/TimeframeFilter";
import { formatISTDateTime, istTodayYMD, resolveTimeframe, type TimeframeValue } from "@/lib/dates";

// ---- meta / permissions (booleans only — token never reaches the client) ----
interface Meta {
  canInbox: boolean;
  canManage: boolean;
  isSuperAdmin: boolean;
  configured: boolean;
  webhookRegistered: boolean;
  webhookUrl: string | null;
  lastWebhookError: string | null;
  lastWebhookErrorAt: string | null;
  botUsername: string | null;
}

// ---- local audience options (mirror PHONE_AUDIENCES — do NOT import server module) ----
const AUDIENCES = [
  { id: "not_yet_paid", label: "Not yet paid", definition: "No successful payment of any kind" },
  { id: "webinar_no_course", label: "Webinar attended, no course", definition: "Paid webinar registration, but no seat booking and no installment paid" },
  { id: "webinar_seat_booked", label: "Webinar + seat booked", definition: "Paid webinar registration and a successful seat booking" },
  { id: "not_called_no_response", label: "Not called / no response", definition: "Pipeline stage is Not Called or Not Replied" },
  { id: "interested", label: "Interested", definition: "Pipeline stage is Interested" },
  { id: "seat_booked", label: "Seat booked", definition: "Successful seat-booking payment" },
  { id: "pending_installments", label: "Pending installments", definition: "At least one unpaid installment due" },
  { id: "dropped_off_at_payment", label: "Dropped off at payment", definition: "Payment status failed, abandoned, or checkout-opened" },
] as const;

// SMS TRIGGERS + Telegram-specific
const TRIGGERS: { id: string; label: string }[] = [
  { id: "payment_success", label: "Payment success" },
  { id: "payment_pending", label: "Payment pending" },
  { id: "proof_uploaded", label: "Proof uploaded" },
  { id: "admin_approval", label: "Admin approval" },
  { id: "payment_failed", label: "Payment failed" },
  { id: "payment_abandoned", label: "Payment abandoned" },
  { id: "registration_created", label: "Registration created" },
  { id: "webinar_day_before", label: "Webinar day before" },
  { id: "webinar_sameday_registered", label: "Webinar same-day (registered)" },
  { id: "webinar_starting_soon", label: "Webinar starting soon" },
  { id: "zoom_published", label: "Zoom published" },
  { id: "webinar_sameday_invite", label: "Webinar same-day invite" },
  { id: "post_webinar_thankyou", label: "Post-webinar thank you" },
  { id: "first_login", label: "First login" },
  { id: "course_enrolled", label: "Course enrolled" },
  { id: "payment_plan_changed", label: "Payment plan changed" },
  { id: "webinar_moved", label: "Webinar moved" },
  { id: "lead_created", label: "Lead created" },
  { id: "subscriber_joined", label: "Subscriber joined" },
  { id: "subscriber_replied", label: "Subscriber replied" },
  { id: "scheduled", label: "Scheduled" },
  { id: "manual", label: "Manual" },
];

type InlineBtn = { label: string; url: string };
type FollowUpStep = {
  delay_hours: number;
  body: string;
  buttons: InlineBtn[];
  stop_conditions: string;
};

const TABS = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "broadcast", label: "Broadcast", icon: Send },
  { id: "automations", label: "Automations", icon: Workflow },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const;
type TabId = (typeof TABS)[number]["id"];

const TF_MODES: TimeframeValue["mode"][] = ["today", "7d", "30d", "range"];

function emptyButtons(): InlineBtn[] {
  return [{ label: "", url: "" }, { label: "", url: "" }, { label: "", url: "" }];
}
function trimButtons(btns: InlineBtn[]): InlineBtn[] {
  return btns.filter((b) => b.label.trim() && b.url.trim()).slice(0, 3);
}
function padButtons(btns?: InlineBtn[] | null): InlineBtn[] {
  const base = [...(btns || [])].slice(0, 3);
  while (base.length < 3) base.push({ label: "", url: "" });
  return base;
}

export default function TelegramMissionControl() {
  const [tab, setTab] = useState<TabId>("overview");
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    fetch("/api/admin/telegram/meta")
      .then((r) => r.json())
      .then((d) => {
        if (!d || (d.ok === false && d.canInbox === undefined)) return;
        // Server evaluates TELEGRAM_BOT_TOKEN via botConfigured(); accept either key name.
        const configured = d.configured === true || d.botConfigured === true;
        setMeta({
          canInbox: !!d.canInbox,
          canManage: !!d.canManage,
          isSuperAdmin: !!d.isSuperAdmin,
          configured,
          webhookRegistered: d.webhookRegistered === true,
          webhookUrl: typeof d.webhookUrl === "string" ? d.webhookUrl : null,
          lastWebhookError: typeof d.lastWebhookError === "string" ? d.lastWebhookError : null,
          lastWebhookErrorAt: typeof d.lastWebhookErrorAt === "string" ? d.lastWebhookErrorAt : null,
          botUsername: d.botUsername ?? null,
        });
      })
      .catch(() => {});
  }, []);

  const canManage = !!meta?.canManage;
  const canInbox = !!meta?.canInbox;
  const visibleTabs = TABS.filter((t) => {
    if (t.id === "broadcast") return canManage;
    if (t.id === "inbox") return canInbox || canManage;
    return true;
  });

  const statusTone = !meta
    ? null
    : !meta.configured || !meta.webhookRegistered || meta.lastWebhookError
      ? "amber"
      : "green";

  return (
    <div className="space-y-5 pb-16">
      <div>
        <h1 className="font-heading text-2xl font-extrabold">Telegram Mission Control</h1>
        <p className="text-sm text-muted">Broadcast, automate and reply via Telegram — subscribers, leads and students.</p>
      </div>

      {meta && statusTone && (
        <div
          className={`rounded-xl border p-3 text-sm ${
            statusTone === "green"
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <div className="flex items-start gap-2">
            {statusTone === "green"
              ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-700" />
              : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap gap-2">
                <span className={`pill text-[10px] ${meta.configured ? "pill-green" : "pill-amber"}`}>
                  Token {meta.configured ? "configured" : "missing"}
                </span>
                <span className={`pill text-[10px] ${meta.webhookRegistered ? "pill-green" : "pill-amber"}`}>
                  Webhook {meta.webhookRegistered ? "registered" : "not registered"}
                </span>
                {meta.botUsername && (
                  <span className="pill pill-gray text-[10px]">@{meta.botUsername.replace(/^@/, "")}</span>
                )}
              </div>
              {!meta.configured && (
                <p>
                  <code className="font-mono text-xs">TELEGRAM_BOT_TOKEN</code> is missing on the server — Telegram sending is not configured.
                </p>
              )}
              {meta.configured && !meta.webhookRegistered && (
                <p>Bot token is present, but no webhook URL is registered. Run <code className="font-mono text-xs">setWebhook</code> against this deployment.</p>
              )}
              {meta.webhookUrl && (
                <p className="truncate text-xs text-muted" title={meta.webhookUrl}>URL: {meta.webhookUrl}</p>
              )}
              {meta.lastWebhookError && (
                <p className="text-xs">
                  Last webhook error{meta.lastWebhookErrorAt ? ` (${formatISTDateTime(meta.lastWebhookErrorAt)})` : ""}:{" "}
                  <span className="font-medium">{meta.lastWebhookError}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {visibleTabs.map((t) => {
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
      {tab === "broadcast" && canManage && <BroadcastTab />}
      {tab === "automations" && <AutomationsTab canEdit={canManage} />}
      {tab === "templates" && <TemplatesTab canEdit={canManage} />}
      {tab === "inbox" && (canInbox || canManage) && <InboxTab />}
      {tab === "analytics" && <AnalyticsTab />}
      {tab === "settings" && <SettingsTab canEdit={canManage} botUsername={meta?.botUsername ?? null} />}
    </div>
  );
}

// ============================ OVERVIEW ============================
function OverviewTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/telegram/overview")
      .then((r) => r.json())
      .then((d) => setData(d?.ok ? d.overview : d?.overview ?? null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingBlock />;
  if (!data) return <p className="text-sm text-muted">No data.</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <button onClick={load} className="btn btn-secondary ml-auto text-xs"><RefreshCw size={13} /> Refresh</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Active subscribers" value={data.activeSubscribers ?? "—"} />
        <Kpi label="Total subscribers" value={data.totalSubscribers ?? "—"} />
        <Kpi label="Queued" value={data.queued ?? "—"} />
        <Kpi label="Sent today" value={data.sentToday ?? "—"} />
        <Kpi label="Unread inbox" value={data.unread ?? "—"} tone={data.unread > 0 ? "red" : undefined} />
      </div>
    </div>
  );
}

// ============================ BROADCAST ============================
function BroadcastTab() {
  const { toast } = useToast();
  const [step, setStep] = useState<"compose" | "preview" | "send">("compose");
  const [name, setName] = useState("");
  const [audienceId, setAudienceId] = useState<string>(AUDIENCES[0].id);
  const [tf, setTf] = useState<TimeframeValue>({ mode: "30d" });
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [buttons, setButtons] = useState<InlineBtn[]>(emptyButtons());
  const [scheduledAt, setScheduledAt] = useState("");
  const [audienceMeta, setAudienceMeta] = useState<{ audienceSize?: number; reachableCount?: number; skippedNoTelegram?: number } | null>(null);
  const [busy, setBusy] = useState(false);

  function setThisYear() {
    const y = istTodayYMD().slice(0, 4);
    setTf({ mode: "range", from: `${y}-01-01`, to: istTodayYMD() });
  }

  async function loadAudience() {
    setBusy(true);
    const { fromMs, toMs } = resolveTimeframe(tf);
    const qs = new URLSearchParams({
      audienceId,
      fromMs: String(Number.isFinite(fromMs) ? fromMs : 0),
      toMs: String(Number.isFinite(toMs) ? toMs : Date.now() + 86400000),
    });
    const d = await fetch(`/api/admin/telegram/audience?${qs}`).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (d?.ok || d?.audienceSize !== undefined) {
      setAudienceMeta({
        audienceSize: d.audienceSize,
        reachableCount: d.reachableCount,
        skippedNoTelegram: d.skippedNoTelegram,
      });
      setStep("preview");
    } else {
      toast(d?.error || "Could not load audience", "error");
    }
  }

  async function send(schedule: boolean) {
    if (!body.trim()) { toast("Message body required", "error"); return; }
    setBusy(true);
    const { fromMs, toMs } = resolveTimeframe(tf);
    const payload: Record<string, unknown> = {
      audienceId,
      fromMs: Number.isFinite(fromMs) ? fromMs : 0,
      toMs: Number.isFinite(toMs) ? toMs : Date.now() + 86400000,
      body: body.trim(),
      imageUrl: imageUrl.trim() || undefined,
      buttons: trimButtons(buttons),
      name: name.trim() || undefined,
    };
    if (schedule && scheduledAt) payload.scheduledAt = new Date(scheduledAt).toISOString();
    const d = await fetch("/api/admin/telegram/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (d?.ok) {
      toast(schedule ? "Broadcast scheduled." : "Broadcast queued.", "success");
      setStep("compose");
      setAudienceMeta(null);
    } else {
      toast(d?.error || "Send failed", "error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        {(["compose", "preview", "send"] as const).map((s, i) => (
          <span key={s} className={`pill ${step === s ? "pill-blue" : "pill-gray"}`}>{i + 1}. {s}</span>
        ))}
      </div>

      <div className="card space-y-3 p-4">
        <p className="text-sm font-semibold">Compose</p>
        <Field label="Campaign name (optional)">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Seat booking nudge — Mar" />
        </Field>
        <Field label="Audience">
          <select className="input" value={audienceId} onChange={(e) => { setAudienceId(e.target.value); setAudienceMeta(null); setStep("compose"); }}>
            {AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">{AUDIENCES.find((a) => a.id === audienceId)?.definition}</p>
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Timeframe</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <TimeframeFilter value={tf} onChange={(v) => { setTf(v); setAudienceMeta(null); setStep("compose"); }} modes={TF_MODES} size="sm" />
            <button type="button" onClick={setThisYear}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${tf.mode === "range" && tf.from?.endsWith("-01-01") && tf.from?.startsWith(istTodayYMD().slice(0, 4)) ? "bg-primary text-white" : "bg-surface2 text-ink2 hover:bg-surface"}`}>
              This year
            </button>
          </div>
        </div>
        <Field label="Message body ({{vars}} ok)">
          <textarea className="input min-h-[120px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hi {{first_name}}, …" />
        </Field>
        <Field label="Image URL (optional)">
          <input className="input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <ButtonsEditor buttons={buttons} onChange={setButtons} />
        <button onClick={loadAudience} disabled={busy || !body.trim()} className="btn btn-primary">
          <Eye size={14} /> {busy ? "…" : "Preview audience"}
        </button>
      </div>

      {step !== "compose" && audienceMeta && (
        <div className="card space-y-3 p-4">
          <p className="text-sm font-semibold">Audience size vs reachable</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Audience size" value={audienceMeta.audienceSize ?? "—"} />
            <Kpi label="Reachable (Telegram)" value={audienceMeta.reachableCount ?? "—"} />
            <Kpi label="Skipped (no TG)" value={audienceMeta.skippedNoTelegram ?? "—"} />
          </div>
          <div className="rounded-xl border border-line bg-surface2 p-3 text-sm whitespace-pre-wrap">{body}</div>
          <Field label="Schedule (optional, IST local)">
            <input type="datetime-local" className="input" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => send(false)} disabled={busy} className="btn btn-primary"><Send size={14} /> {busy ? "…" : "Send now"}</button>
            <button onClick={() => send(true)} disabled={busy || !scheduledAt} className="btn btn-secondary"><Clock size={14} /> Schedule</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================ AUTOMATIONS ============================
function AutomationsTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(blankAutomation());
  const [testChatId, setTestChatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewText, setPreviewText] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/telegram/automations")
      .then((r) => r.json())
      .then((d) => setRows(d?.automations || d?.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing({});
    setForm(blankAutomation());
    setPreviewText("");
    setTestChatId("");
  }
  function openEdit(row: any) {
    setEditing(row);
    setForm({
      id: row.id,
      name: row.name || "",
      enabled: !!row.enabled,
      trigger: row.trigger || "manual",
      audienceId: row.audience_id || row.audienceId || AUDIENCES[0].id,
      body: row.body || "",
      imageUrl: row.image_url || row.imageUrl || "",
      buttons: padButtons(row.buttons),
      followUps: Array.isArray(row.follow_ups || row.followUps)
        ? (row.follow_ups || row.followUps).map((f: any) => ({
            delay_hours: Number(f.delay_hours ?? f.delayHours ?? 24),
            body: f.body || "",
            buttons: padButtons(f.buttons),
            stop_conditions: f.stop_conditions || f.stopConditions || "",
          }))
        : [],
      scheduleMode: row.schedule_mode || row.scheduleMode || "immediate",
    });
    setPreviewText("");
    setTestChatId("");
  }

  function preview() {
    setPreviewText(form.body.replace(/\{\{(\w+)\}\}/g, (_, k) => `[${k}]`));
  }

  async function save() {
    if (!canEdit) return;
    if (!form.name.trim() || !form.body.trim()) { toast("Name and body required", "error"); return; }
    setBusy(true);
    const payload = {
      id: form.id,
      name: form.name.trim(),
      enabled: form.enabled,
      trigger: form.trigger,
      audienceId: form.audienceId,
      body: form.body,
      imageUrl: form.imageUrl.trim() || null,
      buttons: trimButtons(form.buttons),
      followUps: form.followUps.map((f) => ({
        delay_hours: f.delay_hours,
        body: f.body,
        buttons: trimButtons(f.buttons),
        stop_conditions: f.stop_conditions.trim() || null,
      })),
      scheduleMode: form.scheduleMode,
    };
    const method = form.id ? "PATCH" : "POST";
    const d = await fetch("/api/admin/telegram/automations", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (d?.ok) {
      toast("Automation saved.", "success");
      setEditing(null);
      load();
    } else toast(d?.error || "Save failed", "error");
  }

  async function testSend() {
    if (!testChatId.trim() || !form.body.trim()) { toast("chat_id and body required", "error"); return; }
    setBusy(true);
    const d = await fetch("/api/admin/telegram/test-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: testChatId.trim(), body: form.body, buttons: trimButtons(form.buttons) }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    toast(d?.ok ? "Test sent." : (d?.error || "Test failed"), d?.ok ? "success" : "error");
  }

  if (loading) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted">{rows.length} automation{rows.length === 1 ? "" : "s"}</p>
        {canEdit && (
          <button onClick={openNew} className="btn btn-primary ml-auto text-xs"><Plus size={13} /> New automation</button>
        )}
        {!canEdit && <p className="ml-auto text-xs text-muted">Read-only</p>}
      </div>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted">No automations yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id || r.name} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className={`pill ${r.enabled ? "pill-green" : "pill-gray"}`}>{r.enabled ? "ON" : "OFF"}</span>
                <span className="font-medium text-ink">{r.name}</span>
                <span className="text-xs text-muted">{TRIGGERS.find((t) => t.id === r.trigger)?.label || r.trigger}</span>
                <button onClick={() => openEdit(r)} className="btn btn-secondary ml-auto text-xs">Open</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <div className="card space-y-3 p-4">
          <p className="text-sm font-semibold">{form.id ? "Edit automation" : "New automation"}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input className="input" value={form.name} disabled={!canEdit} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Enabled">
              <button type="button" disabled={!canEdit}
                onClick={() => setForm({ ...form, enabled: !form.enabled })}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${form.enabled ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
                {form.enabled ? "ON" : "OFF"}
              </button>
            </Field>
            <Field label="Trigger">
              <select className="input" value={form.trigger} disabled={!canEdit} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
                {TRIGGERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Audience">
              <select className="input" value={form.audienceId} disabled={!canEdit} onChange={(e) => setForm({ ...form, audienceId: e.target.value })}>
                {AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </Field>
            <Field label="Schedule mode">
              <select className="input" value={form.scheduleMode} disabled={!canEdit} onChange={(e) => setForm({ ...form, scheduleMode: e.target.value })}>
                <option value="immediate">Immediate</option>
                <option value="queued">Queued</option>
                <option value="window">Send window</option>
              </select>
            </Field>
          </div>
          <Field label="Message body ({{vars}})">
            <textarea className="input min-h-[100px]" value={form.body} disabled={!canEdit} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
          <Field label="Image URL">
            <input className="input" value={form.imageUrl} disabled={!canEdit} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
          </Field>
          <ButtonsEditor buttons={form.buttons} onChange={(b) => setForm({ ...form, buttons: b })} disabled={!canEdit} />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">Follow-up steps</p>
              {canEdit && (
                <button type="button" className="btn btn-secondary text-xs" onClick={() => setForm({
                  ...form,
                  followUps: [...form.followUps, { delay_hours: 24, body: "", buttons: emptyButtons(), stop_conditions: "" }],
                })}><Plus size={12} /> Add step</button>
              )}
            </div>
            {form.followUps.map((fu, i) => (
              <div key={i} className="rounded-xl border border-line p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Field label="Delay (hours)">
                    <input type="number" className="input w-28" value={fu.delay_hours} disabled={!canEdit}
                      onChange={(e) => {
                        const next = [...form.followUps];
                        next[i] = { ...fu, delay_hours: Number(e.target.value) };
                        setForm({ ...form, followUps: next });
                      }} />
                  </Field>
                  {canEdit && (
                    <button type="button" className="btn btn-secondary ml-auto text-xs" onClick={() => setForm({ ...form, followUps: form.followUps.filter((_, j) => j !== i) })}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <Field label="Body">
                  <textarea className="input min-h-[72px]" value={fu.body} disabled={!canEdit}
                    onChange={(e) => {
                      const next = [...form.followUps];
                      next[i] = { ...fu, body: e.target.value };
                      setForm({ ...form, followUps: next });
                    }} />
                </Field>
                <ButtonsEditor
                  buttons={fu.buttons}
                  disabled={!canEdit}
                  onChange={(b) => {
                    const next = [...form.followUps];
                    next[i] = { ...fu, buttons: b };
                    setForm({ ...form, followUps: next });
                  }}
                />
                <Field label="Stop conditions (free text)">
                  <input className="input" value={fu.stop_conditions} disabled={!canEdit} placeholder="e.g. paid, replied, unsubscribed"
                    onChange={(e) => {
                      const next = [...form.followUps];
                      next[i] = { ...fu, stop_conditions: e.target.value };
                      setForm({ ...form, followUps: next });
                    }} />
                </Field>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={preview} className="btn btn-secondary text-xs"><Eye size={13} /> Preview</button>
            {canEdit && <button type="button" onClick={save} disabled={busy} className="btn btn-primary text-xs"><Save size={13} /> {busy ? "…" : "Save"}</button>}
            <button type="button" onClick={() => setEditing(null)} className="btn btn-secondary text-xs">Close</button>
          </div>
          {previewText && (
            <div className="rounded-xl border border-line bg-surface2 p-3 text-sm whitespace-pre-wrap">{previewText}</div>
          )}
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <Field label="Test-send chat_id">
                <input className="input w-48" value={testChatId} onChange={(e) => setTestChatId(e.target.value)} placeholder="Telegram chat id" />
              </Field>
              <button type="button" onClick={testSend} disabled={busy} className="btn btn-secondary text-xs"><Send size={13} /> Test send</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function blankAutomation() {
  return {
    id: undefined as string | undefined,
    name: "",
    enabled: true,
    trigger: "manual",
    audienceId: AUDIENCES[0].id as string,
    body: "",
    imageUrl: "",
    buttons: emptyButtons(),
    followUps: [] as FollowUpStep[],
    scheduleMode: "immediate",
  };
}

// ============================ TEMPLATES ============================
function TemplatesTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ id?: string; name: string; body: string; buttons: InlineBtn[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/telegram/templates")
      .then((r) => r.json())
      .then((d) => setRows(d?.templates || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form || !canEdit) return;
    if (!form.name.trim() || !form.body.trim()) { toast("Name and body required", "error"); return; }
    setBusy(true);
    const method = form.id ? "PATCH" : "POST";
    const d = await fetch("/api/admin/telegram/templates", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: form.id, name: form.name.trim(), body: form.body, buttons: trimButtons(form.buttons) }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (d?.ok) { toast("Template saved.", "success"); setForm(null); load(); }
    else toast(d?.error || "Save failed", "error");
  }

  if (loading) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted">{rows.length} template{rows.length === 1 ? "" : "s"}</p>
        {canEdit && (
          <button onClick={() => setForm({ name: "", body: "", buttons: emptyButtons() })} className="btn btn-primary ml-auto text-xs">
            <Plus size={13} /> New template
          </button>
        )}
      </div>
      <div className="card overflow-hidden">
        {rows.length === 0 ? <p className="p-4 text-sm text-muted">No templates.</p> : (
          <ul className="divide-y divide-line">
            {rows.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <FileText size={14} className="text-muted" />
                <span className="font-medium">{t.name}</span>
                <span className="truncate text-xs text-muted max-w-[40%]">{t.body}</span>
                {canEdit && (
                  <button className="btn btn-secondary ml-auto text-xs" onClick={() => setForm({
                    id: t.id, name: t.name || "", body: t.body || "", buttons: padButtons(t.buttons),
                  })}>Edit</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {form && (
        <div className="card space-y-3 p-4">
          <p className="text-sm font-semibold">{form.id ? "Edit template" : "New template"}</p>
          <Field label="Name"><input className="input" value={form.name} disabled={!canEdit} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Body"><textarea className="input min-h-[100px]" value={form.body} disabled={!canEdit} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <ButtonsEditor buttons={form.buttons} onChange={(b) => setForm({ ...form, buttons: b })} disabled={!canEdit} />
          <div className="flex gap-2">
            {canEdit && <button onClick={save} disabled={busy} className="btn btn-primary text-xs"><Save size={13} /> {busy ? "…" : "Save"}</button>}
            <button onClick={() => setForm(null)} className="btn btn-secondary text-xs">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================ INBOX ============================
function InboxTab() {
  const { toast } = useToast();
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatId, setChatId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ messages?: any[]; subscriber?: any; lead?: any; student?: any } | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/telegram/inbox")
      .then((r) => r.json())
      .then((d) => setConversations(d?.conversations || []))
      .catch(() => setConversations([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  const openThread = useCallback((id: string) => {
    setChatId(id);
    setThreadLoading(true);
    fetch(`/api/admin/telegram/inbox?chat_id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => setThread({
        messages: d?.messages || [],
        subscriber: d?.subscriber,
        lead: d?.lead,
        student: d?.student,
      }))
      .catch(() => setThread(null))
      .finally(() => setThreadLoading(false));
  }, []);

  async function sendReply() {
    if (!chatId || !reply.trim()) return;
    setBusy(true);
    const d = await fetch("/api/admin/telegram/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, body: reply.trim() }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (d?.ok) {
      setReply("");
      toast("Sent.", "success");
      openThread(chatId);
      loadList();
    } else toast(d?.error || "Send failed", "error");
  }

  if (loading) return <LoadingBlock />;

  const active = conversations.find((c) => String(c.chat_id) === String(chatId));
  const leadId = thread?.lead?.id || active?.linked_lead_id;
  const studentId = thread?.student?.id || active?.linked_student_id;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
      <div className="card overflow-hidden max-h-[70vh] overflow-y-auto">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <p className="text-sm font-semibold">Conversations</p>
          <button onClick={loadList} className="btn btn-secondary ml-auto text-xs"><RefreshCw size={12} /></button>
        </div>
        {conversations.length === 0 ? (
          <p className="p-4 text-sm text-muted">No conversations.</p>
        ) : (
          <ul className="divide-y divide-line">
            {conversations.map((c) => {
              const id = String(c.chat_id);
              const sel = id === String(chatId);
              return (
                <li key={id}>
                  <button type="button" onClick={() => openThread(id)}
                    className={`w-full px-3 py-2.5 text-left text-sm transition ${sel ? "bg-primary/10" : "hover:bg-surface2"}`}>
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-ink">{c.name || id}</span>
                      {(c.unread ?? 0) > 0 && <span className="pill pill-red ml-auto text-[10px]">{c.unread}</span>}
                    </div>
                    <p className="truncate text-xs text-muted">{c.last_body || "—"}</p>
                    <p className="text-[10px] text-muted">{c.last_at ? formatISTDateTime(c.last_at) : ""}{c.stage ? ` · ${c.stage}` : ""}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card flex max-h-[70vh] flex-col overflow-hidden">
        {!chatId ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted">
            <MessageCircle size={18} className="mr-2" /> Select a conversation
          </div>
        ) : threadLoading ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : (
          <>
            <div className="space-y-1 border-b border-line px-4 py-3">
              <p className="text-sm font-semibold">{active?.name || thread?.subscriber?.name || chatId}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                {leadId && (
                  <Link href={`/admin/leads`} className="inline-flex items-center gap-1 text-primary hover:underline" title={String(leadId)}>
                    Lead <ExternalLink size={11} />
                  </Link>
                )}
                {studentId && (
                  <Link href={`/admin/students/${studentId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                    Student <ExternalLink size={11} />
                  </Link>
                )}
                {!leadId && !studentId && <span className="text-muted">No linked lead/student</span>}
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {(thread?.messages || []).length === 0 ? (
                <p className="text-sm text-muted">No messages.</p>
              ) : (
                (thread?.messages || []).map((m: any, i: number) => {
                  const outbound = m.direction === "out" || m.direction === "outbound" || m.from === "bot";
                  return (
                    <div key={m.id || i} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${outbound ? "ml-auto bg-primary/10 text-ink" : "bg-surface2 text-ink"}`}>
                      <p className="whitespace-pre-wrap">{m.body || m.text || ""}</p>
                      <p className="mt-1 text-[10px] text-muted">{m.created_at || m.at ? formatISTDateTime(m.created_at || m.at) : ""}</p>
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex gap-2 border-t border-line p-3">
              <input className="input flex-1" value={reply} onChange={(e) => setReply(e.target.value)}
                placeholder="Reply…" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendReply(); } }} />
              <button onClick={sendReply} disabled={busy || !reply.trim()} className="btn btn-primary shrink-0"><Send size={14} /></button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================ ANALYTICS ============================
function AnalyticsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/admin/telegram/analytics")
      .then((r) => r.json())
      .then((d) => setData(d?.ok ? d : d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <LoadingBlock />;
  if (!data) return <p className="text-sm text-muted">No analytics yet.</p>;

  const stats = data.analytics || data.stats || data;
  const keys = Object.keys(stats).filter((k) => typeof stats[k] === "number" || typeof stats[k] === "string");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {keys.length === 0 ? (
          <p className="text-sm text-muted col-span-full">No numeric metrics returned.</p>
        ) : (
          keys.slice(0, 12).map((k) => <Kpi key={k} label={k.replace(/_/g, " ")} value={stats[k]} />)
        )}
      </div>
      {Array.isArray(stats.byDay) && (
        <div className="card p-4">
          <p className="mb-2 text-sm font-semibold">By day</p>
          <ul className="space-y-1 text-sm">
            {stats.byDay.map((d: any, i: number) => (
              <li key={i} className="flex justify-between"><span className="text-ink2">{d.day || d.date}</span><span className="tabular-nums font-semibold">{d.count ?? d.sent ?? "—"}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================ SETTINGS ============================
function SettingsTab({ canEdit, botUsername }: { canEdit: boolean; botUsername: string | null }) {
  const { toast } = useToast();
  const [welcome, setWelcome] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/telegram/settings")
      .then((r) => r.json())
      .then((d) => {
        setWelcome(d?.settings?.welcomeMessage || d?.welcomeMessage || d?.welcome_message || "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!canEdit) return;
    setBusy(true);
    const d = await fetch("/api/admin/telegram/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ welcomeMessage: welcome }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    toast(d?.ok ? "Settings saved." : (d?.error || "Save failed"), d?.ok ? "success" : "error");
  }

  if (loading) return <LoadingBlock />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-3 p-4">
        <p className="text-sm font-semibold">Bot</p>
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink2">Username</span>
          <span className="font-medium text-ink">{botUsername ? `@${botUsername.replace(/^@/, "")}` : "—"}</span>
        </div>
      </div>
      <div className="card space-y-3 p-4">
        <p className="text-sm font-semibold">Welcome message</p>
        <textarea className="input min-h-[120px]" value={welcome} disabled={!canEdit} onChange={(e) => setWelcome(e.target.value)}
          placeholder="Sent when a subscriber joins…" />
        {canEdit ? (
          <button onClick={save} disabled={busy} className="btn btn-primary">{busy ? "…" : "Save settings"}</button>
        ) : (
          <p className="text-xs text-muted">You need manage permission to edit settings.</p>
        )}
      </div>
    </div>
  );
}

// ============================ small bits ============================
function ButtonsEditor({ buttons, onChange, disabled }: { buttons: InlineBtn[]; onChange: (b: InlineBtn[]) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted">Inline buttons (up to 3)</p>
      {buttons.map((b, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-2">
          <input className="input" placeholder={`Button ${i + 1} label`} value={b.label} disabled={disabled}
            onChange={(e) => {
              const next = [...buttons];
              next[i] = { ...b, label: e.target.value };
              onChange(next);
            }} />
          <input className="input" placeholder="https://…" value={b.url} disabled={disabled}
            onChange={(e) => {
              const next = [...buttons];
              next[i] = { ...b, url: e.target.value };
              onChange(next);
            }} />
        </div>
      ))}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: "red" }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 font-heading text-2xl font-extrabold tabular-nums ${tone === "red" ? "text-danger" : ""}`}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
