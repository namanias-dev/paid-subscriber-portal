"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, TableShell, LoadingBlock } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import PositionEditor from "@/components/admin/careers/PositionEditor";
import ApplicationDetail from "@/components/admin/careers/ApplicationDetail";
import FormBuilder from "@/components/admin/careers/FormBuilder";
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  JOB_TYPE_LABELS,
  ROLE_TYPE_LABELS,
} from "@/lib/careers/config";
import type {
  CareerApplication,
  CareerPosition,
  CareersSettings,
  FormField,
} from "@/lib/careers/types";

type Tab = "positions" | "applications" | "settings";

export default function CareersAdminPage() {
  const [tab, setTab] = useState<Tab>("positions");
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [appFilterPosition, setAppFilterPosition] = useState("");

  const [positions, setPositions] = useState<CareerPosition[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [settings, setSettings] = useState<CareersSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((d) => setAllowed(!!d?.ok && (d?.admin?.permissions?.manage_careers === true || d?.admin?.permissions === undefined || isSuper(d?.admin?.permissions))))
      .catch(() => setAllowed(false));
  }, []);

  const loadCore = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, sRes] = await Promise.all([
        fetch("/api/admin/careers/positions").then((r) => r.json()),
        fetch("/api/admin/careers/settings").then((r) => r.json()),
      ]);
      if (pRes.ok) {
        setPositions(pRes.positions);
        setCounts(pRes.counts || {});
      }
      if (sRes.ok) setSettings(sRes.settings);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) loadCore();
  }, [allowed, loadCore]);

  if (allowed === false) {
    return (
      <div className="card p-8 text-center">
        <p className="font-heading text-lg font-bold">No access</p>
        <p className="mt-1 text-sm text-ink2">You don&apos;t have permission to manage careers.</p>
      </div>
    );
  }
  if (allowed === null || (loading && !settings)) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="Careers"
        subtitle="Manage open positions, application forms and candidate applications."
      />

      <div className="mb-6 flex gap-2 border-b border-line">
        {(["positions", "applications", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold capitalize transition ${
              tab === t ? "border-primary text-primary" : "border-transparent text-ink2 hover:text-ink"
            }`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "positions" && settings && (
        <PositionsTab
          positions={positions}
          counts={counts}
          settings={settings}
          reload={loadCore}
          onOpenApplications={(positionId) => {
            setAppFilterPosition(positionId);
            setTab("applications");
          }}
        />
      )}
      {tab === "applications" && (
        <ApplicationsTab positions={positions} initialPositionId={appFilterPosition} />
      )}
      {tab === "settings" && settings && (
        <SettingsTab settings={settings} onSaved={loadCore} />
      )}
    </div>
  );
}

function isSuper(p: Record<string, boolean> | undefined): boolean {
  return !!p && p.manage_roles === true && p.manage_staff === true && p.view_revenue === true;
}

// ===========================================================================
//  Positions tab
// ===========================================================================
function PositionsTab({
  positions,
  counts,
  settings,
  reload,
  onOpenApplications,
}: {
  positions: CareerPosition[];
  counts: Record<string, number>;
  settings: CareersSettings;
  reload: () => void;
  onOpenApplications: (positionId: string) => void;
}) {
  const { toast } = useToast();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CareerPosition | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setEditorOpen(true);
  }
  function openEdit(p: CareerPosition) {
    setEditing(p);
    setEditorOpen(true);
  }

  async function duplicate(p: CareerPosition) {
    setBusy(p.id);
    try {
      const res = await fetch(`/api/admin/careers/positions/${p.id}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      toast("Position duplicated (as draft).", "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: CareerPosition) {
    if (!confirm(`Delete "${p.title}"? This cannot be undone. Applications are kept.`)) return;
    setBusy(p.id);
    try {
      const res = await fetch(`/api/admin/careers/positions/${p.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Delete failed.");
      toast("Position deleted.", "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function quickStatus(p: CareerPosition, status: "open" | "closed" | "draft") {
    setBusy(p.id);
    try {
      const res = await fetch(`/api/admin/careers/positions/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      toast(`Marked ${status}.`, "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button className="btn btn-primary" onClick={openNew}>+ New position</button>
      </div>

      {positions.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-heading text-lg font-bold">No positions yet</p>
          <p className="mt-1 text-sm text-ink2">Create your first job posting to get started.</p>
        </div>
      ) : (
        <TableShell headers={["Title", "Role", "Location", "Status", "Applications", "Actions"]}>
          {positions.map((p) => (
            <tr key={p.id} className="border-b border-line last:border-0">
              <td className="px-4 py-3">
                <div className="font-semibold text-ink">{p.title}</div>
                <div className="text-xs text-muted">/{p.slug} · {JOB_TYPE_LABELS[p.job_type] || p.job_type}</div>
              </td>
              <td className="px-4 py-3 text-ink2">{ROLE_TYPE_LABELS[p.role_type] || p.role_type}</td>
              <td className="px-4 py-3 text-ink2">{[p.location_city, p.location_state].filter(Boolean).join(", ") || "—"}</td>
              <td className="px-4 py-3">
                <select
                  className="input h-9 min-h-0 py-1 text-xs"
                  value={p.status}
                  disabled={busy === p.id}
                  onChange={(e) => quickStatus(p, e.target.value as "open" | "closed" | "draft")}
                >
                  <option value="draft">Draft</option>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
              </td>
              <td className="px-4 py-3">
                <button className="pill pill-blue" onClick={() => onOpenApplications(p.id)}>
                  {counts[p.id] || 0} →
                </button>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <button className="btn btn-ghost h-8 min-h-0 px-2 py-1" onClick={() => openEdit(p)}>Edit</button>
                  <button className="btn btn-ghost h-8 min-h-0 px-2 py-1" onClick={() => duplicate(p)} disabled={busy === p.id}>Duplicate</button>
                  <a className="btn btn-ghost h-8 min-h-0 px-2 py-1" href={`/careers/${p.slug}`} target="_blank" rel="noopener noreferrer">View</a>
                  <button className="btn btn-ghost h-8 min-h-0 px-2 py-1 text-danger" onClick={() => remove(p)} disabled={busy === p.id}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <PositionEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        position={editing}
        subjects={settings.subjects}
        defaultFormFields={settings.default_form_fields}
        onSaved={reload}
      />
    </div>
  );
}

// ===========================================================================
//  Applications tab
// ===========================================================================
function ApplicationsTab({
  positions,
  initialPositionId,
}: {
  positions: CareerPosition[];
  initialPositionId: string;
}) {
  const [rows, setRows] = useState<CareerApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [positionId, setPositionId] = useState(initialPositionId || "");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CareerApplication | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (positionId) p.set("positionId", positionId);
    if (status) p.set("status", status);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [positionId, status, q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/careers/applications${query ? `?${query}` : ""}`).then((r) => r.json());
      if (res.ok) setRows(res.applications);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input className="input" placeholder="Search name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={positionId} onChange={(e) => setPositionId(e.target.value)}>
          <option value="">All positions</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>{APPLICATION_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <a className="btn btn-secondary" href={`/api/admin/careers/applications/export${query ? `?${query}` : ""}`}>
          Export CSV
        </a>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-heading text-lg font-bold">No applications</p>
          <p className="mt-1 text-sm text-ink2">Applications will appear here as candidates apply.</p>
        </div>
      ) : (
        <TableShell headers={["Name", "Position", "Location", "Status", "Applied", ""]}>
          {rows.map((a) => (
            <tr key={a.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface" onClick={() => { setSelected(a); setDetailOpen(true); }}>
              <td className="px-4 py-3">
                <div className="font-semibold text-ink">{a.full_name}</div>
                <div className="text-xs text-muted">{a.email} · {a.phone}</div>
              </td>
              <td className="px-4 py-3 text-ink2">{a.position_title || "—"}</td>
              <td className="px-4 py-3 text-ink2">{[a.city, a.state].filter(Boolean).join(", ") || "—"}</td>
              <td className="px-4 py-3">
                <StatusPill status={a.status} />
              </td>
              <td className="px-4 py-3 text-ink2">{new Date(a.created_at).toLocaleDateString("en-IN")}</td>
              <td className="px-4 py-3 text-right text-primary">View →</td>
            </tr>
          ))}
        </TableShell>
      )}

      <ApplicationDetail
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        application={selected}
        onUpdated={load}
      />
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    new: "pill-blue",
    shortlisted: "pill-amber",
    interviewing: "pill-amber",
    rejected: "pill-red",
    hired: "pill-green",
  };
  return <span className={`pill ${tone[status] || "pill-gray"}`}>{APPLICATION_STATUS_LABELS[status as keyof typeof APPLICATION_STATUS_LABELS] || status}</span>;
}

// ===========================================================================
//  Settings tab
// ===========================================================================
function SettingsTab({ settings, onSaved }: { settings: CareersSettings; onSaved: () => void }) {
  const { toast } = useToast();
  const [accepting, setAccepting] = useState(settings.accepting_applications);
  const [subjects, setSubjects] = useState<string[]>(settings.subjects);
  const [newSubject, setNewSubject] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(settings.notify_email || "");
  const [fields, setFields] = useState<FormField[]>(settings.default_form_fields);
  const [saving, setSaving] = useState(false);

  function addSubject() {
    const s = newSubject.trim();
    if (s && !subjects.some((x) => x.toLowerCase() === s.toLowerCase())) {
      setSubjects([...subjects, s]);
    }
    setNewSubject("");
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/careers/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accepting_applications: accepting,
          subjects,
          default_form_fields: fields,
          notify_email: notifyEmail,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Save failed.");
      toast("Settings saved.", "success");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={accepting} onChange={(e) => setAccepting(e.target.checked)} />
          <span>
            <span className="font-semibold text-ink">Accept applications site-wide</span>
            <span className="block text-sm text-ink2">Master switch. When off, all roles show &quot;not accepting applications&quot;.</span>
          </span>
        </label>
      </div>

      <div className="card p-5">
        <p className="font-heading text-base font-bold">Subjects</p>
        <p className="mb-3 text-sm text-ink2">The master subject list offered on positions and application forms.</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {subjects.map((s) => (
            <span key={s} className="chip chip-active">
              {s}
              <button className="ml-1.5" onClick={() => setSubjects(subjects.filter((x) => x !== s))} aria-label={`Remove ${s}`}>×</button>
            </span>
          ))}
          {subjects.length === 0 && <span className="text-sm text-muted">No subjects yet.</span>}
        </div>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="Add a subject…"
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubject(); } }}
          />
          <button className="btn btn-secondary" onClick={addSubject}>Add</button>
        </div>
      </div>

      <div className="card p-5">
        <p className="font-heading text-base font-bold">Notifications</p>
        <p className="mb-3 text-sm text-ink2">Email to notify when a new application arrives (optional; needs email configured).</p>
        <input className="input" type="email" placeholder="hr@namanias.com" value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} />
      </div>

      <div className="card p-5">
        <p className="font-heading text-base font-bold">Default application form</p>
        <p className="mb-3 text-sm text-ink2">Used by any position that doesn&apos;t define its own custom form.</p>
        <FormBuilder value={fields} onChange={setFields} />
      </div>

      <div className="flex justify-end">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}
