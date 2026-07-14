"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Workflow, Power, ShieldCheck, Sparkles, Plus } from "lucide-react";
import { PageHeader, KpiCard, TableShell, LoadingBlock } from "@/components/admin/ui";
import type { AutomationWorkflow, WorkflowStatus } from "@/types/journey-automation";
import type { JourneyFlagSnapshot } from "@/lib/journey-automation/flags";

interface KillSwitchState {
  engaged: boolean;
  reason: string | null;
  by: string | null;
  at: string | null;
}

interface OverviewResponse {
  ok: boolean;
  workflows: AutomationWorkflow[];
  flags: JourneyFlagSnapshot;
  killSwitch: KillSwitchState;
}

interface AdminMe {
  permissions?: Record<string, boolean>;
}

const STATUS_PILL: Record<WorkflowStatus, string> = {
  draft: "pill-gray",
  ready: "pill-blue",
  active: "pill-green",
  paused: "pill-amber",
  archived: "pill-gray",
  disabled_by_killswitch: "pill-red",
};

const STATUS_LABEL: Record<WorkflowStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  active: "Active",
  paused: "Paused",
  archived: "Archived",
  disabled_by_killswitch: "Killed",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function JourneyAutomationDashboard() {
  const router = useRouter();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [canKill, setCanKill] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, meRes] = await Promise.all([
        fetch("/api/admin/journey-automation/overview").then((r) => r.json()),
        fetch("/api/admin/me").then((r) => r.json()),
      ]);
      setData(ovRes?.ok ? (ovRes as OverviewResponse) : null);
      const me = (meRes?.admin ?? null) as AdminMe | null;
      setCanKill(me?.permissions?.journey_manage_killswitch === true);
      setCanCreate(me?.permissions?.journey_create_draft === true);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  async function createJourney() {
    if (creating || !canCreate) return;
    const name = window.prompt("Name your new journey:", "Untitled journey");
    if (name == null) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/journey-automation/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Untitled journey" }),
      }).then((r) => r.json());
      if (res?.ok && res.workflow?.id) router.push(`/admin/communications/journey-automation/${res.workflow.id}`);
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  async function toggleKillSwitch(engage: boolean) {
    if (saving) return;
    const reason: string | null = engage
      ? window.prompt("Reason for engaging the GLOBAL kill switch (recorded in the audit log):") ?? ""
      : null;
    if (engage && (reason ?? "").trim() === "") return;
    setSaving(true);
    try {
      await fetch("/api/admin/journey-automation/killswitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engaged: engage, reason }),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Journey Automation" subtitle="Design, version and orchestrate student communication journeys — safely." />
        <LoadingBlock />
      </>
    );
  }

  const workflows = data?.workflows ?? [];
  const flags = data?.flags;
  const ks = data?.killSwitch;
  const activeCount = workflows.filter((w) => w.status === "active").length;
  const draftCount = workflows.filter((w) => w.status === "draft").length;
  const publishedVersions = workflows.reduce((n, w) => n + ((w.published_version ?? 0) > 0 ? 1 : 0), 0);

  return (
    <>
      <PageHeader
        title="Journey Automation"
        subtitle="Design, version and orchestrate student communication journeys — safely."
        action={
          <div className="flex items-center gap-2">
            <span className="pill pill-gold inline-flex items-center gap-1.5">
              <Sparkles size={13} strokeWidth={2} aria-hidden="true" /> Builder preview
            </span>
            {canCreate && (
              <button type="button" className="btn btn-primary" disabled={creating} onClick={createJourney}>
                <Plus size={16} strokeWidth={2.25} aria-hidden="true" /> {creating ? "Creating…" : "New journey"}
              </button>
            )}
          </div>
        }
      />

      {/* Safety / status banner — makes it unmistakable that nothing sends or runs yet. */}
      <div
        className="mb-6 rounded-xl border p-4"
        style={{ borderColor: "var(--gold)", background: "var(--gold-soft)" }}
      >
        <div className="flex items-start gap-3">
          <ShieldCheck size={20} strokeWidth={2} style={{ color: "var(--gold)" }} aria-hidden="true" />
          <div className="text-sm">
            <p className="font-heading font-bold" style={{ color: "var(--navy, #0a1f44)" }}>
              Execution &amp; sending are OFF
            </p>
            <p className="mt-0.5 text-ink2">
              You can now design and publish journeys in the visual builder, but nothing enrolls,
              schedules, or sends yet. Publishing freezes an immutable version that will only run once
              execution is enabled. Every future send routes through the existing, DLT-compliant SMS
              Mission Control chokepoint.
            </p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Workflows" value={workflows.length} tone="blue" />
        <KpiCard label="Active" value={activeCount} tone="green" />
        <KpiCard label="Drafts" value={draftCount} tone="amber" />
        <KpiCard label="Published" value={publishedVersions} tone="blue" hint="workflows with a published version" />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Kill switch */}
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Power size={18} strokeWidth={2} style={{ color: ks?.engaged ? "var(--danger)" : "var(--primary)" }} aria-hidden="true" />
              <h2 className="font-heading text-base font-bold">Global kill switch</h2>
            </div>
            <span className={`pill ${ks?.engaged ? "pill-red" : "pill-green"}`}>
              {ks?.engaged ? "Engaged" : "Standby"}
            </span>
          </div>
          <p className="mt-2 text-sm text-ink2">
            {ks?.engaged
              ? `Engaged${ks.by ? ` by ${ks.by}` : ""} on ${fmtDate(ks.at)}${ks.reason ? ` — ${ks.reason}` : ""}.`
              : "The emergency stop for all journeys. It exists before the engine so the safety control is always in place."}
          </p>
          {canKill ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => toggleKillSwitch(!ks?.engaged)}
              className={`btn mt-3 ${ks?.engaged ? "btn-ghost" : "btn-primary"}`}
            >
              {ks?.engaged ? "Disengage kill switch" : "Engage kill switch"}
            </button>
          ) : (
            <p className="mt-3 text-xs text-muted">Requires the kill-switch permission.</p>
          )}
        </div>

        {/* Feature flags */}
        <div className="card p-5">
          <h2 className="font-heading text-base font-bold">Feature flags</h2>
          <p className="mt-1 text-xs text-muted">Server-controlled. All default OFF; enabled only via approved deploy steps.</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {flags &&
              (
                [
                  ["Dashboard", flags.enabled],
                  ["Execution", flags.executionEnabled],
                  ["SMS", flags.smsEnabled],
                  ["Promotional", flags.promotionalEnabled],
                  ["Payment reminders", flags.paymentRemindersEnabled],
                  ["AIVA", flags.aivaEnabled],
                ] as [string, boolean][]
              ).map(([label, on]) => (
                <li key={label} className="flex items-center justify-between">
                  <span className="text-ink2">{label}</span>
                  <span className={`pill ${on ? "pill-green" : "pill-gray"}`}>{on ? "On" : "Off"}</span>
                </li>
              ))}
          </ul>
        </div>
      </div>

      {/* Workflows */}
      <h2 className="mb-3 font-heading text-lg font-bold">Workflows</h2>
      {workflows.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "var(--primary-tint)", color: "var(--primary)" }}
          >
            <Workflow size={26} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div>
            <p className="font-heading text-base font-bold">No journeys yet</p>
            <p className="mt-1 max-w-md text-sm text-ink2">
              This is where student journeys will live — payment reminders, webinar nurture, onboarding
              and more. Create your first journey in the visual builder; it stays a safe draft until you
              publish, and won&apos;t run until execution is enabled.
            </p>
          </div>
          {canCreate && (
            <button type="button" className="btn btn-primary" disabled={creating} onClick={createJourney}>
              <Plus size={16} strokeWidth={2.25} aria-hidden="true" /> {creating ? "Creating…" : "New journey"}
            </button>
          )}
        </div>
      ) : (
        <TableShell headers={["Workflow", "Status", "Version", "Updated"]}>
          {workflows.map((w) => (
            <tr key={w.id} className="border-b border-line last:border-0 hover:bg-[var(--surface)]">
              <td className="px-4 py-3">
                <Link href={`/admin/communications/journey-automation/${w.id}`} className="font-medium text-[var(--primary)] hover:underline">
                  {w.name}
                </Link>
                {w.description && <div className="text-xs text-muted">{w.description}</div>}
              </td>
              <td className="px-4 py-3">
                <span className={`pill ${STATUS_PILL[w.status] ?? "pill-gray"}`}>{STATUS_LABEL[w.status] ?? w.status}</span>
              </td>
              <td className="px-4 py-3 tabular-nums">{w.published_version != null ? `v${w.published_version}` : "—"}</td>
              <td className="px-4 py-3 text-ink2">{fmtDate(w.updated_at)}</td>
            </tr>
          ))}
        </TableShell>
      )}
    </>
  );
}
