"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ShieldAlert, PlayCircle, FlaskConical, ListChecks, BarChart3,
  RefreshCw, AlertTriangle, CheckCircle2, Ban, Send,
} from "lucide-react";
import { PageHeader, KpiCard, LoadingBlock } from "@/components/admin/ui";

type ExecutionMode = "off" | "simulate" | "live";
type Tab = "execution" | "dryrun" | "runs" | "analytics";

interface Perms { canManageExecution: boolean; canManageCategories: boolean }

interface RuntimeSummary {
  workflow: { id: string; name: string; status: string; execution_mode: ExecutionMode; published_version: number | null; canary_max_enrollments: number | null; canary_test_phones: string[] | null } | null;
  killSwitchEngaged: boolean;
  pausedCategories: string[];
  counts: { active: number; completed: number; goal_met: number; exited: number; cancelled: number; failed: number; total: number };
  queue: { queued: number; running: number; dead: number };
}
interface EnrollmentView { id: string; phoneMasked: string; status: string; mode: string; current_node_key: string | null; goal_met: boolean; exit_reason: string | null; enrolled_at: string; completed_at: string | null }
interface JobView { id: string; node_key: string; status: string; scheduled_for: string; attempts: number; max_attempts: number; dead_letter: boolean; last_error: string | null }
interface StaffTask { id: string; title: string; assignee: string | null; status: string; mode: string; created_at: string }
interface NodeRun { id: string; node_key: string; node_type: string; status: string; mode: string; resolved_variables: Record<string, unknown>; outcome: Record<string, unknown>; idempotency_key: string | null }
interface DryRunSend { phoneMasked: string; templateId: string; category: string; nodeKey: string; variables: Record<string, unknown>; idempotencyKey: string; wouldSendLive: boolean; decisionReason: string }
interface DryRunReport { workflowName: string; executionMode: string; triggerEventType: string | null; sampledEvents: number; eligible: number; excluded: Record<string, number>; suppressed: number; branchDistribution: Record<string, { yes: number; no: number }>; goalsProjected: number; wouldSend: DryRunSend[]; actualSends: number }
interface NodeStat { node_key: string; node_type: string; entered: number; passed: number; suppressed: number; simulated: number; sent: number; failed: number }
interface Analytics { funnel: { entered: number; active: number; completed: number; converted: number; exitedEarly: number; failed: number }; messages: { wouldSend: number; sent: number; suppressed: number }; goalConversions: number; conversionRatePct: number; avgConversionHours: number | null; revenue: { attributed: number; attributedCount: number; source: string; note: string }; costs: { smsCost: number; revenuePer1000: number | null; rocs: number | null; note: string }; nodeStats: NodeStat[] }

const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

const MODE_PILL: Record<ExecutionMode, string> = { off: "pill-gray", simulate: "pill-blue", live: "pill-green" };
const STATUS_PILL: Record<string, string> = { active: "pill-blue", completed: "pill-gray", goal_met: "pill-green", exited: "pill-gray", cancelled: "pill-amber", failed: "pill-red", queued: "pill-blue", running: "pill-amber", dead: "pill-red", done: "pill-green", simulated: "pill-blue", sent: "pill-green", suppressed: "pill-amber", skipped: "pill-gray" };

export default function JourneyOperate({ workflowId, perms }: { workflowId: string; perms: Perms }) {
  const [tab, setTab] = useState<Tab>("execution");
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<RuntimeSummary | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentView[]>([]);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [deadLetters, setDeadLetters] = useState<JobView[]>([]);
  const [staffTasks, setStaffTasks] = useState<StaffTask[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [dryRun, setDryRun] = useState<DryRunReport | null>(null);
  const [dryRunning, setDryRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [nodeRuns, setNodeRuns] = useState<Record<string, NodeRun[]>>({});
  const [openEnrollment, setOpenEnrollment] = useState<string | null>(null);

  // canary inputs
  const [canaryMax, setCanaryMax] = useState<string>("");
  const [canaryPhones, setCanaryPhones] = useState<string>("");

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const loadRuntime = useCallback(async () => {
    const r = await fetch(`/api/admin/journey-automation/workflows/${workflowId}/runtime`).then((x) => x.json()).catch(() => null);
    if (r?.ok) {
      setSummary(r.summary); setEnrollments(r.enrollments ?? []); setJobs(r.jobs ?? []);
      setDeadLetters(r.deadLetters ?? []); setStaffTasks(r.staffTasks ?? []);
      const wf = r.summary?.workflow;
      setCanaryMax(wf?.canary_max_enrollments != null ? String(wf.canary_max_enrollments) : "");
      setCanaryPhones(Array.isArray(wf?.canary_test_phones) ? wf.canary_test_phones.join(", ") : "");
    }
  }, [workflowId]);

  const loadAnalytics = useCallback(async () => {
    const r = await fetch(`/api/admin/journey-automation/workflows/${workflowId}/analytics`).then((x) => x.json()).catch(() => null);
    if (r?.ok) setAnalytics(r.analytics);
  }, [workflowId]);

  useEffect(() => { (async () => { setLoading(true); await Promise.all([loadRuntime(), loadAnalytics()]); setLoading(false); })(); }, [loadRuntime, loadAnalytics]);

  async function setMode(mode: ExecutionMode) {
    if (!perms.canManageExecution || busy) return;
    if (mode === "live" && !window.confirm("Set execution to LIVE?\n\nThis does NOT send by itself — live sending also requires the server SMS/execution flags, which stay OFF this shipment. With flags off, 'live' still only simulates. Proceed?")) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { mode };
      const r = await fetch(`/api/admin/journey-automation/workflows/${workflowId}/execution`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
      if (r?.ok) { flash(`Execution mode → ${mode}${r.cancelledJobs ? ` (cancelled ${r.cancelledJobs} jobs)` : ""}`); await loadRuntime(); }
      else flash(r?.error ?? "Failed");
    } finally { setBusy(false); }
  }

  async function saveCanary() {
    if (!perms.canManageExecution || busy) return;
    setBusy(true);
    try {
      const canaryMaxEnrollments = canaryMax.trim() === "" ? null : Number(canaryMax);
      const canaryTestPhones = canaryPhones.trim() === "" ? null : canaryPhones.split(",").map((s) => s.trim()).filter(Boolean);
      const mode = summary?.workflow?.execution_mode ?? "off";
      const r = await fetch(`/api/admin/journey-automation/workflows/${workflowId}/execution`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, canaryMaxEnrollments, canaryTestPhones }) }).then((x) => x.json());
      if (r?.ok) { flash("Canary settings saved"); await loadRuntime(); } else flash(r?.error ?? "Failed");
    } finally { setBusy(false); }
  }

  async function toggleCategory(category: string, paused: boolean) {
    if (!perms.canManageCategories || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/journey-automation/categories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, paused }) }).then((x) => x.json());
      if (r?.ok) { flash(`${category} ${paused ? "paused" : "resumed"}`); await loadRuntime(); } else flash(r?.error ?? "Failed");
    } finally { setBusy(false); }
  }

  async function runDryRun() {
    if (dryRunning) return;
    setDryRunning(true);
    try {
      const r = await fetch(`/api/admin/journey-automation/workflows/${workflowId}/dry-run`, { method: "POST" }).then((x) => x.json());
      if (r?.ok) setDryRun(r.report); else flash(r?.error ?? "Dry-run failed");
    } finally { setDryRunning(false); }
  }

  async function retryJob(jobId: string) {
    if (!perms.canManageExecution || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/journey-automation/jobs/${jobId}/retry`, { method: "POST" }).then((x) => x.json());
      flash(r?.requeued ? "Job re-enqueued (guards still apply)" : (r?.reason ?? "No change"));
      await loadRuntime();
    } finally { setBusy(false); }
  }

  async function openRuns(enrollmentId: string) {
    if (openEnrollment === enrollmentId) { setOpenEnrollment(null); return; }
    setOpenEnrollment(enrollmentId);
    if (!nodeRuns[enrollmentId]) {
      const r = await fetch(`/api/admin/journey-automation/workflows/${workflowId}/runtime?enrollment=${enrollmentId}`).then((x) => x.json()).catch(() => null);
      if (r?.ok) setNodeRuns((prev) => ({ ...prev, [enrollmentId]: r.nodeRuns ?? [] }));
    }
  }

  if (loading) return (<><PageHeader title="Journey Operations" subtitle="Execution, dry-run, runs & analytics." /><LoadingBlock /></>);

  const wf = summary?.workflow;
  const mode = wf?.execution_mode ?? "off";

  const TABS: [Tab, string, React.ReactNode][] = [
    ["execution", "Execution & canary", <PlayCircle key="i" size={15} />],
    ["dryrun", "Dry-run", <FlaskConical key="i" size={15} />],
    ["runs", "Runs & queue", <ListChecks key="i" size={15} />],
    ["analytics", "Analytics", <BarChart3 key="i" size={15} />],
  ];

  return (
    <>
      <PageHeader
        title={wf?.name ?? "Journey Operations"}
        subtitle="Execution control, dry-run review, run monitoring & analytics — nothing sends this shipment."
        action={
          <div className="flex items-center gap-2">
            <span className={`pill ${MODE_PILL[mode]}`}>Mode: {mode}</span>
            <Link href={`/admin/communications/journey-automation/${workflowId}`} className="btn btn-ghost"><ArrowLeft size={15} /> Builder</Link>
          </div>
        }
      />

      {/* Global "sending is OFF" banner */}
      <div className="mb-5 rounded-xl border p-4" style={{ borderColor: "var(--gold)", background: "var(--gold-soft)" }}>
        <div className="flex items-start gap-3">
          <ShieldAlert size={20} style={{ color: "var(--gold)" }} aria-hidden />
          <div className="text-sm">
            <p className="font-heading font-bold" style={{ color: "var(--navy, #0a1f44)" }}>Live sending is OFF platform-wide</p>
            <p className="mt-0.5 text-ink2">
              Only <b>live</b> mode <i>and</i> the server SMS/execution flags together send — and those flags stay OFF this shipment.
              With flags off, even a <b>live</b> workflow only records a would-send. Everything here is control, review and read-only analytics.
              {summary?.killSwitchEngaged && <span className="ml-1 font-semibold" style={{ color: "var(--danger)" }}>Global kill switch is ENGAGED — all execution halted.</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-2 border-b border-line">
        {TABS.map(([id, label, icon]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${tab === id ? "border-[var(--primary)] text-[var(--primary)]" : "border-transparent text-ink2 hover:text-ink"}`}>
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === "execution" && (
        <ExecutionTab
          mode={mode} perms={perms} busy={busy} wf={wf ?? null} summary={summary}
          canaryMax={canaryMax} setCanaryMax={setCanaryMax} canaryPhones={canaryPhones} setCanaryPhones={setCanaryPhones}
          onSetMode={setMode} onSaveCanary={saveCanary} onToggleCategory={toggleCategory}
        />
      )}

      {tab === "dryrun" && (
        <DryRunTab report={dryRun} running={dryRunning} onRun={runDryRun} />
      )}

      {tab === "runs" && (
        <RunsTab
          summary={summary} enrollments={enrollments} jobs={jobs} deadLetters={deadLetters} staffTasks={staffTasks}
          nodeRuns={nodeRuns} openEnrollment={openEnrollment} onOpen={openRuns}
          canRetry={perms.canManageExecution} onRetry={retryJob} onRefresh={loadRuntime}
        />
      )}

      {tab === "analytics" && <AnalyticsTab a={analytics} />}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg" style={{ background: "var(--navy, #0a1f44)" }}>{toast}</div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function ExecutionTab(props: {
  mode: ExecutionMode; perms: Perms; busy: boolean;
  wf: RuntimeSummary["workflow"]; summary: RuntimeSummary | null;
  canaryMax: string; setCanaryMax: (v: string) => void; canaryPhones: string; setCanaryPhones: (v: string) => void;
  onSetMode: (m: ExecutionMode) => void; onSaveCanary: () => void; onToggleCategory: (c: string, p: boolean) => void;
}) {
  const { mode, perms, busy, wf, summary, canaryMax, setCanaryMax, canaryPhones, setCanaryPhones, onSetMode, onSaveCanary, onToggleCategory } = props;
  const MODES: [ExecutionMode, string, string][] = [
    ["off", "Off", "Engine ignores this workflow entirely. Nobody enrolls. (Default & safest.)"],
    ["simulate", "Simulate", "Enrolls real contacts and runs the graph, recording would-sends. Sends NOTHING."],
    ["live", "Live", "Attempts real sends — but ONLY if the server flags are on (they are OFF this shipment, so still simulates)."],
  ];
  const categories = ["payment_reminder", "promotional", "transactional"];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="font-heading text-base font-bold">Execution mode</h2>
        <p className="mt-1 text-xs text-muted">{perms.canManageExecution ? "Restricted control — every change is audited." : "You do not have the execution-management permission (read-only)."}</p>
        <div className="mt-3 space-y-2">
          {MODES.map(([id, label, desc]) => (
            <button key={id} type="button" disabled={!perms.canManageExecution || busy || mode === id} onClick={() => onSetMode(id)}
              className={`w-full rounded-lg border p-3 text-left transition ${mode === id ? "border-[var(--primary)] bg-[var(--primary-tint)]" : "border-line hover:border-[var(--primary)]"} ${!perms.canManageExecution ? "opacity-70" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{label}</span>
                {mode === id && <span className="pill pill-green">Current</span>}
              </div>
              <p className="mt-0.5 text-xs text-ink2">{desc}</p>
            </button>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-line p-3 opacity-70">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium"><Send size={14} /> Test send</span>
            <span className="pill pill-gray">Disabled</span>
          </div>
          <p className="mt-0.5 text-xs text-muted">Enabled only once execution + SMS flags are truly on. Off this shipment.</p>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-heading text-base font-bold">Canary controls</h2>
        <p className="mt-1 text-xs text-muted">Bound blast radius before widening: cap enrollments and/or restrict to staff-test numbers.</p>
        <label className="mt-3 block text-sm font-medium">Max enrollments (blank = unlimited)</label>
        <input type="number" min={0} value={canaryMax} onChange={(e) => setCanaryMax(e.target.value)} disabled={!perms.canManageExecution} className="input mt-1 w-full" placeholder="e.g. 25" />
        <label className="mt-3 block text-sm font-medium">Staff-test phones (comma-separated 10-digit)</label>
        <textarea value={canaryPhones} onChange={(e) => setCanaryPhones(e.target.value)} disabled={!perms.canManageExecution} className="input mt-1 w-full" rows={2} placeholder="9876543210, 9811122233" />
        <p className="mt-1 text-xs text-muted">When set, ONLY these numbers can enroll — ideal for a staff-test canary.</p>
        {perms.canManageExecution && <button type="button" className="btn btn-primary mt-3" disabled={busy} onClick={onSaveCanary}>Save canary settings</button>}

        <h3 className="mt-5 font-heading text-sm font-bold">Category pause</h3>
        <p className="mt-1 text-xs text-muted">Halt a whole message category across all workflows (independent of the global kill switch).</p>
        <div className="mt-2 space-y-1.5">
          {categories.map((c) => {
            const paused = summary?.pausedCategories?.includes(c) ?? false;
            return (
              <div key={c} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                <span className="capitalize">{c.replace(/_/g, " ")}</span>
                <div className="flex items-center gap-2">
                  <span className={`pill ${paused ? "pill-amber" : "pill-green"}`}>{paused ? "Paused" : "Active"}</span>
                  {perms.canManageCategories && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onToggleCategory(c, !paused)}>{paused ? "Resume" : "Pause"}</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DryRunTab({ report, running, onRun }: { report: DryRunReport | null; running: boolean; onRun: () => void }) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-ink2">Projects the published graph over the REAL recent event stream. Zero sends, zero writes — the review artifact before any canary.</p>
        <button type="button" className="btn btn-primary" disabled={running} onClick={onRun}><FlaskConical size={15} /> {running ? "Running…" : "Run dry-run"}</button>
      </div>
      {!report ? (
        <div className="card p-10 text-center text-sm text-muted">Run a dry-run to see eligible/excluded counts, branch distribution and the exact messages that WOULD send.</div>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2">
            <span className="pill pill-green inline-flex items-center gap-1"><CheckCircle2 size={13} /> {report.actualSends} actually sent</span>
            <span className="pill pill-blue">{report.sampledEvents} events sampled</span>
            <span className="pill pill-gray">trigger: {report.triggerEventType ?? "—"}</span>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Eligible" value={report.eligible} tone="green" />
            <KpiCard label="Would-send" value={report.wouldSend.length} tone="blue" />
            <KpiCard label="Suppressed" value={report.suppressed} tone="amber" />
            <KpiCard label="Goals projected" value={report.goalsProjected} tone="blue" />
          </div>
          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h3 className="font-heading text-sm font-bold">Excluded</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(report.excluded).filter(([, v]) => v > 0).length === 0 && <li className="text-muted">None</li>}
                {Object.entries(report.excluded).filter(([, v]) => v > 0).map(([k, v]) => (
                  <li key={k} className="flex justify-between"><span className="text-ink2 capitalize">{k.replace(/_/g, " ")}</span><span className="tabular-nums">{v}</span></li>
                ))}
              </ul>
            </div>
            <div className="card p-4">
              <h3 className="font-heading text-sm font-bold">Branch distribution</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {Object.keys(report.branchDistribution).length === 0 && <li className="text-muted">No condition nodes</li>}
                {Object.entries(report.branchDistribution).map(([k, v]) => (
                  <li key={k} className="flex justify-between"><span className="text-ink2">{k}</span><span className="tabular-nums">yes {v.yes} · no {v.no}</span></li>
                ))}
              </ul>
            </div>
          </div>
          <div className="card overflow-hidden">
            <div className="border-b border-line px-4 py-3"><h3 className="font-heading text-sm font-bold">Messages that WOULD send ({report.wouldSend.length}) — none sent</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface)] text-left text-xs uppercase text-muted">
                  <tr><th className="px-4 py-2">Recipient</th><th className="px-4 py-2">Template</th><th className="px-4 py-2">Category</th><th className="px-4 py-2">Decision</th><th className="px-4 py-2">Variables</th></tr>
                </thead>
                <tbody>
                  {report.wouldSend.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No messages would send.</td></tr>}
                  {report.wouldSend.slice(0, 100).map((s, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 tabular-nums">{s.phoneMasked}</td>
                      <td className="px-4 py-2">{s.templateId || "—"}</td>
                      <td className="px-4 py-2 capitalize">{s.category.replace(/_/g, " ")}</td>
                      <td className="px-4 py-2"><span className={`pill ${s.wouldSendLive ? "pill-green" : "pill-blue"}`}>{s.wouldSendLive ? "live" : "simulate"}</span> <span className="text-xs text-muted">{s.decisionReason}</span></td>
                      <td className="px-4 py-2 text-xs text-ink2">{Object.keys(s.variables).length ? JSON.stringify(s.variables) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RunsTab(props: {
  summary: RuntimeSummary | null; enrollments: EnrollmentView[]; jobs: JobView[]; deadLetters: JobView[]; staffTasks: StaffTask[];
  nodeRuns: Record<string, NodeRun[]>; openEnrollment: string | null; onOpen: (id: string) => void;
  canRetry: boolean; onRetry: (id: string) => void; onRefresh: () => void;
}) {
  const { summary, enrollments, jobs, deadLetters, staffTasks, nodeRuns, openEnrollment, onOpen, canRetry, onRetry, onRefresh } = props;
  const c = summary?.counts;
  const q = summary?.queue;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="pill pill-blue">Active {c?.active ?? 0}</span>
          <span className="pill pill-green">Converted {c?.goal_met ?? 0}</span>
          <span className="pill pill-gray">Completed {c?.completed ?? 0}</span>
          <span className="pill pill-amber">Cancelled {c?.cancelled ?? 0}</span>
          <span className="pill pill-red">Failed {c?.failed ?? 0}</span>
          <span className="pill pill-blue">Queue {q?.queued ?? 0}</span>
          <span className="pill pill-red">Dead {q?.dead ?? 0}</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}><RefreshCw size={14} /> Refresh</button>
      </div>

      {deadLetters.length > 0 && (
        <div className="card mb-4 overflow-hidden border-2" style={{ borderColor: "var(--danger)" }}>
          <div className="flex items-center gap-2 border-b border-line px-4 py-3"><AlertTriangle size={16} style={{ color: "var(--danger)" }} /><h3 className="font-heading text-sm font-bold">Dead-letter queue ({deadLetters.length})</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface)] text-left text-xs uppercase text-muted"><tr><th className="px-4 py-2">Node</th><th className="px-4 py-2">Attempts</th><th className="px-4 py-2">Error</th><th className="px-4 py-2"></th></tr></thead>
              <tbody>
                {deadLetters.map((j) => (
                  <tr key={j.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">{j.node_key}</td>
                    <td className="px-4 py-2 tabular-nums">{j.attempts}/{j.max_attempts}</td>
                    <td className="px-4 py-2 text-xs text-ink2">{j.last_error ?? "—"}</td>
                    <td className="px-4 py-2 text-right">{canRetry && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRetry(j.id)}><RefreshCw size={13} /> Retry</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-muted">Retry re-enqueues only. The re-run passes through all guards (latest-state revalidation + send gate) — it cannot bypass compliance or send in simulation.</p>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3"><h3 className="font-heading text-sm font-bold">Enrollments ({enrollments.length})</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface)] text-left text-xs uppercase text-muted"><tr><th className="px-4 py-2">Contact</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Mode</th><th className="px-4 py-2">Node</th><th className="px-4 py-2">Exit</th><th className="px-4 py-2">Enrolled</th></tr></thead>
            <tbody>
              {enrollments.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No enrollments yet.</td></tr>}
              {enrollments.map((e) => (
                <>
                  <tr key={e.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-[var(--surface)]" onClick={() => onOpen(e.id)}>
                    <td className="px-4 py-2 tabular-nums">{e.phoneMasked}</td>
                    <td className="px-4 py-2"><span className={`pill ${STATUS_PILL[e.status] ?? "pill-gray"}`}>{e.status}</span></td>
                    <td className="px-4 py-2">{e.mode}</td>
                    <td className="px-4 py-2">{e.current_node_key ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-ink2">{e.exit_reason ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-ink2">{fmt(e.enrolled_at)}</td>
                  </tr>
                  {openEnrollment === e.id && (
                    <tr key={`${e.id}-d`}><td colSpan={6} className="bg-[var(--surface)] px-4 py-3">
                      <p className="mb-2 text-xs font-semibold uppercase text-muted">Node runs (resolved variables exclude secrets)</p>
                      {(nodeRuns[e.id] ?? []).length === 0 ? <p className="text-sm text-muted">No node runs recorded.</p> : (
                        <div className="space-y-1.5">
                          {(nodeRuns[e.id] ?? []).map((nr) => (
                            <div key={nr.id} className="rounded-lg border border-line bg-white p-2 text-xs">
                              <div className="flex items-center gap-2"><span className="font-semibold">{nr.node_key}</span><span className="text-muted">({nr.node_type})</span><span className={`pill ${STATUS_PILL[nr.status] ?? "pill-gray"}`}>{nr.status}</span></div>
                              {Object.keys(nr.resolved_variables ?? {}).length > 0 && <div className="mt-1 text-ink2">vars: {JSON.stringify(nr.resolved_variables)}</div>}
                              {Object.keys(nr.outcome ?? {}).length > 0 && <div className="mt-0.5 text-ink2">outcome: {JSON.stringify(nr.outcome)}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </td></tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3"><h3 className="font-heading text-sm font-bold">Job queue ({jobs.length})</h3></div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-[var(--surface)] text-left text-xs uppercase text-muted"><tr><th className="px-4 py-2">Node</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">When</th><th className="px-4 py-2">Att.</th></tr></thead>
            <tbody>
              {jobs.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted">No jobs.</td></tr>}
              {jobs.slice(0, 50).map((j) => (
                <tr key={j.id} className="border-b border-line last:border-0"><td className="px-4 py-2">{j.node_key}</td><td className="px-4 py-2"><span className={`pill ${STATUS_PILL[j.status] ?? "pill-gray"}`}>{j.status}</span></td><td className="px-4 py-2 text-xs text-ink2">{fmt(j.scheduled_for)}</td><td className="px-4 py-2 tabular-nums">{j.attempts}/{j.max_attempts}</td></tr>
              ))}
            </tbody>
          </table></div>
        </div>
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3"><h3 className="font-heading text-sm font-bold">Staff tasks ({staffTasks.length})</h3></div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-[var(--surface)] text-left text-xs uppercase text-muted"><tr><th className="px-4 py-2">Title</th><th className="px-4 py-2">Assignee</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Created</th></tr></thead>
            <tbody>
              {staffTasks.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted">No staff tasks.</td></tr>}
              {staffTasks.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-0"><td className="px-4 py-2">{t.title}</td><td className="px-4 py-2">{t.assignee ?? "—"}</td><td className="px-4 py-2"><span className={`pill ${STATUS_PILL[t.status] ?? "pill-gray"}`}>{t.status}</span></td><td className="px-4 py-2 text-xs text-ink2">{fmt(t.created_at)}</td></tr>
              ))}
            </tbody>
          </table></div>
          <p className="px-4 py-2 text-xs text-muted"><Ban size={12} className="mr-1 inline" />Task records are view-only — recorded, not dispatched (no send path).</p>
        </div>
      </div>
    </div>
  );
}

function AnalyticsTab({ a }: { a: Analytics | null }) {
  if (!a) return <div className="card p-10 text-center text-sm text-muted">No analytics available.</div>;
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Entered" value={a.funnel.entered} tone="blue" />
        <KpiCard label="Active" value={a.funnel.active} tone="amber" />
        <KpiCard label="Converted" value={a.funnel.converted} tone="green" hint={`${a.conversionRatePct}% conversion`} />
        <KpiCard label="Exited early" value={a.funnel.exitedEarly} tone="amber" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Would-send" value={a.messages.wouldSend} tone="blue" hint="simulation" />
        <KpiCard label="Sent" value={a.messages.sent} tone="green" hint="0 in simulation" />
        <KpiCard label="Suppressed" value={a.messages.suppressed} tone="amber" />
        <KpiCard label="Avg convert" value={a.avgConversionHours != null ? `${a.avgConversionHours}h` : "—"} tone="blue" />
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-5">
          <h3 className="font-heading text-sm font-bold">Attributed revenue</h3>
          <p className="mt-1 font-heading text-2xl font-bold" style={{ color: "var(--primary)" }}>{inr(a.revenue.attributed)}</p>
          <p className="text-xs text-muted">{a.revenue.attributedCount} conversions · source: {a.revenue.source}</p>
          <p className="mt-2 text-xs text-ink2">{a.revenue.note}</p>
        </div>
        <div className="card p-5">
          <h3 className="font-heading text-sm font-bold">SMS cost / ROCS</h3>
          <p className="mt-1 font-heading text-2xl font-bold">{inr(a.costs.smsCost)}</p>
          <p className="text-xs text-muted">Rev / 1000: {a.costs.revenuePer1000 != null ? inr(a.costs.revenuePer1000) : "NA"} · ROCS: {a.costs.rocs ?? "NA"}</p>
          <p className="mt-2 text-xs text-ink2">{a.costs.note}</p>
        </div>
        <div className="card p-5">
          <h3 className="font-heading text-sm font-bold">Goal conversions</h3>
          <p className="mt-1 font-heading text-2xl font-bold" style={{ color: "var(--gold)" }}>{a.goalConversions}</p>
          <p className="text-xs text-muted">Reconciles to deriveCollections (ledger truth).</p>
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3"><h3 className="font-heading text-sm font-bold">Per-node stats</h3></div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-[var(--surface)] text-left text-xs uppercase text-muted"><tr><th className="px-4 py-2">Node</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Entered</th><th className="px-4 py-2">Passed</th><th className="px-4 py-2">Suppressed</th><th className="px-4 py-2">Would-send</th><th className="px-4 py-2">Sent</th><th className="px-4 py-2">Failed</th></tr></thead>
          <tbody>
            {a.nodeStats.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-muted">No node activity yet.</td></tr>}
            {a.nodeStats.map((s) => (
              <tr key={s.node_key} className="border-b border-line last:border-0">
                <td className="px-4 py-2">{s.node_key}</td><td className="px-4 py-2">{s.node_type}</td>
                <td className="px-4 py-2 tabular-nums">{s.entered}</td><td className="px-4 py-2 tabular-nums">{s.passed}</td>
                <td className="px-4 py-2 tabular-nums">{s.suppressed}</td><td className="px-4 py-2 tabular-nums">{s.simulated}</td>
                <td className="px-4 py-2 tabular-nums">{s.sent}</td><td className="px-4 py-2 tabular-nums">{s.failed}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
