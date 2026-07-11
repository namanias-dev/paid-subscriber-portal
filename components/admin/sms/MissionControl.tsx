"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Activity, Send, Workflow, FileText, ScrollText, BarChart3, Settings as SettingsIcon, RefreshCw, Download, AlertTriangle, CheckCircle2, Power, Braces, Link2, RotateCcw, Users, Search, SlidersHorizontal, Bookmark, Save, Trash2, History, Clock, ChevronDown, Plus, ShieldCheck } from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import TimeframeFilter from "@/components/admin/TimeframeFilter";
import { formatISTDateTime, TIMEFRAME_LABELS, type TimeframeValue } from "@/lib/dates";

// Recharts is heavy and only shown inside the Overview/Analytics tabs — lazy-load
// the chart bodies so Recharts stays out of the initial Mission Control bundle.
const ChartSkeleton = () => <div className="h-[220px] w-full animate-shimmer rounded-xl bg-surface2" />;
const SmsTrend24h = dynamic(() => import("@/components/admin/sms/SmsCharts").then((m) => m.SmsTrend24h), { ssr: false, loading: ChartSkeleton });
const SmsSendsOverTime = dynamic(() => import("@/components/admin/sms/SmsCharts").then((m) => m.SmsSendsOverTime), { ssr: false, loading: ChartSkeleton });

// ---- shared types (mirror API responses) ----
interface TemplateRow {
  id: string; name: string; use_case: string; message_type: string; status: string;
  is_active: boolean; gateway_template_id: string | null; body_template: string; variables: string[];
  trigger_event: string | null; audience_type: string | null;
  sender_id?: string; route?: string;
  worstCaseChars: number; worstCaseSegments: number; over155: boolean; bodyErrors: string[];
  /** true = self-serve (staff-added); false = built-in code seed. */
  custom?: boolean;
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
interface Meta {
  isSuperAdmin: boolean;
  webinars: { id: string; slug: string; title: string; datetime: string }[];
  courses: { id: string; slug: string; title: string; price: number }[];
  leadSources: string[]; leadStages: string[];
}

const TABS = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "send", label: "Send SMS", icon: Send },
  { id: "campaigns", label: "Campaigns", icon: History },
  { id: "automations", label: "Automations", icon: Workflow },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "variables", label: "Variables", icon: Braces },
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
      {tab === "campaigns" && <CampaignsTab canResend={!!meta?.isSuperAdmin} />}
      {tab === "automations" && <AutomationsTab canEdit={!!meta?.isSuperAdmin} />}
      {tab === "templates" && <TemplatesTab canEdit={!!meta?.isSuperAdmin} />}
      {tab === "variables" && <VariablesTab canEdit={!!meta?.isSuperAdmin} />}
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
  const [balance, setBalance] = useState<{ configured: boolean; balance: number | null } | null>(null);
  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/sms/overview").then((r) => r.json()).then((d) => setData(d.ok ? d.overview : null)).catch(() => setData(null)).finally(() => setLoading(false));
    fetch("/api/admin/sms/balance").then((r) => r.json()).then((d) => setBalance(d.ok || d.configured === false ? d : null)).catch(() => setBalance(null));
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
        <Kpi label="Submitted to gateway" value={data.today.submitted} />
        <Kpi label="Delivered (confirmed)" value={data.deliveryKnown ? data.today.delivered : "—"} />
        <Kpi label="Failed" value={data.today.failed} tone="red" />
        <Kpi label="Pending" value={data.today.queued} />
        <Kpi label="Credits (gateway)" value={balance ? (balance.configured ? (balance.balance ?? "—") : "not configured") : "…"} />
      </div>
      <p className="-mt-2 text-xs text-muted">Daily cap: {data.dailyCap.cap ? `${data.dailyCap.used} / ${data.dailyCap.cap}` : `${data.dailyCap.used} / ∞`}</p>
      {!data.deliveryKnown && (
        <p className="-mt-2 text-xs text-muted">
          “Submitted” = accepted by JustGoSMS. Handset delivery shows once delivery receipts (DLR) are configured on the gateway — until then “Delivered” reads “—”, not 0.
        </p>
      )}

      <div className="card p-4">
        <p className="mb-3 text-sm font-semibold">Last 24 hours</p>
        <SmsTrend24h data={data.trend24h} />
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
type Recip = { mobile: string; name: string | null };
type Timeframe = "7d" | "30d" | "6mo" | "all" | "month";
type FilterShape = { courseSlug?: string | null; webinarSlug?: string | null; paymentStatus?: string | null; timeframe?: Timeframe | null; month?: string | null };
type SavedAud = { id: string; name: string; spec: FilterShape };
const TIMEFRAME_LABEL: Record<Timeframe, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "6mo": "Last 6 months", all: "All time", month: "Specific month" };
// Which date each time frame filters on, per the active dimension (shown in UI).
function dateFieldNote(courseSlug: string, webinarSlug: string): string {
  if (courseSlug) return "enrolment date (course_enrollments.created_at / course payment date)";
  if (webinarSlug) return "paid date for paid webinars (else registration date)";
  return "payment date (payments.created_at)";
}

/** Which date the preset timeframe filter scopes on, for the given segment. */
function presetDateNote(audType: string): string {
  if (audType.startsWith("payment_")) return "payment date";
  if (audType.startsWith("webinar_")) return "webinar registration date";
  if (audType === "leads") return "lead created date";
  return "signup date";
}

function SendTab({ meta }: { meta: Meta | null }) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateId, setTemplateId] = useState("");
  // Preset segment is the first-class default; filter builder / person are secondary.
  const [audType, setAudType] = useState("payment_paid");
  const [lastPreset, setLastPreset] = useState("payment_paid");
  // Timeframe scoping for the PRESET segment (mirrors the Lead CRM filter).
  const [pTf, setPTf] = useState<TimeframeValue>({ mode: "all" });
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [webinarSlug, setWebinarSlug] = useState("");
  const [source, setSource] = useState("");
  const [stage, setStage] = useState("");
  // composable filters (audType === "filtered")
  const [fCourse, setFCourse] = useState("");
  const [fWebinar, setFWebinar] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fTimeframe, setFTimeframe] = useState<Timeframe>("all");
  const [fMonth, setFMonth] = useState("");
  // saved audiences (reusable filter combinations)
  const [saved, setSaved] = useState<SavedAud[]>([]);
  const [savedId, setSavedId] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [recipients, setRecipients] = useState<Recip[] | null>(null);
  const [rich, setRich] = useState<any>(null);
  const [richBusy, setRichBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowOverride, setAllowOverride] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [balance, setBalance] = useState<{ configured: boolean; balance: number | null } | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [testMobile, setTestMobile] = useState("");
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => { fetch("/api/admin/sms/templates").then((r) => r.json()).then((d) => d.ok && setTemplates(d.templates)).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/admin/sms/balance").then((r) => r.json()).then((d) => (d.ok || d.configured === false) && setBalance(d)).catch(() => {}); }, []);

  const loadSaved = useCallback(() => { fetch("/api/admin/sms/saved-audiences").then((r) => r.json()).then((d) => d.ok && setSaved(d.saved)).catch(() => {}); }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  const sendable = templates.filter((t) => (t.status === "active" || t.status === "approved") && t.gateway_template_id);
  const needsWebinar = audType.startsWith("webinar_");
  const isFiltered = audType === "filtered";
  const panel: "filtered" | "preset" | "person" = audType === "filtered" ? "filtered" : audType === "person" ? "person" : "preset";
  const filtersDirty = !!(fCourse || fWebinar || fStatus || fTimeframe !== "all");

  function applySaved(id: string) {
    setSavedId(id);
    const s = saved.find((x) => x.id === id);
    if (!s) return;
    setAudType("filtered");
    setFCourse(s.spec.courseSlug || "");
    setFWebinar(s.spec.webinarSlug || "");
    setFStatus(s.spec.paymentStatus || "");
    setFTimeframe((s.spec.timeframe as Timeframe) || "all");
    setFMonth(s.spec.month || "");
  }
  async function saveCurrent() {
    const nm = window.prompt("Name this audience (e.g. \"Paid — Foundation 2027, last 30 days\")");
    if (!nm || !nm.trim()) return;
    const spec: FilterShape = { courseSlug: fCourse || null, webinarSlug: fWebinar || null, paymentStatus: fStatus || null, timeframe: fTimeframe, month: fTimeframe === "month" ? fMonth || null : null };
    const r = await fetch("/api/admin/sms/saved-audiences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nm.trim(), spec }) }).then((x) => x.json()).catch(() => null);
    if (r?.ok) { toast("Audience saved.", "success"); setSaved((s) => [r.saved, ...s]); setSavedId(r.saved.id); }
    else toast(r?.error || "Could not save audience", "error");
  }
  async function deleteSaved(id: string) {
    if (!confirm("Delete this saved audience?")) return;
    const r = await fetch(`/api/admin/sms/saved-audiences?id=${encodeURIComponent(id)}`, { method: "DELETE" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) { setSaved((s) => s.filter((x) => x.id !== id)); if (savedId === id) setSavedId(""); toast("Deleted.", "success"); }
    else toast("Delete failed", "error");
  }
  const selectedTpl = templates.find((t) => t.id === templateId);
  const isPromo = selectedTpl?.message_type === "promotional";
  useEffect(() => { if (isPromo && audType === "all") { setAudType("person"); setPreview(null); } }, [isPromo, audType]);

  const buildAudience = useCallback((restrictTo?: string[]) => {
    if (isFiltered) {
      return {
        type: "filtered",
        filters: { courseSlug: fCourse || null, webinarSlug: fWebinar || null, paymentStatus: fStatus || null, timeframe: fTimeframe, month: fTimeframe === "month" ? fMonth || null : null },
        restrictTo,
      };
    }
    return { type: audType, mobile, name, webinarSlug: needsWebinar ? webinarSlug : null, source: audType === "leads" ? source : null, stage: audType === "leads" ? stage : null, presetTimeframe: audType === "person" ? null : pTf, restrictTo };
  }, [isFiltered, fCourse, fWebinar, fStatus, fTimeframe, fMonth, audType, mobile, name, needsWebinar, webinarSlug, source, stage, pTf]);

  const runPreview = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    try {
      const r = await fetch("/api/admin/sms/audience", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience: buildAudience(), templateId, includeList: true }) }).then((x) => x.json());
      setPreview(r.ok ? r : null);
      setRecipients(r.ok && Array.isArray(r.recipients) ? r.recipients : null);
      if (!r.ok && !silent) toast(r.error || "Preview failed", "error");
    } catch (e) {
      if (!silent) { setPreview(null); toast(e instanceof Error ? e.message : "Preview failed — please retry.", "error"); }
    } finally {
      if (!silent) setBusy(false);
    }
  }, [buildAudience, templateId, toast]);

  // Live recipient count: debounced auto-preview for the filter builder AND preset
  // segments (person mode too, once a valid mobile is entered) so the admin always
  // sees how many will receive the message for the current segment + timeframe.
  useEffect(() => {
    const canAuto = isFiltered || panel === "preset" || (panel === "person" && mobile.trim().length >= 10);
    if (!canAuto) return;
    // Preset webinar segments need a webinar selected before a count is meaningful.
    if (panel === "preset" && needsWebinar && !webinarSlug) return;
    const t = setTimeout(() => { runPreview(true); }, 400);
    return () => clearTimeout(t);
  }, [isFiltered, panel, audType, fCourse, fWebinar, fStatus, fTimeframe, fMonth, pTf, mobile, name, needsWebinar, webinarSlug, source, stage, templateId, runPreview]);

  // Rich template preview (per-recipient message, real-vs-sample vars, coverage).
  const runRich = useCallback(async (idx: number) => {
    if (!templateId) { toast("Pick a template to preview the message.", "error"); return; }
    setRichBusy(true);
    try {
      const r = await fetch("/api/admin/sms/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience: buildAudience(), templateId, index: Math.max(0, idx) }) }).then((x) => x.json());
      if (r.ok) setRich(r); else { setRich(null); toast(r.error || "Preview failed", "error"); }
    } catch (e) {
      setRich(null); toast(e instanceof Error ? e.message : "Preview failed — please retry.", "error");
    } finally { setRichBusy(false); }
  }, [buildAudience, templateId, toast]);

  // Any audience/template change invalidates the rich preview so it's never stale.
  useEffect(() => { setRich(null); }, [audType, templateId, fCourse, fWebinar, fStatus, fTimeframe, fMonth, mobile, webinarSlug, source, stage]);

  async function doSend(restrictTo?: string[], label?: string) {
    if (!templateId) return toast("Pick a template.", "error");
    if (!preview && !restrictTo) { await runPreview(); return; }
    const n = restrictTo ? restrictTo.length : preview?.count;
    const when = scheduleAt && !restrictTo ? ` (scheduled ${scheduleAt.replace("T", " ")} IST)` : "";
    if (!confirm(`Send "${templates.find((t) => t.id === templateId)?.name}" to ${n} ${label || "recipient(s)"}${when}?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/sms/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience: buildAudience(restrictTo), templateId, allowRecentOverride: allowOverride, scheduleAt: restrictTo ? undefined : (scheduleAt || undefined) }) });
      if (!res.ok) throw new Error(`Send failed (HTTP ${res.status}). ${res.status === 504 ? "The batch took too long — try a smaller audience or retry." : "Please retry."}`);
      const r = await res.json();
      if (r.ok) {
        const skipTxt = Object.keys(r.skipped || {}).length ? " Skipped: " + Object.entries(r.skipped).map(([k, v]) => `${k}:${v}`).join(", ") : "";
        const modeTxt = r.mode && r.mode !== "single" ? ` [${r.mode}${r.batches ? ` ×${r.batches}` : ""}]` : "";
        const schedTxt = r.scheduledFor ? ` Scheduled for ${r.scheduledFor}.` : "";
        toast(`Sent ${r.sent}/${r.requested}${modeTxt}.${schedTxt}${skipTxt}`, r.sent > 0 ? "success" : "error");
        if (r.campaignId && !r.scheduledFor) setCampaignId(r.campaignId);
        if (!restrictTo) setPreview(null);
      } else toast(r.error || "Send failed", "error");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Send failed — please retry.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function doTestSend() {
    if (!templateId) return toast("Pick a template first.", "error");
    if (!testMobile.trim()) return toast("Enter a mobile to test to.", "error");
    setTestBusy(true);
    try {
      const r = await fetch("/api/admin/sms/test-send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mobile: testMobile.trim(), templateId }) }).then((x) => x.json());
      toast(r.ok ? `Test sent to ${testMobile.trim()}.` : (r.error || "Test send failed"), r.ok ? "success" : "error");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Test send failed — please retry.", "error");
    } finally { setTestBusy(false); }
  }

  const lowCredits = balance?.configured && balance.balance != null && preview?.count != null && balance.balance < preview.count;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card space-y-3 p-4">
        <Field label="Template (Approved / Active only)">
          <select className="input" value={templateId} onChange={(e) => { setTemplateId(e.target.value); if (!isFiltered) setPreview(null); }}>
            <option value="">Select a template…</option>
            {sendable.map((t) => <option key={t.id} value={t.id}>{t.name}{t.message_type === "promotional" ? " · promo" : ""}</option>)}
          </select>
          {sendable.length === 0 && <p className="mt-1 text-xs text-amber-700">No Approved/Active templates yet — set a DLT ID and activate one in the Templates tab.</p>}
        </Field>

        <div>
          <p className="mb-1 block text-xs font-medium text-muted">Audience</p>
          <div className="flex flex-wrap gap-1.5">
            <ModePill active={panel === "filtered"} onClick={() => { setAudType("filtered"); setPreview(null); setRecipients(null); }} icon={SlidersHorizontal} label="Filter builder" />
            <ModePill active={panel === "preset"} onClick={() => { setAudType(lastPreset); setPreview(null); setRecipients(null); }} icon={Users} label="Preset segment" />
            <ModePill active={panel === "person"} onClick={() => { setAudType("person"); setPreview(null); setRecipients(null); }} icon={Send} label="Specific person" />
          </div>
        </div>

        {panel === "filtered" && (
          <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Bookmark size={13} className="shrink-0 text-muted" />
              <select className="input h-9 max-w-[220px] py-1 text-sm" value={savedId} onChange={(e) => applySaved(e.target.value)}>
                <option value="">Saved audiences…</option>
                {saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {savedId && <button onClick={() => deleteSaved(savedId)} className="btn btn-secondary text-xs" title="Delete saved audience"><Trash2 size={13} /></button>}
              <button onClick={saveCurrent} disabled={!filtersDirty} className="btn btn-secondary ml-auto text-xs" title="Save this filter combination"><Save size={13} /> Save current</button>
            </div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink2"><SlidersHorizontal size={13} /> Filters (combine freely — each narrows the list)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Course">
                <select className="input" value={fCourse} onChange={(e) => { setFCourse(e.target.value); setSavedId(""); }}>
                  <option value="">Any course</option>
                  {(meta?.courses || []).map((c) => <option key={c.id} value={c.slug}>{c.title}</option>)}
                </select>
              </Field>
              <Field label="Webinar">
                <select className="input" value={fWebinar} onChange={(e) => { setFWebinar(e.target.value); setSavedId(""); }}>
                  <option value="">Any webinar</option>
                  {(meta?.webinars || []).map((w) => <option key={w.id} value={w.slug}>{w.title}</option>)}
                </select>
              </Field>
              <Field label="Payment status">
                <select className="input" value={fStatus} onChange={(e) => { setFStatus(e.target.value); setSavedId(""); }}>
                  <option value="">Any status</option>
                  <option value="paid">Paid</option>
                  <option value="notpaid">Not paid (no successful payment)</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                  <option value="abandoned">Abandoned</option>
                </select>
              </Field>
              <Field label="Time frame">
                <select className="input" value={fTimeframe} onChange={(e) => { setFTimeframe(e.target.value as Timeframe); setSavedId(""); }}>
                  {(Object.keys(TIMEFRAME_LABEL) as Timeframe[]).map((t) => <option key={t} value={t}>{TIMEFRAME_LABEL[t]}</option>)}
                </select>
              </Field>
            </div>
            {fTimeframe === "month" && (
              <Field label="Month (IST)"><input type="month" className="input" value={fMonth} onChange={(e) => { setFMonth(e.target.value); setSavedId(""); }} /></Field>
            )}
            {fTimeframe !== "all" && <p className="text-xs text-muted">Time frame filters on {dateFieldNote(fCourse, fWebinar)}.</p>}
            {isPromo && <p className="text-xs text-amber-700">Promotional template — this filter targets warm contacts (buyers / registrants), never a cold blast.</p>}
          </div>
        )}

        {panel === "preset" && (
          <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
            <Field label="Preset segment">
              <select className="input" value={audType} onChange={(e) => { setAudType(e.target.value); setLastPreset(e.target.value); setPreview(null); setRecipients(null); }}>
                <optgroup label="Payments"><option value="payment_paid">Paid</option><option value="payment_not_paid">NOT paid (no successful payment)</option><option value="payment_pending">Pending</option><option value="payment_failed">Failed</option><option value="payment_abandoned">Abandoned</option><option value="payment_all">All payments</option></optgroup>
                <optgroup label="Webinar"><option value="webinar_registered">Registered</option><option value="webinar_not_registered">NOT registered</option><option value="webinar_attendees">Attended</option><option value="webinar_no_show">No-show</option></optgroup>
                <optgroup label="People"><option value="leads">Leads</option><option value="users_with_mobile">All users with mobile</option>{!isPromo && <option value="all">Everyone (guarded)</option>}</optgroup>
              </select>
              {isPromo && <p className="mt-1 text-xs text-amber-700">Promotional template — warm audiences only (leads / users / webinar). The All audience is disabled (no promo route).</p>}
            </Field>
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink2"><Clock size={13} /> Timeframe {pTf.mode !== "all" && <span className="font-normal text-muted">· {TIMEFRAME_LABELS[pTf.mode]}</span>}</p>
              <TimeframeFilter value={pTf} onChange={(v) => { setPTf(v); setPreview(null); setRecipients(null); }} size="sm" />
              <p className="mt-1.5 text-xs text-muted">Scopes recipients by {presetDateNote(audType)}.{pTf.mode === "all" ? "" : " Only people from the selected window will receive this."}</p>
            </div>
          </div>
        )}

        {panel === "person" && (
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

        <Field label="Schedule (optional, IST) — leave blank to send now">
          <input type="datetime-local" className="input" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
        </Field>

        <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={allowOverride} onChange={(e) => setAllowOverride(e.target.checked)} /> Override 30-min re-send guard (only if you really mean to re-send)</label>

        {balance?.configured && <p className="text-xs text-muted">Gateway credits: <span className="font-semibold tabular-nums">{balance.balance ?? "—"}</span></p>}
        {lowCredits && <p className="text-xs text-danger">Not enough credits ({balance?.balance}) for {preview?.count} recipients — the send will be refused.</p>}

        <details className="group rounded-xl border border-line">
          <summary className="flex cursor-pointer list-none items-center gap-2 p-2.5 text-xs font-medium text-muted">
            <ChevronDown size={14} className="shrink-0 transition group-open:rotate-180" />
            Test send to yourself first <span className="font-normal">(optional)</span>
          </summary>
          <div className="space-y-1.5 border-t border-line p-2.5">
            <div className="flex gap-2">
              <input className="input" placeholder="your 10-digit mobile" value={testMobile} onChange={(e) => setTestMobile(e.target.value)} />
              <button onClick={doTestSend} disabled={testBusy || !templateId || !testMobile.trim()} className="btn btn-secondary shrink-0">{testBusy ? "…" : "Send test"}</button>
            </div>
            <p className="text-[11px] text-muted">One message to this number, sample values fill any blanks (real login link). All safeguards apply.</p>
          </div>
        </details>

        <div className="flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 text-xs">
          <Users size={13} className="text-muted" />
          <span className="text-muted">Recipients matching current {panel === "filtered" ? "filters" : panel === "person" ? "contact" : "segment + timeframe"}:</span>
          <span className="font-semibold tabular-nums text-ink">{busy ? "…" : (preview?.count ?? "—")}</span>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={() => { runPreview(); runRich(0); }} disabled={busy} className="btn btn-secondary">{busy ? "…" : "Preview"}</button>
          <button onClick={() => doSend()} disabled={busy || !templateId || !!preview?.blocked || (preview?.count ?? 0) === 0} className="btn btn-primary"><Send size={15} /> {preview ? `Send to ${preview.count}` : "Preview & send"}</button>
        </div>
      </div>

      <div className="card space-y-3 p-4">
        <p className="text-sm font-semibold">Preview</p>
        {!preview ? <p className="text-sm text-muted">Run a preview to see recipient count, WHO will receive it, the filled message and cap impact.</p> : (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="pill pill-blue">{preview.count} recipients</span>
              <span className="pill pill-gray">{preview.audienceLabel}</span>
              {preview.promotional && <span className="pill pill-amber">Promotional · warm only · route 12</span>}
              {preview.willExceedDaily && <span className="pill pill-amber">Exceeds remaining daily cap ({preview.remainingDaily})</span>}
            </div>
            {preview.blocked && <p className="text-xs text-danger">{preview.blockedReason}</p>}
            {recipients && <RecipientList recipients={recipients} search={search} setSearch={setSearch} />}
            {rich ? (
              <TemplatePreview data={rich} busy={richBusy} onNav={(i) => runRich(i)} balance={balance?.configured ? balance.balance : null} />
            ) : preview.preview ? (
              <div className="rounded-xl bg-surface p-3 text-sm">
                <p className="whitespace-pre-wrap">{preview.preview.text}</p>
                <p className="mt-2 text-xs text-muted">{preview.preview.length} chars · {preview.preview.segments} segment(s)</p>
                {preview.preview.errors?.length > 0 && <p className="mt-1 text-xs text-danger">{preview.preview.errors.join("; ")}</p>}
                {preview.preview.missing?.length > 0 && <p className="mt-1 text-xs text-amber-700">Missing: {preview.preview.missing.join(", ")}</p>}
                {preview.preview.warnings?.length > 0 && <p className="mt-1 text-xs text-amber-700">{preview.preview.warnings.join("; ")}</p>}
                {templateId && <button onClick={() => runRich(0)} disabled={richBusy} className="btn btn-secondary mt-2 text-xs">{richBusy ? "…" : "Preview message & coverage"}</button>}
              </div>
            ) : templateId ? (
              <button onClick={() => runRich(0)} disabled={richBusy} className="btn btn-secondary text-xs">{richBusy ? "…" : "Preview message & coverage"}</button>
            ) : <p className="text-sm text-muted">Select a template to see the filled message.</p>}
            {preview.dailyCap && <p className="text-xs text-muted">Daily cap {preview.dailyCap}; remaining today {preview.remainingDaily}. Per-mobile cap {preview.perMobileCap || "∞"}.</p>}
          </>
        )}
      </div>

      {campaignId && (
        <div className="lg:col-span-2">
          <LiveStatusPanel campaignId={campaignId} onClose={() => setCampaignId(null)} onResend={(failed) => doSend(failed, "failed number(s)")} busy={busy} />
        </div>
      )}
    </div>
  );
}

// searchable / scrollable recipient list (handles 190+)
function RecipientList({ recipients, search, setSearch }: { recipients: Recip[]; search: string; setSearch: (s: string) => void }) {
  const q = search.trim().toLowerCase();
  const filtered = q ? recipients.filter((r) => (r.name || "").toLowerCase().includes(q) || r.mobile.includes(q.replace(/\D/g, ""))) : recipients;
  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Users size={14} className="text-muted" />
        <span className="text-xs font-semibold">{filtered.length}{q ? ` / ${recipients.length}` : ""} recipient{filtered.length === 1 ? "" : "s"}</span>
        <div className="ml-auto flex items-center gap-1.5 rounded-lg bg-surface px-2 py-1">
          <Search size={12} className="text-muted" />
          <input className="w-32 bg-transparent text-xs outline-none" placeholder="search name / number" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {filtered.length === 0 ? <p className="p-3 text-xs text-muted">No matches.</p> : (
          <ul className="divide-y divide-line/60 text-sm">
            {filtered.slice(0, 500).map((r, i) => (
              <li key={`${r.mobile}-${i}`} className="flex items-center justify-between px-3 py-1.5">
                <span className="truncate text-ink2">{r.name || <span className="text-muted">—</span>}</span>
                <span className="ml-2 shrink-0 font-mono text-xs text-muted">{r.mobile}</span>
              </li>
            ))}
          </ul>
        )}
        {filtered.length > 500 && <p className="px-3 py-2 text-xs text-muted">Showing first 500 of {filtered.length}. Refine with search.</p>}
      </div>
    </div>
  );
}

// rich template preview: exact per-recipient message, real-vs-sample variable
// provenance, delivery coverage, DLT status + segment/credit cost.
const VAR_SOURCE_STYLE: Record<string, { cls: string; label: string }> = {
  real: { cls: "pill-green", label: "real" },
  store: { cls: "pill-blue", label: "global" },
  sample: { cls: "pill-amber", label: "sample" },
  missing: { cls: "pill-red", label: "missing" },
};
function TemplatePreview({ data, busy, onNav, balance }: { data: any; busy: boolean; onNav: (index: number) => void; balance: number | null }) {
  const cov = data.coverage || { total: 0, deliverable: 0, skipped: 0, reasons: {} };
  const idx = data.index ?? 0;
  const total = data.total ?? 0;
  const reasons = Object.entries(cov.reasons || {}) as [string, number][];
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
      {/* DLT status */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {data.dlt?.approved
          ? <span className="pill pill-green">DLT approved</span>
          : <span className="pill pill-amber">DLT not send-ready ({data.dlt?.status || "—"})</span>}
        {data.dlt?.id && <span className="font-mono text-muted">DLT {data.dlt.id}</span>}
        {data.dlt?.messageType === "promotional" && <span className="pill pill-amber">promotional</span>}
      </div>

      {/* recipient navigator */}
      <div className="flex items-center gap-2">
        <button onClick={() => onNav(idx - 1)} disabled={busy || idx <= 0} className="btn btn-secondary px-2 py-1 text-xs disabled:opacity-40">‹</button>
        <div className="min-w-0 flex-1 text-center text-xs">
          <span className="font-semibold">{data.recipient?.name || "—"}</span>
          <span className="ml-1 font-mono text-muted">{data.recipient?.mobile}</span>
          <span className="ml-2 text-muted">{total ? `${idx + 1} / ${total}` : ""}</span>
        </div>
        <button onClick={() => onNav(idx + 1)} disabled={busy || idx >= total - 1} className="btn btn-secondary px-2 py-1 text-xs disabled:opacity-40">›</button>
      </div>

      {/* rendered message as this recipient sees it */}
      <div className="rounded-lg bg-canvas p-3 text-sm">
        <p className="whitespace-pre-wrap">{data.text}</p>
        <p className="mt-2 text-xs text-muted">{data.chars} chars · {data.segments} segment{data.segments === 1 ? "" : "s"} · {data.segments} credit{data.segments === 1 ? "" : "s"}/recipient{data.gsm === false ? " · non-GSM (UCS-2)" : ""}</p>
      </div>

      {/* not-deliverable flag for this specific recipient */}
      {data.deliverable === false && (
        <p className="text-xs text-danger">This recipient would be <b>skipped</b> in a real send — missing: {(data.missingForRecipient || []).join(", ")}. Sample values above are shown for preview only.</p>
      )}

      {/* per-variable provenance */}
      {data.vars?.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-ink2">Variables</p>
          <div className="flex flex-wrap gap-1.5">
            {data.vars.map((v: any) => {
              const st = VAR_SOURCE_STYLE[v.source] || VAR_SOURCE_STYLE.missing;
              return (
                <span key={v.key} className={`pill ${st.cls} text-[10px]`} title={`${v.key}: ${v.source}`}>
                  <span className="font-mono">{v.key}</span>
                  {v.source !== "missing" && <span className="ml-1 opacity-80">= {v.value.length > 22 ? v.value.slice(0, 22) + "…" : v.value}</span>}
                  <span className="ml-1 font-semibold uppercase opacity-70">{st.label}</span>
                </span>
              );
            })}
          </div>
          <p className="text-[11px] text-muted"><span className="font-semibold text-success">real</span> = recipient data · <span className="font-semibold text-primary">global</span> = variable store · <span className="font-semibold text-amber-700">sample</span> = filler for preview (would skip if required) · <span className="font-semibold text-danger">missing</span></p>
        </div>
      )}

      {/* coverage */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-ink2">Delivery coverage</span>
          <span className="tabular-nums text-muted">{cov.deliverable} of {cov.total} will receive</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface2">
          <div className="h-full bg-success" style={{ width: `${cov.total ? Math.round((cov.deliverable / cov.total) * 100) : 0}%` }} />
        </div>
        {cov.skipped > 0 && (
          <p className="text-xs text-amber-700">{cov.skipped} would be skipped{reasons.length ? ` — ${reasons.map(([k, n]) => `${k.replace(/_/g, " ")}: ${n}`).join(", ")}` : ""}. They never send (safeguards), so you don't pay for them.</p>
        )}
      </div>

      {/* cost estimate */}
      {data.cost && (
        <div className="space-y-0.5 rounded-lg border border-line p-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted">Estimated cost</span>
            <span className="font-semibold tabular-nums">Rs {data.cost.estimate} <span className="font-normal text-muted">· {data.cost.credits} credit{data.cost.credits === 1 ? "" : "s"} @ Rs {data.cost.costPerSms}/SMS</span></span>
          </div>
          {balance != null && (
            <div className="flex items-center justify-between">
              <span className="text-muted">Balance after send</span>
              <span className={`font-semibold tabular-nums ${balance - data.cost.credits < 0 ? "text-danger" : ""}`}>{balance - data.cost.credits} <span className="font-normal text-muted">(now {balance})</span></span>
            </div>
          )}
          {balance != null && balance < data.cost.credits && <p className="text-danger">Not enough credits ({balance}) for {data.cost.credits} — the send will be refused by the balance guard.</p>}
        </div>
      )}
    </div>
  );
}

// live per-recipient send status (Queued → Sent → Delivered / Failed) + resend-to-failed
type CampaignStatus = { total: number; totals: { queued: number; sent: number; delivered: number; failed: number; unknown: number }; settled: boolean; recipients: { mobile: string; name: string | null; status: string; error: string | null }[] };
function LiveStatusPanel({ campaignId, onClose, onResend, busy }: { campaignId: string; onClose: () => void; onResend?: (failed: string[]) => void; busy: boolean }) {
  const [data, setData] = useState<CampaignStatus | null>(null);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const startRef = useState(() => Date.now())[0];

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`/api/admin/sms/campaign?id=${encodeURIComponent(campaignId)}`).then((x) => x.json());
        if (stop) return;
        if (r.ok) setData(r);
        // Stop when everything settled or after ~5 minutes.
        const expired = Date.now() - startRef > 5 * 60000;
        if (!stop && !(r.ok && r.settled) && !expired) timer = setTimeout(tick, 5000);
      } catch {
        if (!stop) timer = setTimeout(tick, 5000);
      }
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [campaignId, startRef]);

  const t = data?.totals;
  const failedNums = (data?.recipients || []).filter((r) => r.status === "FAILED").map((r) => r.mobile);
  const shown = onlyFailed ? (data?.recipients || []).filter((r) => r.status === "FAILED") : (data?.recipients || []);

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">Live send status</p>
        {data && !data.settled && <span className="inline-flex items-center gap-1 text-xs text-muted"><RefreshCw size={12} className="animate-spin" /> updating…</span>}
        {data?.settled && <span className="pill pill-green text-[10px]">settled</span>}
        <button onClick={onClose} className="btn btn-secondary ml-auto text-xs">Close</button>
      </div>
      {!data ? <LoadingBlock /> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Kpi label="Queued" value={t!.queued} />
            <Kpi label="Sent" value={t!.sent} />
            <Kpi label="Delivered" value={t!.delivered} />
            <Kpi label="Failed" value={t!.failed} tone="red" />
            <Kpi label="Total" value={data.total} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} /> Show only failed</label>
            {onResend && failedNums.length > 0 && (
              <button onClick={() => onResend(failedNums)} disabled={busy} className="btn btn-secondary ml-auto text-xs"><RotateCcw size={12} /> Resend to {failedNums.length} failed</button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted"><th className="px-3 py-2">Name</th><th className="px-3 py-2">Mobile</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody>
                {shown.length === 0 ? <tr><td colSpan={3} className="p-4 text-center text-xs text-muted">No recipients.</td></tr> : shown.slice(0, 800).map((r, i) => (
                  <tr key={`${r.mobile}-${i}`} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-1.5 truncate text-ink2">{r.name || "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted">{r.mobile}</td>
                    <td className={`px-3 py-1.5 font-semibold ${STATUS_TONE[r.status] || ""}`}>{r.status}{r.error && r.status === "FAILED" ? <span className="ml-1 font-normal text-xs text-muted">({r.error})</span> : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Resend-to-failed re-runs the same audience for just the failed numbers — all caps, the DLT/approved-template gate, the kill-switch, the balance guard and in-batch dedupe still apply (a delivered number is never re-texted).</p>
        </>
      )}
    </div>
  );
}

// ============================ CAMPAIGNS ============================
type CampaignRow = { campaign_id: string; template_name: string | null; audience_type: string | null; created_at: string; total: number; queued: number; sent: number; delivered: number; failed: number; unknown: number; deliveryRate: number };
function CampaignsTab({ canResend }: { canResend: boolean }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [remount, setRemount] = useState(0);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setLoading(true); fetch("/api/admin/sms/campaigns").then((r) => r.json()).then((d) => setRows(d.ok ? d.campaigns : [])).finally(() => setLoading(false)); }, []);
  useEffect(() => { load(); }, [load]);

  async function resend(id: string) {
    if (!confirm("Resend this campaign's message to every FAILED number? Delivered/sent numbers are never re-texted; opt-outs, kill-switch and the daily cap still apply.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/sms/campaign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "resend_failed" }) }).then((x) => x.json());
      if (r.ok) { const skip = Object.keys(r.skipped || {}).length ? " Skipped: " + Object.entries(r.skipped).map(([k, v]) => `${k}:${v}`).join(", ") : ""; toast(`Resent ${r.resent}.${skip}`, r.resent > 0 ? "success" : "error"); setRemount((n) => n + 1); load(); }
      else toast(r.error || "Resend failed", "error");
    } catch (e) { toast(e instanceof Error ? e.message : "Resend failed", "error"); } finally { setBusy(false); }
  }

  if (loading) return <LoadingBlock />;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted">Every manual / bulk send is a campaign. Delivery updates as receipts (DLR) settle.</p>
        <button onClick={load} className="btn btn-secondary ml-auto text-xs"><RefreshCw size={13} /> Refresh</button>
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted">No campaigns yet. Send from the Send tab and they'll appear here.</p> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">When</th><th className="px-4 py-3">Template</th><th className="px-4 py-3">Audience</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Delivered</th><th className="px-4 py-3 text-right">Failed</th><th className="px-4 py-3 text-right">Rate</th><th className="px-4 py-3 text-right">View</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.campaign_id} className="border-b border-line/60 last:border-0 hover:bg-surface2/50">
                  <td className="px-4 py-2.5 text-xs text-muted">{formatISTDateTime(c.created_at)}</td>
                  <td className="px-4 py-2.5">{c.template_name || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-ink2">{c.audience_type || "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.total}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-success">{c.delivered}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-danger">{c.failed}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.deliveryRate}%</td>
                  <td className="px-4 py-2.5 text-right"><button onClick={() => { setOpenId(c.campaign_id); setRemount((n) => n + 1); }} className="btn btn-secondary text-xs">View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId && (
        <LiveStatusPanel key={`${openId}-${remount}`} campaignId={openId} onClose={() => setOpenId(null)} onResend={canResend ? () => resend(openId) : undefined} busy={busy} />
      )}
    </div>
  );
}

// ============================ AUTOMATIONS ============================
// Triggers whose recipients are resolved from an audience segment (the hourly
// webinar scheduler). Only these expose the audience selector — event-driven,
// per-person triggers (payment_failed, first_login, …) have no segment to scope.
const AUDIENCE_TRIGGERS = new Set([
  "webinar_day_before", "webinar_sameday_registered", "webinar_sameday_invite",
  "webinar_starting_soon", "post_webinar_thankyou",
]);
const AUTOMATION_AUDIENCES: { value: string; label: string }[] = [
  { value: "webinar_registered", label: "Webinar — Registered" },
  { value: "webinar_not_registered", label: "Webinar — NOT registered" },
  { value: "webinar_attendees", label: "Webinar — Attended" },
  { value: "webinar_no_show", label: "Webinar — No-show" },
  { value: "payment_paid", label: "Paid (PAID-wins)" },
  { value: "payment_not_paid", label: "Not paid (PAID-wins)" },
];

/** Clear, unambiguous on/off switch (Item 3). */
function ToggleSwitch({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} disabled={disabled} onClick={onChange}
      title={on ? "Enabled — click to turn off" : "Disabled — click to turn on"}
      className={`inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-xs font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40 ${on ? "bg-success/15 text-success" : "bg-surface2 text-muted"}`}
    >
      <span className={`relative inline-block h-5 w-9 rounded-full transition-colors ${on ? "bg-success" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
      {on ? "On" : "Off"}
    </button>
  );
}

function AutomationsTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/sms/automations").then((r) => r.json()),
      fetch("/api/admin/sms/templates").then((r) => r.json()),
    ]).then(([a, t]) => { setRules(a.ok ? a.rules : []); setTemplates(t.ok ? t.templates : []); }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function patch(trigger: string, body: Record<string, unknown>) {
    const r = await fetch("/api/admin/sms/automations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger, ...body }) }).then((x) => x.json());
    if (r.ok) { toast("Saved.", "success"); load(); } else toast(r.error || "Save failed", "error");
  }

  if (loading) return <LoadingBlock />;
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
          <th className="px-4 py-3">Trigger</th><th className="px-4 py-3">Template</th><th className="px-4 py-3">Schedule</th><th className="px-4 py-3">Audience</th><th className="px-4 py-3">Last run</th><th className="px-4 py-3 text-right">Enabled</th>
        </tr></thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.trigger} className="border-b border-line/60 last:border-0 align-top">
              <td className="px-4 py-3 font-medium text-ink">{r.trigger}</td>
              <td className="px-4 py-3">
                {/* ITEM 1: editable trigger → template mapping */}
                {canEdit ? (
                  <select className="input h-9 py-1 text-xs" value={r.template_id || ""} onChange={(e) => patch(r.trigger, { template_id: e.target.value })}>
                    {!r.template_id && <option value="">— select —</option>}
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                ) : (r.template_name || "—")}
                {!r.template_ready && <span className="pill pill-amber ml-1 text-[10px]">no DLT/active</span>}
              </td>
              <td className="px-4 py-3 text-xs text-ink2">
                {r.schedule_time && <>at {r.schedule_time} IST</>}
                {r.delay_minutes != null && <>+{r.delay_minutes}m delay</>}
                {r.offset_minutes != null && <>end +{r.offset_minutes}m</>}
                {!r.schedule_time && r.delay_minutes == null && r.offset_minutes == null && "on event"}
              </td>
              <td className="px-4 py-3 text-xs">
                {/* ITEM 2: paid / not-paid (PAID-wins) + segment scoping for webinar jobs */}
                {AUDIENCE_TRIGGERS.has(r.trigger) && canEdit ? (
                  <select className="input h-9 py-1 text-xs" value={r.audience_type || ""} onChange={(e) => patch(r.trigger, { audience_type: e.target.value })}>
                    {AUTOMATION_AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                ) : (r.audience_type || "—")}
              </td>
              <td className="px-4 py-3 text-xs text-muted">{r.last_run_at ? formatISTDateTime(r.last_run_at) : "—"}</td>
              <td className="px-4 py-3 text-right">
                {/* ITEM 3: unambiguous toggle */}
                <ToggleSwitch on={r.enabled} disabled={!canEdit || !r.template_ready} onChange={() => patch(r.trigger, { enabled: !r.enabled })} />
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
// Substitution syntax used by the send pipeline: {token} (lowercase + _). The
// server re-detects authoritatively on save; this mirrors it for live preview.
const TPL_VAR_RE = /\{([a-z_]+)\}/g;
const KNOWN_VARS = new Set(["name", "first_name", "mobile", "login_code", "login_url", "item_name", "item_short", "amount", "payment_status", "webinar_date", "webinar_time", "support_number"]);
function detectVars(body: string): string[] { return [...new Set([...body.matchAll(TPL_VAR_RE)].map((m) => m[1]))]; }
function unknownVars(body: string): string[] { return detectVars(body).filter((v) => !KNOWN_VARS.has(v)); }

/** Compliance banner shown wherever staff add / edit templates. */
function ComplianceNote() {
  return (
    <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <ShieldCheck size={16} className="mt-0.5 shrink-0" />
      <p>
        <b>DLT / DND compliance.</b> This is a regulated SMS system. You may add ONLY templates whose <b>exact approved body</b> is registered against a real <b>DLT Template ID</b>. The body must byte-match the approved DLT registration (wording, spacing, links, punctuation) — otherwise the gateway rejects or garbles the message. No free-text or unapproved content may be sent. Adding a template here never sends anything and never changes opt-out / consent rules.
      </p>
    </div>
  );
}

function TemplatesTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TemplateRow | null>(null);   // built-in (Super Admin) editor
  const [managing, setManaging] = useState<TemplateRow | null>(null); // self-serve editor (send_sms)
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => { setLoading(true); fetch("/api/admin/sms/templates").then((r) => r.json()).then((d) => setTemplates(d.ok ? d.templates : [])).finally(() => setLoading(false)); }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingBlock />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setAdding(true)} className="btn btn-primary text-sm"><Plus size={15} /> Add template</button>
        <a href="/api/admin/sms/dlt?format=md" className="btn btn-secondary text-sm"><Download size={15} /> Export DLT (Markdown)</a>
        <a href="/api/admin/sms/dlt?format=csv" className="btn btn-secondary text-sm"><Download size={15} /> Export DLT (CSV)</a>
      </div>
      <ComplianceNote />
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <th className="px-4 py-3">Template</th><th className="px-4 py-3">Use</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">DLT ID</th><th className="px-4 py-3">Worst-case</th><th className="px-4 py-3 text-right">Manage</th>
          </tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 font-medium text-ink">{t.name}{t.message_type === "promotional" && <span className="pill pill-amber ml-1 text-[10px]">promo</span>}{t.custom && <span className="pill pill-blue ml-1 text-[10px]">custom</span>}</td>
                <td className="px-4 py-3 text-xs">{t.use_case}</td>
                <td className="px-4 py-3"><span className={`pill text-[10px] ${STATUS_TONE[t.status] || "pill-gray"}`}>{t.status}</span></td>
                <td className="px-4 py-3 font-mono text-xs">{t.gateway_template_id || <span className="text-amber-700">missing</span>}</td>
                <td className="px-4 py-3 text-xs">{t.worstCaseChars}c · {t.worstCaseSegments}seg {t.over155 && <span className="text-amber-700">⚠️</span>}</td>
                <td className="px-4 py-3 text-right">
                  {t.custom
                    ? <button onClick={() => setManaging(t)} className="btn btn-secondary text-xs">Edit</button>
                    : <button onClick={() => setEditing(t)} className="btn btn-secondary text-xs">Open{!canEdit ? " (view)" : ""}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted"><span className="pill pill-blue text-[10px]">custom</span> templates are self-serve — you can edit / deactivate them here. Built-in templates open in the Super-Admin editor and stay code-managed.</p>
      {adding && <AddTemplateModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); toast("Template added.", "success"); }} />}
      {editing && <TemplateEditor t={editing} canEdit={canEdit} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); toast("Saved.", "success"); }} />}
      {managing && <ManageTemplateModal t={managing} onClose={() => setManaging(null)} onSaved={(msg) => { setManaging(null); load(); toast(msg || "Saved.", "success"); }} />}
    </div>
  );
}

const USE_CASE_OPTS: { value: string; label: string }[] = [
  { value: "WEBINAR", label: "Webinar" },
  { value: "PAYMENT", label: "Payment" },
  { value: "POST_WEBINAR", label: "Post-webinar" },
  { value: "ONBOARDING", label: "Onboarding" },
];

/** Shared editable field set for add / edit self-serve templates. */
function TemplateFieldSet({
  name, setName, useCase, setUseCase, messageType, setMessageType, dlt, setDlt, body, setBody, senderId, setSenderId, route, setRoute, active, setActive,
}: {
  name: string; setName: (v: string) => void; useCase: string; setUseCase: (v: string) => void;
  messageType: string; setMessageType: (v: string) => void; dlt: string; setDlt: (v: string) => void;
  body: string; setBody: (v: string) => void; senderId: string; setSenderId: (v: string) => void;
  route: string; setRoute: (v: string) => void; active: boolean; setActive: (v: boolean) => void;
}) {
  const len = useMemo(() => [...body].length, [body]);
  const rupee = body.includes("₹");
  const vars = useMemo(() => detectVars(body), [body]);
  const unknown = useMemo(() => unknownVars(body), [body]);
  const dltValid = dlt.trim() === "" || /^\d{6,25}$/.test(dlt.trim());

  return (
    <div className="space-y-3">
      <Field label="Template name (internal label — not sent)">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali Masterclass Invite" maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Category"><select className="input" value={useCase} onChange={(e) => setUseCase(e.target.value)}>{USE_CASE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
        <Field label="Message type"><select className="input" value={messageType} onChange={(e) => setMessageType(e.target.value)}><option value="service">Service</option><option value="promotional">Promotional</option></select></Field>
      </div>
      <Field label="DLT Template ID (required · numeric · unique)">
        <input className="input font-mono text-sm" value={dlt} onChange={(e) => setDlt(e.target.value)} placeholder="e.g. 1707178358697914131" inputMode="numeric" />
        {!dltValid && <p className="mt-1 text-xs text-danger">DLT Template ID must be numeric (6–25 digits).</p>}
      </Field>
      <Field label="Message body (must byte-match the approved DLT text)">
        <textarea className="input min-h-[110px] font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Paste the exact approved body. Use {first_name}, {login_url}, {login_code}… for variable slots." />
        <p className={`mt-1 text-xs ${len > 155 ? "text-amber-700" : "text-muted"}`}>{len} chars{len > 155 ? " (> 155 — multi-segment)" : ""}{rupee ? " · ❌ contains ₹ (use Rs)" : ""}</p>
      </Field>
      <div className="rounded-xl border border-line bg-surface p-2.5 text-xs">
        <p className="font-semibold text-ink2">Detected variables</p>
        {vars.length === 0 ? <p className="mt-1 text-muted">None — this body is fully static.</p> : (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {vars.map((v) => <span key={v} className={`pill text-[10px] ${KNOWN_VARS.has(v) ? "pill-green" : "pill-amber"}`}><span className="font-mono">{`{${v}}`}</span></span>)}
          </div>
        )}
        {unknown.length > 0 && <p className="mt-1.5 text-amber-700">Unknown placeholder(s) {unknown.map((u) => `{${u}}`).join(", ")} — nothing fills these, so they render empty and those recipients are skipped (missing-vars) at send time.</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Sender / header ID"><input className="input font-mono text-sm" value={senderId} onChange={(e) => setSenderId(e.target.value)} placeholder="NAMIAS" /></Field>
        <Field label="Route"><input className="input font-mono text-sm" value={route} onChange={(e) => setRoute(e.target.value)} placeholder="12" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (send-ready now — requires a DLT ID and a clean body)</label>
    </div>
  );
}

function AddTemplateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [useCase, setUseCase] = useState("WEBINAR");
  const [messageType, setMessageType] = useState("service");
  const [dlt, setDlt] = useState("");
  const [body, setBody] = useState("");
  const [senderId, setSenderId] = useState("NAMIAS");
  const [route, setRoute] = useState("12");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const r = await fetch("/api/admin/sms/templates/manage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, use_case: useCase, message_type: messageType, gateway_template_id: dlt, body_template: body, sender_id: senderId, route, is_active: active }),
    }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    if (r?.ok) { if (r.warnings?.length) toast(r.warnings.join(" "), "info"); onSaved(); }
    else toast(r?.error || "Could not add template", "error");
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-xl overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">Add DLT template</h3>
        <p className="mt-0.5 text-xs text-muted">Register an approved template so staff can send it — no code change needed.</p>
        <div className="mt-4"><ComplianceNote /></div>
        <div className="mt-4">
          <TemplateFieldSet name={name} setName={setName} useCase={useCase} setUseCase={setUseCase} messageType={messageType} setMessageType={setMessageType} dlt={dlt} setDlt={setDlt} body={body} setBody={setBody} senderId={senderId} setSenderId={setSenderId} route={route} setRoute={setRoute} active={active} setActive={setActive} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={save} disabled={busy || !name.trim() || !dlt.trim() || !body.trim()} className="btn btn-primary">{busy ? "…" : "Add template"}</button>
        </div>
      </div>
    </div>
  );
}

function ManageTemplateModal({ t, onClose, onSaved }: { t: TemplateRow; onClose: () => void; onSaved: (msg?: string) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(t.name);
  const [useCase, setUseCase] = useState(t.use_case);
  const [messageType, setMessageType] = useState(t.message_type);
  const [dlt, setDlt] = useState(t.gateway_template_id || "");
  const [body, setBody] = useState(t.body_template);
  const [senderId, setSenderId] = useState(t.sender_id || "NAMIAS");
  const [route, setRoute] = useState(t.route || "12");
  const [active, setActive] = useState(t.is_active);
  const [busy, setBusy] = useState(false);

  async function call(payload: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    const r = await fetch("/api/admin/sms/templates/manage", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, ...payload }) }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    if (r?.ok) { if (r.warnings?.length) toast(r.warnings.join(" "), "info"); onSaved(successMsg); }
    else toast(r?.error || "Save failed", "error");
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-xl overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold">Edit template</h3>
          <span className="pill pill-blue text-[10px]">custom</span>
          <span className={`pill text-[10px] ${STATUS_TONE[t.status] || "pill-gray"}`}>{t.status}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted">Self-serve template. To retire it, deactivate (kept for history) — deletion is intentionally not offered so past send logs stay intact.</p>
        <div className="mt-4"><ComplianceNote /></div>
        <div className="mt-4">
          <TemplateFieldSet name={name} setName={setName} useCase={useCase} setUseCase={setUseCase} messageType={messageType} setMessageType={setMessageType} dlt={dlt} setDlt={setDlt} body={body} setBody={setBody} senderId={senderId} setSenderId={setSenderId} route={route} setRoute={setRoute} active={active} setActive={setActive} />
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary">Close</button>
          {t.is_active
            ? <button onClick={() => call({ action: "deactivate" }, "Deactivated.")} disabled={busy} className="btn btn-secondary"><Power size={14} /> Deactivate</button>
            : <button onClick={() => call({ action: "activate" }, "Activated.")} disabled={busy} className="btn btn-secondary"><Power size={14} /> Activate</button>}
          <button onClick={() => call({ name, use_case: useCase, message_type: messageType, gateway_template_id: dlt, body_template: body, sender_id: senderId, route, is_active: active }, "Saved.")} disabled={busy || !name.trim() || !dlt.trim() || !body.trim()} className="btn btn-primary">{busy ? "…" : "Save changes"}</button>
        </div>
      </div>
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

// ============================ VARIABLES ============================
interface GlobalVar {
  key: string; label: string; kind: string; description: string;
  value: string; effective: string; isDefault: boolean;
  updated_by: string | null; updated_at: string | null;
  usedBy: { id: string; name: string }[];
}
interface TplVars {
  id: string; name: string; use_case: string; variables: string[];
  overrides: Record<string, string>; updated_by: string | null; updated_at: string | null;
}

function isHttpUrl(v: string): boolean {
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}

function VariablesTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [globals, setGlobals] = useState<GlobalVar[]>([]);
  const [templates, setTemplates] = useState<TplVars[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/sms/variables").then((r) => r.json())
      .then((d) => { if (d.ok) { setGlobals(d.globals); setTemplates(d.templates); } })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (scope: string, key: string, value: string) => {
    const r = await fetch("/api/admin/sms/variables", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, key, value }) }).then((x) => x.json());
    if (r.ok) { toast("Saved — new sends and previews use this value immediately.", "success"); load(); }
    else toast(r.error || "Save failed", "error");
    return !!r.ok;
  }, [toast, load]);

  if (loading) return <LoadingBlock />;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-line bg-surface p-3 text-xs text-muted">
        Variables fill the <code className="font-mono">{"{token}"}</code> slots inside template bodies at send time. Change a value here and it applies to the next send and to Send&nbsp;→&nbsp;Preview — no code change or redeploy. <span className="text-ink2">Global</span> values are shared across templates; <span className="text-ink2">per-template</span> overrides win over the global.
      </div>
      {!canEdit && <p className="text-xs text-amber-700">Only a Super Admin can edit variables. Values below are read-only.</p>}

      <section className="space-y-3">
        <h2 className="font-heading text-xs font-bold uppercase tracking-wide text-muted">Global variables</h2>
        {globals.length === 0 ? <p className="text-sm text-muted">No global variables.</p> : globals.map((g) => (
          <GlobalVarRow key={g.key} g={g} canEdit={canEdit} onSave={save} />
        ))}
      </section>

      <PerTemplateOverrides templates={templates} canEdit={canEdit} onSave={save} />
    </div>
  );
}

function GlobalVarRow({ g, canEdit, onSave }: { g: GlobalVar; canEdit: boolean; onSave: (scope: string, key: string, value: string) => Promise<boolean>; }) {
  const [val, setVal] = useState(g.value || "");
  const [busy, setBusy] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  useEffect(() => { setVal(g.value || ""); }, [g.value]);

  const dirty = val.trim() !== (g.value || "").trim();
  const invalid = g.kind === "url" && val.trim() !== "" && !isHttpUrl(val.trim());

  async function commit(value: string) { setBusy(true); await onSave("global", g.key, value); setBusy(false); }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            {g.kind === "url" && <Link2 size={14} className="text-muted" />}{g.label}
            <code className="rounded bg-surface2 px-1 py-0.5 font-mono text-[11px] text-ink2">{`{${g.key}}`}</code>
          </p>
          <p className="mt-0.5 text-xs text-muted">{g.description}</p>
        </div>
        <span className={`pill shrink-0 text-[10px] ${g.isDefault ? "pill-gray" : "pill-green"}`}>{g.isDefault ? "using default" : "custom"}</span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="input font-mono text-sm" value={val} onChange={(e) => setVal(e.target.value)} disabled={!canEdit || busy} placeholder={g.effective} />
        <div className="flex gap-2">
          <button onClick={() => commit(val.trim())} disabled={!canEdit || busy || !dirty || invalid} className="btn btn-primary shrink-0">{busy ? "…" : "Save"}</button>
          {!g.isDefault && <button onClick={() => commit("")} disabled={!canEdit || busy} className="btn btn-secondary shrink-0" title="Revert to default"><RotateCcw size={14} /></button>}
        </div>
      </div>
      {invalid && <p className="text-xs text-danger">Enter a well-formed http(s) URL.</p>}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span>Effective now: <code className="font-mono text-ink2">{g.effective}</code></span>
        {g.updated_at && <span>· Updated {g.updated_by ? `by ${g.updated_by} ` : ""}{formatISTDateTime(g.updated_at)}</span>}
      </div>

      <div>
        <button onClick={() => setShowUsers((s) => !s)} className="text-xs font-medium text-primary">
          Used by {g.usedBy.length} template{g.usedBy.length === 1 ? "" : "s"} {showUsers ? "▲" : "▼"}
        </button>
        {showUsers && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {g.usedBy.length === 0 ? <span className="text-xs text-muted">None.</span> : g.usedBy.map((t) => <span key={t.id} className="pill pill-blue text-[10px]">{t.name}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

const overriddenKeys = (t: TplVars): string[] =>
  Object.keys(t.overrides || {}).filter((k) => (t.overrides[k] ?? "").trim() !== "");

function PerTemplateOverrides({ templates, canEdit, onSave }: { templates: TplVars[]; canEdit: boolean; onSave: (scope: string, key: string, value: string) => Promise<boolean>; }) {
  const withVars = templates.filter((t) => t.variables.length > 0);
  // ITEM 5: surface ONLY the overrides that actually exist — not every slot of
  // every template. Same source of truth as the send path (sms_variables scopes).
  const active = templates.map((t) => ({ t, keys: overriddenKeys(t) })).filter((x) => x.keys.length > 0);

  return (
    <section className="space-y-3">
      <h2 className="font-heading text-xs font-bold uppercase tracking-wide text-muted">Per-template overrides</h2>
      <p className="text-xs text-muted">Only variables you&apos;ve customised are shown — every other slot uses the global / default. An override is the exact value sent (it is never replaced by an audience value).</p>

      {active.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface p-3 text-sm text-muted">No per-template overrides set. Add one below to pin a variable for a single template.</p>
      ) : (
        <div className="space-y-3">
          {active.map(({ t, keys }) => (
            <div key={t.id} className="card space-y-3 p-4">
              <p className="text-sm font-semibold">{t.name} <span className="pill pill-green ml-1 text-[10px]">{keys.length} override{keys.length === 1 ? "" : "s"}</span></p>
              {keys.map((k) => (
                <TplVarRow key={`${t.id}:${k}`} tid={t.id} k={k} value={t.overrides[k] || ""} canEdit={canEdit} onSave={onSave} />
              ))}
              {t.updated_at && <p className="text-xs text-muted">Updated {t.updated_by ? `by ${t.updated_by} ` : ""}{formatISTDateTime(t.updated_at)}</p>}
            </div>
          ))}
        </div>
      )}

      {canEdit && <AddOverride templates={withVars} onSave={onSave} />}
    </section>
  );
}

/** Add a NEW per-template override: pick template → pick an un-overridden variable → value. */
function AddOverride({ templates, onSave }: { templates: TplVars[]; onSave: (scope: string, key: string, value: string) => Promise<boolean>; }) {
  const [tid, setTid] = useState("");
  const [key, setKey] = useState("");
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const sel = templates.find((t) => t.id === tid);
  const addable = sel ? sel.variables.filter((k) => (sel.overrides[k] ?? "").trim() === "") : [];
  const looksUrl = key === "login_url" || key.endsWith("_url");
  const invalid = looksUrl && val.trim() !== "" && !isHttpUrl(val.trim());

  async function add() {
    if (!tid || !key || !val.trim()) return;
    setBusy(true);
    const ok = await onSave(tid, key, val.trim());
    setBusy(false);
    if (ok) { setKey(""); setVal(""); }
  }

  return (
    <div className="card space-y-3 p-4">
      <p className="text-sm font-semibold">Add an override</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select className="input sm:max-w-[220px]" value={tid} onChange={(e) => { setTid(e.target.value); setKey(""); }}>
          <option value="">Select a template…</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="input sm:max-w-[180px]" value={key} onChange={(e) => setKey(e.target.value)} disabled={!sel}>
          <option value="">{sel ? "Variable…" : "Pick template first"}</option>
          {addable.map((k) => <option key={k} value={k}>{`{${k}}`}</option>)}
        </select>
        <input className="input font-mono text-sm" value={val} onChange={(e) => setVal(e.target.value)} disabled={!key} placeholder="value to send" />
        <button onClick={add} disabled={busy || !tid || !key || !val.trim() || invalid} className="btn btn-primary shrink-0">{busy ? "…" : "Add"}</button>
      </div>
      {sel && addable.length === 0 && <p className="text-xs text-muted">Every variable for this template already has an override.</p>}
      {invalid && <p className="text-xs text-danger">Enter a well-formed http(s) URL.</p>}
    </div>
  );
}

function TplVarRow({ tid, k, value, canEdit, onSave }: { tid: string; k: string; value: string; canEdit: boolean; onSave: (scope: string, key: string, value: string) => Promise<boolean>; }) {
  const [val, setVal] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setVal(value); }, [value, tid]);

  const dirty = val.trim() !== value.trim();
  const looksUrl = k === "login_url" || k.endsWith("_url");
  const invalid = looksUrl && val.trim() !== "" && !isHttpUrl(val.trim());

  async function commit(v: string) { setBusy(true); await onSave(tid, k, v); setBusy(false); }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <code className="shrink-0 font-mono text-xs text-ink2 sm:w-36">{`{${k}}`}</code>
      <input className="input font-mono text-sm" value={val} onChange={(e) => setVal(e.target.value)} disabled={!canEdit || busy} placeholder="inherit global / default" />
      <div className="flex gap-2">
        <button onClick={() => commit(val.trim())} disabled={!canEdit || busy || !dirty || invalid} className="btn btn-primary shrink-0">{busy ? "…" : "Save"}</button>
        {value && <button onClick={() => commit("")} disabled={!canEdit || busy} className="btn btn-secondary shrink-0" title="Clear override"><RotateCcw size={14} /></button>}
      </div>
      {invalid && <p className="text-xs text-danger">Well-formed http(s) URL required.</p>}
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
        <SmsSendsOverTime data={data.sendsOverTime} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <p className="mb-2 text-sm font-semibold">Submitted &amp; delivered by template</p>
          <ul className="space-y-1.5 text-sm">{data.deliveryByTemplate.map((t: any) => (<li key={t.template} className="flex justify-between gap-2"><span className="truncate text-ink2">{t.name}</span><span className="shrink-0 tabular-nums">{t.submitted}/{t.total} submitted{data.deliveryKnown ? ` · ${t.delivered} delivered (${t.deliveryRate}%)` : ""}</span></li>))}{data.deliveryByTemplate.length === 0 && <li className="text-muted">No sends yet.</li>}</ul>
          {!data.deliveryKnown && <p className="mt-2 text-xs text-muted">Delivery % appears once DLR receipts are enabled on the gateway.</p>}
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
          <Field label="Cost per SMS (Rs / segment)"><input type="number" step="0.01" className="input" value={form.costPerSms ?? 0.13} onChange={(e) => setForm({ ...form, costPerSms: Number(e.target.value) })} disabled={!canEdit} /></Field>
        </div>
        {canEdit ? <button onClick={save} disabled={busy} className="btn btn-primary">{busy ? "…" : "Save settings"}</button> : <p className="text-xs text-muted">Only a Super Admin can change settings.</p>}
      </div>

      <div className="lg:col-span-2"><OptOutsCard canEdit={canEdit} /></div>
    </div>
  );
}

// Opt-out / DND suppression manager (compliance). Suppressed numbers are skipped
// on EVERY send path (service-enforced) — this is the admin surface for it.
function OptOutsCard({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<{ normalized_mobile: string; reason: string | null; source: string; created_at: string }[]>([]);
  const [mobile, setMobile] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { fetch("/api/admin/sms/opt-outs").then((r) => r.json()).then((d) => d.ok && setRows(d.optOuts)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!mobile.trim()) return;
    setBusy(true);
    const r = await fetch("/api/admin/sms/opt-outs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mobile: mobile.trim(), reason: reason.trim() || null }) }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    if (r?.ok) { setRows(r.optOuts); setMobile(""); setReason(""); toast("Added to opt-out list.", "success"); } else toast(r?.error || "Add failed", "error");
  }
  async function remove(m: string) {
    if (!confirm(`Remove ${m} from the opt-out list? They can be messaged again.`)) return;
    const r = await fetch(`/api/admin/sms/opt-outs?mobile=${encodeURIComponent(m)}`, { method: "DELETE" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) { setRows(r.optOuts); toast("Removed.", "success"); } else toast("Remove failed", "error");
  }

  return (
    <div className="card space-y-3 p-4">
      <div>
        <p className="text-sm font-semibold">Opt-out / DND suppression <span className="pill pill-gray ml-1 text-[10px]">{rows.length}</span></p>
        <p className="mt-0.5 text-xs text-muted">These numbers are skipped on <b>every</b> send — manual, bulk, automation and resend. An inbound STOP-keyword webhook would add here automatically (source <code className="font-mono">sms_stop</code>).</p>
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <input className="input w-40" placeholder="10-digit mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          <input className="input flex-1" placeholder="reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button onClick={add} disabled={busy || !mobile.trim()} className="btn btn-primary shrink-0">{busy ? "…" : "Add opt-out"}</button>
        </div>
      )}
      {rows.length === 0 ? <p className="text-sm text-muted">No opt-outs. 🎉</p> : (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted"><th className="px-3 py-2">Mobile</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Since</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.normalized_mobile} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-1.5 font-mono text-xs">{r.normalized_mobile}</td>
                  <td className="px-3 py-1.5 text-xs text-ink2">{r.reason || "—"}</td>
                  <td className="px-3 py-1.5 text-xs text-muted">{r.source}</td>
                  <td className="px-3 py-1.5 text-xs text-muted">{formatISTDateTime(r.created_at)}</td>
                  <td className="px-3 py-1.5 text-right">{canEdit && <button onClick={() => remove(r.normalized_mobile)} className="btn btn-secondary text-xs"><Trash2 size={12} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
function ModePill({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ size?: number | string }>; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? "border-primary bg-primary/10 text-primary" : "border-line text-muted hover:text-ink"}`}>
      <Icon size={13} /> {label}
    </button>
  );
}
function EnvRow({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return <div className="flex items-center justify-between text-sm"><span className="text-ink2">{label}</span><span className={`inline-flex items-center gap-1 text-xs ${ok ? "text-success" : "text-amber-700"}`}>{ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{text}</span></div>;
}
