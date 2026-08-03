"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity, Send, Workflow, FileText, Inbox, BarChart3, Settings as SettingsIcon,
  RefreshCw, AlertTriangle, CheckCircle2, Plus, Trash2, Clock, MessageCircle, ExternalLink, Save, Eye, Search, ChevronDown, ChevronUp, User,
} from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import TimeframeFilter from "@/components/admin/TimeframeFilter";
import { formatISTDateTime, istTodayYMD, resolveTimeframe, type TimeframeValue } from "@/lib/dates";
import TelegramComposer, {
  emptyComposerValue,
  trimComposerButtons,
  type ComposerValue,
  type PreviewRecipient,
} from "@/components/admin/telegram/TelegramComposer";

// ---- meta / permissions (booleans only — token never reaches the client) ----
interface Meta {
  canInbox: boolean;
  canManage: boolean;
  isSuperAdmin: boolean;
  configured: boolean;
  online: boolean;
  healthy: boolean;
  healthReason: string | null;
  webhookRegistered: boolean;
  webhookUrl: string | null;
  pendingUpdateCount: number | null;
  lastWebhookError: string | null;
  lastWebhookErrorAt: string | null;
  webhookHitsLastHour: number;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  botUsername: string | null;
  botFirstName: string | null;
  botId: number | null;
  hasAvatar: boolean;
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

function parseMeta(d: any): Meta | null {
  if (!d || (d.ok === false && d.canInbox === undefined)) return null;
  const configured = d.configured === true || d.botConfigured === true;
  const pending = typeof d.pendingUpdateCount === "number" ? d.pendingUpdateCount : null;
  const lastWebhookError = typeof d.lastWebhookError === "string" ? d.lastWebhookError : null;
  const online = d.online === true || d.bot?.online === true;
  const healthy =
    d.healthy === true ||
    (configured && online && d.webhookRegistered === true && !lastWebhookError && !(pending && pending > 0));
  return {
    canInbox: !!d.canInbox,
    canManage: !!d.canManage,
    isSuperAdmin: !!d.isSuperAdmin,
    configured,
    online,
    healthy,
    healthReason: typeof d.healthReason === "string" ? d.healthReason : null,
    webhookRegistered: d.webhookRegistered === true,
    webhookUrl: typeof d.webhookUrl === "string" ? d.webhookUrl : null,
    pendingUpdateCount: pending,
    lastWebhookError,
    lastWebhookErrorAt: typeof d.lastWebhookErrorAt === "string" ? d.lastWebhookErrorAt : null,
    webhookHitsLastHour: Number(d.webhookHitsLastHour) || 0,
    lastInboundAt: typeof d.lastInboundAt === "string" ? d.lastInboundAt : null,
    lastOutboundAt: typeof d.lastOutboundAt === "string" ? d.lastOutboundAt : null,
    botUsername: d.botUsername || d.bot?.username || null,
    botFirstName: d.bot?.firstName || null,
    botId: typeof d.bot?.id === "number" ? d.bot.id : null,
    hasAvatar: d.bot?.hasAvatar === true,
  };
}

export default function TelegramMissionControl() {
  const [tab, setTab] = useState<TabId>("overview");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaBusy, setMetaBusy] = useState(false);

  const loadMeta = useCallback((refresh = false) => {
    setMetaBusy(true);
    fetch(`/api/admin/telegram/meta${refresh ? "?refresh=1" : ""}`)
      .then((r) => r.json())
      .then((d) => {
        const m = parseMeta(d);
        if (m) setMeta(m);
      })
      .catch(() => {})
      .finally(() => setMetaBusy(false));
  }, []);

  useEffect(() => { loadMeta(false); }, [loadMeta]);

  const canManage = !!meta?.canManage;
  const canInbox = !!meta?.canInbox;
  const visibleTabs = TABS.filter((t) => {
    if (t.id === "broadcast") return canManage;
    if (t.id === "inbox") return canInbox || canManage;
    return true;
  });

  const statusTone = !meta
    ? null
    : meta.healthy
      ? "green"
      : "amber";

  return (
    <div className="space-y-5 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-extrabold">Telegram Mission Control</h1>
          <p className="text-sm text-muted">Broadcast, automate and reply via Telegram — subscribers, leads and students.</p>
        </div>
        <button type="button" className="btn btn-secondary text-xs" disabled={metaBusy} onClick={() => loadMeta(true)}>
          <RefreshCw size={13} className={metaBusy ? "animate-spin" : ""} /> Refresh status
        </button>
      </div>

      {meta && statusTone && (
        <div
          className={`rounded-xl border p-3 text-sm ${
            statusTone === "green"
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : meta.lastWebhookError || (meta.pendingUpdateCount || 0) > 0
                ? "border-red-200 bg-red-50 text-red-950"
                : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <div className="flex items-start gap-2">
            {statusTone === "green"
              ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-700" />
              : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 pill text-[10px] ${meta.online ? "pill-green" : "pill-red"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.online ? "bg-emerald-600" : "bg-red-600"}`} />
                  {meta.online ? "Online" : "Offline"}
                </span>
                <span className={`pill text-[10px] ${meta.configured ? "pill-green" : "pill-amber"}`}>
                  Token {meta.configured ? "configured" : "missing"}
                </span>
                <span className={`pill text-[10px] ${meta.webhookRegistered ? "pill-green" : "pill-amber"}`}>
                  Webhook {meta.webhookRegistered ? "registered" : "not registered"}
                </span>
                {(meta.pendingUpdateCount || 0) > 0 && (
                  <span className="pill pill-red text-[10px]">{meta.pendingUpdateCount} pending</span>
                )}
                {meta.botUsername && (
                  <span className="pill pill-gray text-[10px]">@{meta.botUsername.replace(/^@/, "")}</span>
                )}
              </div>
              {meta.healthReason && !meta.healthy && (
                <p className="text-xs font-medium">{meta.healthReason}</p>
              )}
              {!meta.configured && (
                <p>
                  <code className="font-mono text-xs">TELEGRAM_BOT_TOKEN</code> is missing on the server.
                </p>
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
              <p className="text-xs text-muted">
                Webhook hits (1h): <span className="font-medium text-ink tabular-nums">{meta.webhookHitsLastHour}</span>
                {" · "}Last inbound: {meta.lastInboundAt ? formatISTDateTime(meta.lastInboundAt) : "—"}
                {" · "}Last outbound: {meta.lastOutboundAt ? formatISTDateTime(meta.lastOutboundAt) : "—"}
              </p>
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

      {tab === "overview" && (
        <OverviewTab
          canManage={canManage}
          onOpenInbox={() => setTab("inbox")}
          onOpenSettings={() => setTab("settings")}
        />
      )}
      {tab === "broadcast" && canManage && <BroadcastTab />}
      {tab === "automations" && <AutomationsTab canEdit={canManage} />}
      {tab === "templates" && <TemplatesTab canEdit={canManage} />}
      {tab === "inbox" && (canInbox || canManage) && <InboxTab />}
      {tab === "analytics" && <AnalyticsTab />}
      {tab === "settings" && <SettingsTab canEdit={canManage} onStatusChange={() => loadMeta(true)} />}
    </div>
  );
}

// ============================ OVERVIEW ============================
function OverviewTab({
  canManage,
  onOpenInbox,
  onOpenSettings,
}: {
  canManage: boolean;
  onOpenInbox: () => void;
  onOpenSettings: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/telegram/overview")
      .then((r) => r.json())
      .then((d) => setData(d?.ok ? d.overview : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingBlock />;
  if (!data) {
    return (
      <div className="card space-y-2 p-6 text-sm">
        <p className="font-medium text-ink">Could not load overview</p>
        <p className="text-muted">Check that you are signed in with Telegram permissions, then refresh.</p>
        <button type="button" className="btn btn-secondary text-xs" onClick={load}><RefreshCw size={13} /> Retry</button>
      </div>
    );
  }

  const bot = data.bot || {};
  const username = bot.username ? `@${String(bot.username).replace(/^@/, "")}` : null;
  const reach = data.reachability || { totalLeads: 0, leadsWithTelegram: 0, percent: 0 };
  const recent = data.recent || { joins: [], sends: [], inbound: [] };

  return (
    <div className="space-y-5">
      {canManage && <ManualDigestCard canEdit={canManage} compact onOpenSettings={onOpenSettings} />}
      <div className="flex items-center gap-2">
        <button onClick={load} className="btn btn-secondary ml-auto text-xs"><RefreshCw size={13} /> Refresh</button>
      </div>

      <div className="card flex flex-wrap items-center gap-4 p-4">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-surface2">
          {bot.hasAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/api/admin/telegram/bot-avatar" alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-lg font-bold text-muted">TG</div>
          )}
          <span className={`absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full border-2 border-white ${data.online ? "bg-emerald-500" : "bg-red-500"}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-lg font-bold text-ink">{bot.firstName || "Telegram bot"}</p>
          <p className="text-sm text-muted">{username || "Username unavailable — open Settings → Re-register webhook after token is set"}</p>
          {bot.id != null && <p className="text-xs text-muted">Bot ID {bot.id}</p>}
        </div>
        {username && (
          <a href={`https://t.me/${username.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="btn btn-secondary text-xs">
            <ExternalLink size={13} /> Open bot
          </a>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Active subscribers" value={data.subscribersActive ?? 0} />
        <Kpi label="Inactive / blocked" value={data.subscribersInactive ?? 0} />
        <Kpi label="Joined last 7 days" value={data.joinedLast7d ?? 0} />
        <Kpi label="Total subscribers" value={data.subscribersTotal ?? 0} />
        <Kpi label="Sent today" value={data.sentToday ?? 0} />
        <Kpi label="Sent last 7 days" value={data.sentLast7d ?? 0} />
        <Kpi label="Failed (7d)" value={data.failedLast7d ?? 0} tone={(data.failedLast7d || 0) > 0 ? "red" : undefined} />
        <Kpi label="Blocked (7d)" value={data.blockedLast7d ?? 0} tone={(data.blockedLast7d || 0) > 0 ? "red" : undefined} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <button type="button" onClick={onOpenInbox} className="card p-4 text-left transition hover:bg-surface2/60">
          <p className="text-xs uppercase tracking-wide text-muted">Inbox awaiting reply</p>
          <p className={`mt-1 font-heading text-2xl font-extrabold tabular-nums ${(data.unreadInbound || 0) > 0 ? "text-danger" : ""}`}>
            {data.unreadInbound ?? 0}
          </p>
          <p className="mt-1 text-xs text-muted">
            {(data.unreadInbound || 0) > 0 ? "Open Inbox to reply" : "No unread messages — share a deep link from Leads to grow subscribers"}
          </p>
        </button>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Lead reachability</p>
          <p className="mt-1 font-heading text-2xl font-extrabold tabular-nums">
            {reach.leadsWithTelegram}/{reach.totalLeads} <span className="text-base font-semibold text-muted">({reach.percent}%)</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            {reach.totalLeads === 0
              ? "No leads yet."
              : "Leads with an active Telegram chat_id. Use “Telegram invite” on a lead to grow this."}
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <RecentList title="Recent joins" empty="No subscribers yet — ask a lead to tap /start on the bot." items={(recent.joins || []).map((j: any) => ({
          key: j.chat_id + j.at,
          primary: j.name || j.chat_id,
          secondary: j.linked_lead_id ? `Lead ${j.linked_lead_id}` : "Unlinked",
          at: j.at,
        }))} />
        <RecentList title="Recent sends" empty="No outbound sends yet — try Settings → Send test, or enable an automation." items={(recent.sends || []).map((s: any) => ({
          key: s.chat_id + s.at + s.status,
          primary: s.status,
          secondary: s.body || s.chat_id,
          at: s.at,
        }))} />
        <RecentList title="Recent inbound" empty="No inbound messages yet — after /start works, plain texts appear here and in Inbox." items={(recent.inbound || []).map((m: any) => ({
          key: m.chat_id + m.at,
          primary: m.body || "(empty)",
          secondary: m.chat_id,
          at: m.at,
        }))} />
      </div>
    </div>
  );
}

function RecentList({ title, empty, items }: {
  title: string;
  empty: string;
  items: { key: string; primary: string; secondary: string; at: string }[];
}) {
  return (
    <div className="card p-0">
      <p className="border-b border-line px-4 py-3 text-sm font-semibold">{title}</p>
      {items.length === 0 ? (
        <p className="p-4 text-xs text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {items.map((it) => (
            <li key={it.key} className="px-4 py-2.5 text-sm">
              <div className="font-medium text-ink truncate">{it.primary}</div>
              <div className="text-xs text-muted truncate">{it.secondary}</div>
              <div className="text-[11px] text-muted tabular-nums">{formatISTDateTime(it.at)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================ BROADCAST ============================
type AnswerAudience = { id: string; label: string; questionKey?: string; optionKey?: string; count?: number };

function BroadcastTab() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [audienceId, setAudienceId] = useState<string>(AUDIENCES[0].id);
  const [answerAudiences, setAnswerAudiences] = useState<AnswerAudience[]>([]);
  const [tf, setTf] = useState<TimeframeValue>({ mode: "30d" });
  const [composer, setComposer] = useState<ComposerValue>(() => emptyComposerValue());
  const [scheduledAt, setScheduledAt] = useState("");
  const [audienceMeta, setAudienceMeta] = useState<{
    audienceSize?: number;
    reachableCount?: number;
    skippedNoTelegram?: number;
  } | null>(null);
  const [previewRecipients, setPreviewRecipients] = useState<PreviewRecipient[]>([]);
  const [missingVars, setMissingVars] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, any>>({});

  // Direct send
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<{ chatId: string; label: string; phone?: string }[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [directPick, setDirectPick] = useState<{ chatId: string; label: string } | null>(null);
  const [directComposer, setDirectComposer] = useState<ComposerValue>(() => emptyComposerValue());

  function setThisYear() {
    const y = istTodayYMD().slice(0, 4);
    setTf({ mode: "range", from: `${y}-01-01`, to: istTodayYMD() });
  }

  const loadBroadcasts = useCallback(() => {
    fetch("/api/admin/telegram/broadcast")
      .then((r) => r.json())
      .then((d) => setBroadcasts(Array.isArray(d?.broadcasts) ? d.broadcasts : []))
      .catch(() => setBroadcasts([]));
  }, []);

  useEffect(() => {
    loadBroadcasts();
    fetch("/api/admin/telegram/analytics")
      .then((r) => r.json())
      .then((d) => {
        const raw = d?.answers || d?.answerAudiences || d?.analytics?.answers || [];
        if (!Array.isArray(raw)) return;
        setAnswerAudiences(
          raw.map((a: any) => ({
            id: a.id || `answer:${a.questionKey || a.question_key}:${a.optionKey || a.option_key}`,
            label:
              a.label ||
              `Answered ${a.questionKey || a.question_key} → ${a.optionLabel || a.option_label || a.optionKey || a.option_key}`,
            questionKey: a.questionKey || a.question_key,
            optionKey: a.optionKey || a.option_key,
            count: a.count,
          })),
        );
      })
      .catch(() => {});
  }, [loadBroadcasts]);

  async function loadAudience() {
    const needsBody = composer.kind !== "poll";
    if (needsBody && !composer.body.trim()) {
      toast("Message body required", "error");
      return;
    }
    if (composer.kind === "poll") {
      const opts = (composer.poll?.options || []).filter((o) => o.trim());
      if (!composer.poll?.question?.trim() || opts.length < 2) {
        toast("Poll needs a question and at least 2 options", "error");
        return;
      }
    }
    setBusy(true);
    setMissingVars([]);
    const { fromMs, toMs } = resolveTimeframe(tf);
    const qs = new URLSearchParams({
      audienceId,
      fromMs: String(Number.isFinite(fromMs) ? fromMs : 0),
      toMs: String(Number.isFinite(toMs) ? toMs : Date.now() + 86400000),
    });
    const d = await fetch(`/api/admin/telegram/audience?${qs}`).then((r) => r.json()).catch(() => null);

    const sample = Array.isArray(d?.reachable)
      ? d.reachable.slice(0, 12).map((r: any) => ({
          chatId: String(r.chat_id || r.chatId || ""),
          label: r.name || r.first_name || r.phone || String(r.chat_id || r.chatId || "recipient"),
        })).filter((r: PreviewRecipient) => r.chatId)
      : [];
    setPreviewRecipients(sample);

    // Missing-var warning from preview API (same path as send)
    const preview = await fetch("/api/admin/telegram/broadcast/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: composer.body,
        fallbacks: composer.fallbacks,
        imageUrl: composer.imageUrl.trim() || null,
        chatId: sample[0]?.chatId,
        kind: composer.kind,
        audienceId,
      }),
    }).then((r) => r.json()).catch(() => null);
    if (Array.isArray(preview?.missingVars) || Array.isArray(preview?.missing)) {
      setMissingVars(preview.missingVars || preview.missing || []);
    }

    setBusy(false);
    if (d?.ok || d?.audienceSize !== undefined) {
      setAudienceMeta({
        audienceSize: d.audienceSize,
        reachableCount: d.reachableCount,
        skippedNoTelegram: d.skippedNoTelegram,
      });
    } else {
      toast(d?.error || "Could not load audience", "error");
    }
  }

  function buildBroadcastPayload(schedule: boolean) {
    const { fromMs, toMs } = resolveTimeframe(tf);
    const payload: Record<string, unknown> = {
      audienceId,
      fromMs: Number.isFinite(fromMs) ? fromMs : 0,
      toMs: Number.isFinite(toMs) ? toMs : Date.now() + 86400000,
      body: composer.body.trim(),
      imageUrl: composer.imageUrl.trim() || undefined,
      image: composer.imageUrl.trim() || undefined,
      buttons: trimComposerButtons(composer.buttons, composer.kind),
      name: name.trim() || undefined,
      fallbacks: composer.fallbacks,
      templateId: composer.templateId,
      kind: composer.kind,
      poll:
        composer.kind === "poll" && composer.poll
          ? {
              question: composer.poll.question,
              options: composer.poll.options,
              is_anonymous: composer.poll.is_anonymous,
              allows_multiple: composer.poll.allows_multiple,
              allows_multiple_answers: composer.poll.allows_multiple,
            }
          : null,
      questionKey: composer.kind === "question" ? composer.questionKey : undefined,
      leadField: composer.kind === "question" ? composer.leadField || undefined : undefined,
    };
    if (schedule && scheduledAt) payload.scheduledAt = new Date(scheduledAt).toISOString();
    return payload;
  }

  async function send(schedule: boolean) {
    if (composer.kind !== "poll" && !composer.body.trim()) {
      toast("Message body required", "error");
      return;
    }
    setBusy(true);
    const d = await fetch("/api/admin/telegram/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBroadcastPayload(schedule)),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (d?.ok) {
      toast(schedule ? "Broadcast scheduled." : "Broadcast queued.", "success");
      setAudienceMeta(null);
      loadBroadcasts();
    } else {
      toast(d?.error || "Send failed", "error");
    }
  }

  async function searchRecipients() {
    const q = searchQ.trim();
    if (!q) return;
    setSearchBusy(true);
    const d = await fetch(`/api/admin/telegram/recipients/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .catch(() => null);
    setSearchBusy(false);
    if (!d?.ok) {
      toast(d?.error || "Recipient search unavailable", "error");
      setSearchHits([]);
      return;
    }
    const hits = Array.isArray(d.recipients || d.results || d.hits)
      ? (d.recipients || d.results || d.hits)
      : [];
    setSearchHits(
      hits.map((h: any) => ({
        chatId: String(h.chat_id || h.chatId || ""),
        label: h.name || h.first_name || h.username || h.phone || String(h.chat_id || h.chatId),
        phone: h.phone,
      })).filter((h: { chatId: string }) => h.chatId),
    );
  }

  async function sendDirect() {
    if (!directPick) { toast("Pick a recipient", "error"); return; }
    if (directComposer.kind !== "poll" && !directComposer.body.trim()) {
      toast("Message body required", "error");
      return;
    }
    setBusy(true);
    const d = await fetch("/api/admin/telegram/broadcast/direct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: directPick.chatId,
        body: directComposer.body.trim(),
        imageUrl: directComposer.imageUrl.trim() || undefined,
        buttons: trimComposerButtons(directComposer.buttons, directComposer.kind),
        fallbacks: directComposer.fallbacks,
        kind: directComposer.kind,
        poll:
          directComposer.kind === "poll" && directComposer.poll
            ? {
                ...directComposer.poll,
                allows_multiple_answers: directComposer.poll.allows_multiple,
              }
            : null,
        questionKey: directComposer.questionKey,
        leadField: directComposer.leadField,
        templateId: directComposer.templateId,
      }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    toast(d?.ok ? "Sent to individual." : (d?.error || "Direct send failed"), d?.ok ? "success" : "error");
    if (d?.ok) loadBroadcasts();
  }

  async function toggleDetail(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (detail[id]) return;
    const d = await fetch(`/api/admin/telegram/broadcast?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .catch(() => null);
    if (d?.ok && (d.broadcast || d.detail)) {
      setDetail((prev) => ({ ...prev, [id]: d.broadcast || d.detail }));
    } else {
      const row = broadcasts.find((b) => b.id === id);
      setDetail((prev) => ({ ...prev, [id]: row || { error: d?.error || "Detail unavailable" } }));
    }
  }

  const audienceDef =
    AUDIENCES.find((a) => a.id === audienceId)?.definition ||
    answerAudiences.find((a) => a.id === audienceId)?.label ||
    "";

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <p className="text-sm font-semibold">Broadcast</p>
        <Field label="Campaign name (optional)">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Seat booking nudge — Mar" />
        </Field>
        <Field label="Audience">
          <select
            className="input"
            value={audienceId}
            onChange={(e) => {
              setAudienceId(e.target.value);
              setAudienceMeta(null);
            }}
          >
            <optgroup label="Phone audiences">
              {AUDIENCES.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </optgroup>
            {answerAudiences.length > 0 && (
              <optgroup label="Answer audiences">
                {answerAudiences.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}{a.count != null ? ` (${a.count})` : ""}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {audienceDef && <p className="mt-1 text-xs text-muted">{audienceDef}</p>}
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Timeframe</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <TimeframeFilter
              value={tf}
              onChange={(v) => {
                setTf(v);
                setAudienceMeta(null);
              }}
              modes={TF_MODES}
              size="sm"
            />
            <button
              type="button"
              onClick={setThisYear}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                tf.mode === "range" && tf.from?.endsWith("-01-01") && tf.from?.startsWith(istTodayYMD().slice(0, 4))
                  ? "bg-primary text-white"
                  : "bg-surface2 text-ink2 hover:bg-surface"
              }`}
            >
              This year
            </button>
          </div>
        </div>

        <TelegramComposer
          value={composer}
          onChange={setComposer}
          mode="broadcast"
          recipients={previewRecipients}
          onRequestRecipients={() => void loadAudience()}
        />

        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <button type="button" onClick={() => void loadAudience()} disabled={busy} className="btn btn-primary">
            <Eye size={14} /> {busy ? "…" : "Preview audience"}
          </button>
        </div>
      </div>

      {audienceMeta && (
        <div className="card space-y-3 p-4">
          <p className="text-sm font-semibold">Audience size vs reachable</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Audience size" value={audienceMeta.audienceSize ?? "—"} />
            <Kpi label="Reachable (Telegram)" value={audienceMeta.reachableCount ?? "—"} />
            <Kpi label="Skipped (no TG)" value={audienceMeta.skippedNoTelegram ?? "—"} />
          </div>
          {missingVars.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle size={12} className="mr-1 inline" />
              Some recipients are missing: <strong>{missingVars.join(", ")}</strong>. Fallbacks will be used.
            </div>
          )}
          <Field label="Schedule (optional, local time)">
            <input type="datetime-local" className="input" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void send(false)} disabled={busy} className="btn btn-primary">
              <Send size={14} /> {busy ? "…" : "Send now"}
            </button>
            <button type="button" onClick={() => void send(true)} disabled={busy || !scheduledAt} className="btn btn-secondary">
              <Clock size={14} /> Schedule
            </button>
          </div>
        </div>
      )}

      <div className="card space-y-3 p-4">
        <p className="text-sm font-semibold">Send to individual</p>
        <p className="text-xs text-muted">Search reachable subscribers / linked leads, then send a one-off message.</p>
        <div className="flex flex-wrap gap-2">
          <input
            className="input min-w-[12rem] flex-1"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void searchRecipients(); }}
            placeholder="Name, phone, username, chat id…"
          />
          <button type="button" className="btn btn-secondary text-xs" disabled={searchBusy} onClick={() => void searchRecipients()}>
            <Search size={13} /> {searchBusy ? "…" : "Search"}
          </button>
        </div>
        {searchHits.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {searchHits.map((h) => (
              <li key={h.chatId}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface2 ${
                    directPick?.chatId === h.chatId ? "bg-primary/5" : ""
                  }`}
                  onClick={() => setDirectPick({ chatId: h.chatId, label: h.label })}
                >
                  <User size={14} className="text-muted" />
                  <span className="font-medium">{h.label}</span>
                  <span className="ml-auto font-mono text-[11px] text-muted">{h.chatId}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {directPick && (
          <>
            <p className="text-xs text-muted">
              To: <strong className="text-ink">{directPick.label}</strong>{" "}
              <span className="font-mono">({directPick.chatId})</span>
            </p>
            <TelegramComposer
              value={directComposer}
              onChange={setDirectComposer}
              mode="direct"
              recipients={[{ chatId: directPick.chatId, label: directPick.label }]}
            />
            <button type="button" className="btn btn-primary text-xs" disabled={busy} onClick={() => void sendDirect()}>
              <Send size={13} /> Send to individual
            </button>
          </>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <p className="text-sm font-semibold">Recent broadcasts</p>
          <button type="button" className="btn btn-secondary ml-auto text-xs" onClick={loadBroadcasts}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        {broadcasts.length === 0 ? (
          <p className="p-4 text-sm text-muted">
            No broadcasts yet. Compose a message above, preview the audience, then Send now.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {broadcasts.map((b) => {
              const open = expandedId === b.id;
              const d = detail[b.id] || b;
              return (
                <li key={b.id} className="text-sm">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-surface2/50"
                    onClick={() => void toggleDetail(b.id)}
                  >
                    <span className={`pill text-[10px] ${b.status === "done" ? "pill-green" : b.status === "failed" ? "pill-red" : "pill-gray"}`}>
                      {b.status || "—"}
                    </span>
                    <span className="font-medium text-ink">{b.name || b.id?.slice(0, 8)}</span>
                    <span className="text-xs text-muted">{b.audience_id}</span>
                    <span className="ml-auto text-[11px] tabular-nums text-muted">
                      {b.created_at ? formatISTDateTime(b.created_at) : ""}
                    </span>
                    {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {open && (
                    <div className="space-y-2 border-t border-line/60 bg-surface2/40 px-4 py-3 text-xs">
                      <div className="flex flex-wrap gap-3">
                        <span>Sent: <strong className="tabular-nums">{d.sent_count ?? b.sent_count ?? 0}</strong></span>
                        <span>Failed: <strong className="tabular-nums">{d.failed_count ?? b.failed_count ?? 0}</strong></span>
                        <span>Blocked: <strong className="tabular-nums">{d.blocked_count ?? b.blocked_count ?? 0}</strong></span>
                        <span>Skipped: <strong className="tabular-nums">{d.skipped_count ?? b.skipped_count ?? 0}</strong></span>
                        <span>Reachable: <strong className="tabular-nums">{d.reachable_count ?? b.reachable_count ?? "—"}</strong></span>
                      </div>
                      {(d.kind || b.kind) && <p>Kind: {d.kind || b.kind}</p>}
                      {(d.poll_results || d.pollResults) && (
                        <div>
                          <p className="font-semibold">Poll results</p>
                          <pre className="mt-1 overflow-x-auto rounded-lg bg-ink/5 p-2 text-[11px]">
                            {JSON.stringify(d.poll_results || d.pollResults, null, 2)}
                          </pre>
                        </div>
                      )}
                      {(d.message_body || b.message_body) && (
                        <p className="line-clamp-4 whitespace-pre-wrap text-ink2">{d.message_body || b.message_body}</p>
                      )}
                      {d.error && <p className="text-danger">{d.error}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
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
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    Promise.all([
      fetch("/api/admin/telegram/analytics").then((r) => r.json()).catch(() => null),
      fetch("/api/admin/telegram/broadcast").then((r) => r.json()).catch(() => null),
    ])
      .then(([a, b]) => {
        if (!a || a.ok === false) {
          setData(null);
          setErr(a?.error || "Could not load analytics");
        } else {
          setData(a);
        }
        setBroadcasts(Array.isArray(b?.broadcasts) ? b.broadcasts : []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingBlock />;
  if (!data) {
    return (
      <div className="card space-y-2 p-6 text-sm">
        <p className="font-medium text-ink">No analytics yet</p>
        <p className="text-muted">
          {err || "Once the bot is online and you send a broadcast or receive a /start, KPIs appear here."}
        </p>
        <p className="text-xs text-muted">Next: open Settings → confirm webhook → share a deep link from Leads → send a test broadcast.</p>
        <button type="button" className="btn btn-secondary text-xs" onClick={load}><RefreshCw size={13} /> Retry</button>
      </div>
    );
  }

  const overview = data.overview || data.outbound || data.stats || {};
  const outbound = data.outbound || {
    sentToday: overview.sentToday,
    sentLast7d: overview.sentLast7d,
    failedLast7d: overview.failedLast7d,
    blockedLast7d: overview.blockedLast7d,
    queued: overview.queued ?? overview.queue?.queued,
  };
  const inbound = data.inbound || {
    unread: overview.unreadInbound ?? overview.unread,
    lastInboundAt: overview.lastInboundAt,
    recent: overview.recent?.inbound || [],
  };
  const growth =
    data.subscribersGrowth ||
    data.subscriberGrowth ||
    overview.recent?.joins ||
    [];
  const reachability: any[] = Array.isArray(data.reachability) ? data.reachability : [];
  const recentBroadcasts: any[] =
    Array.isArray(data.recentBroadcasts) && data.recentBroadcasts.length
      ? data.recentBroadcasts
      : broadcasts;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-secondary ml-auto text-xs" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <section className="space-y-2">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted">Outbound</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Sent today" value={outbound.sentToday ?? 0} />
          <Kpi label="Sent last 7 days" value={outbound.sentLast7d ?? 0} />
          <Kpi label="Failed (7d)" value={outbound.failedLast7d ?? 0} tone={(outbound.failedLast7d || 0) > 0 ? "red" : undefined} />
          <Kpi label="Blocked (7d)" value={outbound.blockedLast7d ?? 0} tone={(outbound.blockedLast7d || 0) > 0 ? "red" : undefined} />
          <Kpi label="Queued" value={outbound.queued ?? 0} />
        </div>
        {(outbound.sentToday == null && outbound.sentLast7d == null) && (
          <p className="text-xs text-muted">No outbound traffic yet — queue a broadcast from the Broadcast tab.</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted">Inbound</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Kpi label="Unread inbox" value={inbound.unread ?? 0} tone={(inbound.unread || 0) > 0 ? "red" : undefined} />
          <div className="card p-4 sm:col-span-2">
            <p className="text-xs uppercase tracking-wide text-muted">Recent inbound</p>
            {!Array.isArray(inbound.recent) || inbound.recent.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                No inbound messages yet. After subscribers tap /start, replies show here and in Inbox.
              </p>
            ) : (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
                {inbound.recent.slice(0, 8).map((m: any, i: number) => (
                  <li key={i} className="flex justify-between gap-2 border-b border-line/50 py-1.5 last:border-0">
                    <span className="truncate text-ink">{m.body || "(empty)"}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">
                      {m.at ? formatISTDateTime(m.at) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted">Subscribers growth</h2>
        <div className="card overflow-hidden">
          {!Array.isArray(growth) || growth.length === 0 ? (
            <p className="p-4 text-sm text-muted">
              No joins recorded. Next: copy a Telegram invite deep link from a lead profile and ask them to open the bot.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {growth.slice(0, 20).map((j: any, i: number) => (
                <li key={j.chat_id + (j.at || i)} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                  <span className="font-medium text-ink">{j.name || j.first_name || j.chat_id}</span>
                  <span className="text-xs text-muted">
                    {j.linked_lead_id ? `Lead ${j.linked_lead_id}` : "Unlinked"}
                  </span>
                  <span className="ml-auto text-[11px] tabular-nums text-muted">
                    {j.at ? formatISTDateTime(j.at) : j.subscribed_at ? formatISTDateTime(j.subscribed_at) : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted">Reachability by audience</h2>
        {reachability.length === 0 ? (
          <p className="card p-4 text-sm text-muted">
            Reachability not available yet. Ensure phone audiences resolve and subscribers are linked by phone.
          </p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Audience</th>
                  <th className="px-4 py-2 font-medium tabular-nums">Size</th>
                  <th className="px-4 py-2 font-medium tabular-nums">Reachable</th>
                  <th className="px-4 py-2 font-medium tabular-nums">No TG</th>
                  <th className="px-4 py-2 font-medium tabular-nums">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {reachability.map((r) => {
                  const size = Number(r.audienceSize ?? 0);
                  const reachable = Number(r.reachable ?? r.reachableCount ?? 0);
                  const pct = size > 0 ? Math.round((reachable / size) * 1000) / 10 : 0;
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2 font-medium text-ink">{r.label || r.id}</td>
                      <td className="px-4 py-2 tabular-nums">{size}</td>
                      <td className="px-4 py-2 tabular-nums">{reachable}</td>
                      <td className="px-4 py-2 tabular-nums">{r.skippedNoTelegram ?? "—"}</td>
                      <td className="px-4 py-2 tabular-nums text-muted">{pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted">Recent broadcasts</h2>
        <div className="card overflow-hidden">
          {recentBroadcasts.length === 0 ? (
            <p className="p-4 text-sm text-muted">
              No broadcasts yet. Open Broadcast → compose → preview audience → Send now.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Audience</th>
                    <th className="px-4 py-2 font-medium tabular-nums">Sent</th>
                    <th className="px-4 py-2 font-medium tabular-nums">Failed</th>
                    <th className="px-4 py-2 font-medium tabular-nums">Blocked</th>
                    <th className="px-4 py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {recentBroadcasts.slice(0, 25).map((b: any) => (
                    <tr key={b.id}>
                      <td className="px-4 py-2 font-medium text-ink">{b.name || b.id?.slice(0, 8)}</td>
                      <td className="px-4 py-2">
                        <span className={`pill text-[10px] ${b.status === "done" ? "pill-green" : "pill-gray"}`}>
                          {b.status || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted">{b.audience_id}</td>
                      <td className="px-4 py-2 tabular-nums">{b.sent_count ?? 0}</td>
                      <td className="px-4 py-2 tabular-nums">{b.failed_count ?? 0}</td>
                      <td className="px-4 py-2 tabular-nums">{b.blocked_count ?? 0}</td>
                      <td className="px-4 py-2 text-[11px] tabular-nums text-muted">
                        {b.created_at ? formatISTDateTime(b.created_at) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ============================ SETTINGS ============================
// ============================ MANUAL CEO DIGEST ============================
function ManualDigestCard({
  canEdit,
  compact,
  onOpenSettings,
}: {
  canEdit: boolean;
  compact?: boolean;
  onOpenSettings?: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [lastDigestAt, setLastDigestAt] = useState<string | null>(null);
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [frequency, setFrequency] = useState("2h");
  const [channelLabel, setChannelLabel] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{
    channelTitle?: string | null;
    channelMasked?: string | null;
  } | null>(null);

  useEffect(() => {
    fetch("/api/admin/telegram/reports")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.ok || !d.settings) return;
        setLastDigestAt(d.settings.last_digest_at || null);
        setDigestEnabled(d.settings.digest_enabled !== false);
        setFrequency(d.settings.digest_frequency || "2h");
        setChannelLabel(d.settings.channel_id ? String(d.settings.channel_id) : null);
      })
      .catch(() => {});
  }, []);

  async function generatePreview() {
    if (!canEdit) return;
    setBusy("preview");
    try {
      const res = await fetch("/api/admin/telegram/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview_digest" }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok || !data.html) {
        toast(data.reason || data.error || "Could not generate digest", "error");
        return;
      }
      setPreviewHtml(String(data.html));
      setPreviewMeta({
        channelTitle: data.channelTitle || null,
        channelMasked: data.channelMasked || null,
      });
      if (data.lastDigestAt) setLastDigestAt(data.lastDigestAt);
      toast("Digest generated — review below, then send", "success");
    } catch {
      toast("Could not generate digest", "error");
    } finally {
      setBusy(null);
    }
  }

  async function sendToTelegram() {
    if (!canEdit) return;
    if (!previewHtml) {
      toast("Generate a digest preview first", "error");
      return;
    }
    setBusy("send");
    try {
      const res = await fetch("/api/admin/telegram/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_digest_now", html: previewHtml }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok) {
        toast(data.reason || data.error || "Send failed", "error");
        return;
      }
      toast(
        data.messageId
          ? `Digest sent to Telegram (message ${data.messageId})`
          : "Digest sent to Telegram",
        "success",
      );
      setLastDigestAt(new Date().toISOString());
    } catch {
      toast("Send failed", "error");
    } finally {
      setBusy(null);
    }
  }

  const previewDisplay = previewHtml
    ? previewHtml.replace(/\n/g, "<br/>")
    : null;

  return (
    <div className="card space-y-3 border-primary/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">CEO digest</p>
          <p className="text-xs text-muted">
            Generate the live digests report, preview it here, then send to the reports channel.
            {compact ? " Full controls also live under Settings." : ""}
          </p>
        </div>
        {compact && onOpenSettings && (
          <button type="button" className="btn btn-secondary text-xs" onClick={onOpenSettings}>
            Settings
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>Schedule: {digestEnabled ? `on · every ${frequency}` : "off"}</span>
        <span>
          Last sent:{" "}
          {lastDigestAt
            ? formatISTDateTime(lastDigestAt)
            : "—"}
        </span>
        {(previewMeta?.channelTitle || previewMeta?.channelMasked || channelLabel) && (
          <span>
            Channel:{" "}
            {previewMeta?.channelTitle ||
              previewMeta?.channelMasked ||
              channelLabel}
          </span>
        )}
      </div>

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary text-sm"
            disabled={!!busy}
            onClick={() => void generatePreview()}
          >
            <Eye size={14} />
            {busy === "preview" ? "Generating…" : previewHtml ? "Regenerate digest" : "Generate digest"}
          </button>
          <button
            type="button"
            className="btn btn-primary text-sm"
            disabled={!!busy || !previewHtml}
            onClick={() => void sendToTelegram()}
          >
            <Send size={14} />
            {busy === "send" ? "Sending…" : "Send to Telegram"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted">You need manage permission to generate or send digests.</p>
      )}

      {previewHtml && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
          <div className="rounded-2xl bg-[#e7f0f8] p-4">
            <div
              className="max-w-xl rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm leading-relaxed text-ink shadow-sm [&_b]:font-bold [&_i]:italic [&_u]:underline"
              // Trusted HTML from our own buildDigest (escaped content + fixed tags).
              dangerouslySetInnerHTML={{ __html: previewDisplay || "" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsTab({ canEdit, onStatusChange }: { canEdit: boolean; onStatusChange?: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bot, setBot] = useState<any>(null);
  const [webhook, setWebhook] = useState<any>(null);
  const [welcome, setWelcome] = useState("");
  const [welcomeImage, setWelcomeImage] = useState("");
  const [buttons, setButtons] = useState<InlineBtn[]>(emptyButtons());
  const [unknownCmd, setUnknownCmd] = useState("");
  const [ackOn, setAckOn] = useState(true);
  const [ackBody, setAckBody] = useState("");
  const [testChatId, setTestChatId] = useState("");
  const [reregisterResult, setReregisterResult] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/telegram/settings")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.ok) return;
        const s = d.settings || {};
        setBot(d.bot || null);
        setWebhook(d.webhook || null);
        setWelcome(s.welcome_body || "");
        setWelcomeImage(s.welcome_image_url || "");
        setButtons(padButtons(s.welcome_buttons));
        setUnknownCmd(s.unknown_command_reply || "");
        setAckOn(s.first_inbound_ack_enabled !== false);
        setAckBody(s.first_inbound_ack_body || "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!canEdit) return;
    const trimmed = trimButtons(buttons);
    for (const b of trimmed) {
      try {
        const u = new URL(b.url);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad");
      } catch {
        toast(`Invalid button URL: ${b.url}`, "error");
        return;
      }
    }
    setBusy(true);
    const d = await fetch("/api/admin/telegram/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        welcome_body: welcome,
        welcome_image_url: welcomeImage.trim() || null,
        welcome_buttons: trimmed,
        unknown_command_reply: unknownCmd,
        first_inbound_ack_enabled: ackOn,
        first_inbound_ack_body: ackBody,
      }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    toast(d?.ok ? "Settings saved — live immediately." : (d?.error || "Save failed"), d?.ok ? "success" : "error");
    if (d?.ok) load();
  }

  async function reregister() {
    if (!canEdit) return;
    setBusy(true);
    setReregisterResult(null);
    const d = await fetch("/api/admin/telegram/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reregister_webhook" }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    setReregisterResult(JSON.stringify(d, null, 2));
    toast(d?.ok ? "Webhook re-registered." : (d?.error || d?.description || "setWebhook failed"), d?.ok ? "success" : "error");
    onStatusChange?.();
    load();
  }

  async function sendTest() {
    if (!canEdit) return;
    if (!testChatId.trim()) { toast("Enter a chat_id", "error"); return; }
    setBusy(true);
    const d = await fetch("/api/admin/telegram/test-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: testChatId.trim(),
        body: welcome,
        buttons: trimButtons(buttons),
        image_url: welcomeImage.trim() || undefined,
        vars: { first_name: "Priya", name: "Priya" },
      }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    toast(
      d?.ok ? `Test sent (message_id ${d.telegram_message_id ?? "ok"}).` : (d?.error || "Test send failed"),
      d?.ok ? "success" : "error",
    );
  }

  if (loading) return <LoadingBlock />;

  const username = bot?.username ? `@${String(bot.username).replace(/^@/, "")}` : null;
  const previewButtons = trimButtons(buttons);
  const previewText = welcome
    .replace(/\{\{\s*first_name\s*\}\}/gi, "Priya")
    .replace(/\{\{\s*name\s*\}\}/gi, "Priya");

  return (
    <div className="space-y-4">
      <ManualDigestCard canEdit={canEdit} />

      <div className="card space-y-3 p-4">
        <p className="text-sm font-semibold">Bot connection</p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-surface2">
            {bot?.hasAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/api/admin/telegram/bot-avatar" alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-bold text-muted">TG</div>
            )}
            <span className={`absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full border-2 border-white ${bot?.online ? "bg-emerald-500" : "bg-red-500"}`} />
          </div>
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <Row label="Display name" value={bot?.firstName || "Unavailable — getMe failed"} />
            <Row label="Username" value={username || "Unavailable"} />
            <Row label="Bot ID" value={bot?.id != null ? String(bot.id) : "Unavailable"} />
            <Row label="Status" value={bot?.online ? "Online" : (bot?.error || "Offline")} />
            <Row label="Webhook URL" value={webhook?.webhookUrl || "Not registered"} />
            <Row label="Last webhook error" value={webhook?.lastErrorMessage || "None"} />
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary text-sm" disabled={busy} onClick={reregister}>
              Re-register webhook
            </button>
          </div>
        )}
        {reregisterResult && (
          <pre className="overflow-x-auto rounded-lg bg-ink/5 p-3 text-xs text-ink2">{reregisterResult}</pre>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 p-4">
          <p className="text-sm font-semibold">Welcome message</p>
          <p className="text-xs text-muted">Sent on every /start. Supports {"{{name}}"} and {"{{first_name}}"}.</p>
          <textarea
            className="input min-h-[140px]"
            value={welcome}
            disabled={!canEdit}
            onChange={(e) => setWelcome(e.target.value)}
            placeholder="Welcome…"
          />
          <Field label="Optional image URL (shown above welcome text)">
            <input className="input" value={welcomeImage} disabled={!canEdit} onChange={(e) => setWelcomeImage(e.target.value)} placeholder="https://…" />
          </Field>
          <WelcomeButtonsEditor buttons={buttons} onChange={setButtons} disabled={!canEdit} />
          {canEdit ? (
            <button type="button" onClick={save} disabled={busy} className="btn btn-primary text-sm">
              <Save size={14} /> {busy ? "…" : "Save welcome settings"}
            </button>
          ) : (
            <p className="text-xs text-muted">You need manage permission to edit settings.</p>
          )}
        </div>

        <div className="space-y-4">
          <div className="card space-y-3 p-4">
            <p className="text-sm font-semibold">Live preview</p>
            <div className="rounded-2xl bg-[#e7f0f8] p-4">
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm shadow-sm">
                {welcomeImage.trim() && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={welcomeImage.trim()} alt="" className="mb-2 max-h-32 w-full rounded-lg object-cover" />
                )}
                <p className="whitespace-pre-wrap text-ink">{previewText || "Welcome message…"}</p>
                {previewButtons.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {previewButtons.map((b, i) => (
                      <div key={i} className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5 text-center text-xs font-medium text-sky-800">
                        {b.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Test chat_id">
                  <input className="input" value={testChatId} onChange={(e) => setTestChatId(e.target.value)} placeholder="e.g. 123456789" />
                </Field>
                <button type="button" className="btn btn-secondary text-sm" disabled={busy} onClick={sendTest}>
                  Send test to my chat_id
                </button>
              </div>
            )}
          </div>

          <div className="card space-y-3 p-4">
            <p className="text-sm font-semibold">Auto-replies</p>
            <Field label="Unrecognised command reply">
              <textarea className="input min-h-[80px]" value={unknownCmd} disabled={!canEdit} onChange={(e) => setUnknownCmd(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ackOn} disabled={!canEdit} onChange={(e) => setAckOn(e.target.checked)} />
              First-inbound acknowledgement (once per conversation)
            </label>
            <Field label="Acknowledgement text">
              <textarea className="input min-h-[80px]" value={ackBody} disabled={!canEdit || !ackOn} onChange={(e) => setAckBody(e.target.value)} />
            </Field>
            {canEdit && (
              <button type="button" onClick={save} disabled={busy} className="btn btn-primary text-sm">Save auto-replies</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WelcomeButtonsEditor({
  buttons, onChange, disabled,
}: { buttons: InlineBtn[]; onChange: (b: InlineBtn[]) => void; disabled?: boolean }) {
  const filled = buttons.filter((b) => b.label.trim() || b.url.trim());
  function update(i: number, patch: Partial<InlineBtn>) {
    const next = padButtons(buttons);
    next[i] = { ...next[i]!, ...patch };
    onChange(next);
  }
  function move(i: number, dir: -1 | 1) {
    const next = padButtons(buttons);
    const j = i + dir;
    if (j < 0 || j >= 3) return;
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
    onChange(next);
  }
  function remove(i: number) {
    const next = padButtons(buttons);
    next[i] = { label: "", url: "" };
    onChange(next);
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted">Inline buttons (up to 3) — shown after /start</p>
      {buttons.map((b, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input className="input min-w-[8rem] flex-1" placeholder={`Button ${i + 1} label`} value={b.label} disabled={disabled}
            onChange={(e) => update(i, { label: e.target.value })} />
          <input className="input min-w-[12rem] flex-[2]" placeholder="https://…" value={b.url} disabled={disabled}
            onChange={(e) => update(i, { url: e.target.value })} />
          {!disabled && (
            <div className="flex gap-1">
              <button type="button" className="btn btn-secondary px-2 text-xs" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button type="button" className="btn btn-secondary px-2 text-xs" onClick={() => move(i, 1)} disabled={i === 2}>↓</button>
              <button type="button" className="btn btn-secondary px-2 text-xs" onClick={() => remove(i)} disabled={!b.label && !b.url}><Trash2 size={12} /></button>
            </div>
          )}
        </div>
      ))}
      <p className="text-[11px] text-muted">{filled.length}/3 buttons configured</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <span className="text-ink2">{label}</span>
      <span className="max-w-full break-all text-right font-medium text-ink">{value}</span>
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
