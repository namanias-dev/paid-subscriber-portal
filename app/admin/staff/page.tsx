"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, LoadingBlock, TableShell } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import {
  PERMISSIONS,
  DEFAULT_ROLES,
  resolvePermissions,
  canAssign,
  grantedLabels,
  allPermissions,
  type PermissionKey,
  type PermissionSet,
} from "@/lib/permissions";
import type { Role, AdminAccount } from "@/lib/types";

const BADGE: Record<string, string> = { gold: "pill-gold", navy: "pill-blue", blue: "pill-blue", green: "pill-green", amber: "pill-amber", red: "pill-red", gray: "pill-gray" };
function roleBadge(id: string): string {
  return BADGE[DEFAULT_ROLES.find((r) => r.id === id)?.badge || "gray"] || "pill-gray";
}
function roleSeed(id: string) {
  return DEFAULT_ROLES.find((r) => r.id === id);
}
function slugUsername(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
  return (base || "staff") + String(Math.floor(10 + Math.random() * 89));
}
function genPassword(): string {
  const lower = "abcdefghijkmnpqrstuvwxyz", upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", nums = "23456789", sym = "!@#$%*";
  const all = lower + upper + nums + sym;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let out = pick(lower) + pick(upper) + pick(nums) + pick(sym);
  for (let i = 0; i < 8; i++) out += pick(all);
  return out.split("").sort(() => Math.random() - 0.5).join("");
}
const PERM_GROUPS = Array.from(new Set(PERMISSIONS.map((p) => p.group)));

export default function StaffRolesAdmin() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"staff" | "roles">("staff");
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [myPerms, setMyPerms] = useState<PermissionSet>({});
  const [loading, setLoading] = useState(true);

  // Add-staff modal
  const [addOpen, setAddOpen] = useState(false);
  // Edit-staff modal
  const [editAcc, setEditAcc] = useState<AdminAccount | null>(null);
  // Credentials reveal modal
  const [creds, setCreds] = useState<{ username: string; password: string } | null>(null);
  // Role editor modal
  const [roleEditor, setRoleEditor] = useState<{ role: Role | null } | null>(null);

  // Filters
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, me] = await Promise.all([
        fetch("/api/admin/staff").then((r) => r.json()),
        fetch("/api/admin/me").then((r) => r.json()),
      ]);
      if (s.ok) { setAccounts(s.accounts || []); setRoles(s.roles || []); }
      // Legacy tokens (pre-RBAC) carry no permissions field — treat as full access.
      setMyPerms(me.admin?.permissions === undefined ? allPermissions() : (me.admin.permissions as PermissionSet));
    } catch { /* ignore */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const canManageRoles = myPerms.manage_roles === true;
  const assignableRoles = useMemo(
    () => roles.filter((r) => canAssign(myPerms, resolvePermissions(r.permissions))),
    [roles, myPerms]
  );

  const filtered = accounts.filter((a) => {
    if (roleFilter && a.role_id !== roleFilter) return false;
    if (statusFilter && a.status !== statusFilter) return false;
    if (q) {
      const t = q.toLowerCase();
      if (!`${a.name || ""} ${a.username} ${a.email || ""}`.toLowerCase().includes(t)) return false;
    }
    return true;
  });

  return (
    <div>
      <PageHeader title="Staff & Roles" subtitle="Create admin logins, assign roles and control exactly what each person can access" />

      {/* Tabs */}
      <div className="mb-6 inline-flex rounded-xl border border-line bg-white p-1">
        {(["staff", "roles"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition ${tab === t ? "bg-primary text-white" : "text-ink2"}`}>
            {t === "staff" ? "Staff" : "Roles & permissions"}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingBlock />
      ) : tab === "staff" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input className="input max-w-xs" placeholder="Search name / username / email" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input max-w-[180px]" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">All roles</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <select className="input max-w-[150px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All status</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
            <div className="ml-auto">
              <button onClick={() => setAddOpen(true)} className="btn btn-primary text-sm">+ Add Staff</button>
            </div>
          </div>

          <TableShell headers={["Name", "Username", "Role", "Status", "Last login", "Actions"]}>
            {filtered.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0 hover:bg-surface2">
                <td className="px-4 py-3 font-medium">{a.name || "—"}{a.email ? <span className="block text-xs text-muted">{a.email}</span> : null}</td>
                <td className="px-4 py-3 font-mono text-xs">{a.username}</td>
                <td className="px-4 py-3"><span className={`pill ${roleBadge(a.role_id || "")}`}>{roles.find((r) => r.id === a.role_id)?.name || a.role || "—"}</span></td>
                <td className="px-4 py-3"><span className={`pill ${a.status === "active" ? "pill-green" : "pill-gray"}`}>{a.status}</span></td>
                <td className="px-4 py-3 text-xs text-muted">{a.last_login_at ? new Date(a.last_login_at).toLocaleDateString("en-IN") : "Never"}</td>
                <td className="px-4 py-3">
                  <button onClick={() => setEditAcc(a)} className="text-primary text-xs font-semibold">Manage</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink2">No staff match these filters.</td></tr>}
          </TableShell>
        </>
      ) : (
        <RolesTab roles={roles} canManageRoles={canManageRoles} myPerms={myPerms} onNew={() => setRoleEditor({ role: null })} onEdit={(r) => setRoleEditor({ role: r })} onDeleted={load} />
      )}

      {/* Add staff */}
      {addOpen && (
        <AddStaffModal
          roles={assignableRoles}
          onClose={() => setAddOpen(false)}
          onCreated={(c) => { setAddOpen(false); setCreds(c); load(); }}
        />
      )}

      {/* Manage staff */}
      {editAcc && (
        <EditStaffModal
          account={editAcc}
          roles={assignableRoles}
          onClose={() => setEditAcc(null)}
          onChanged={() => { setEditAcc(null); load(); }}
          onPassword={(c) => { setEditAcc(null); setCreds(c); }}
          toast={toast}
        />
      )}

      {/* Credentials reveal (show once) */}
      {creds && (
        <Modal open onClose={() => setCreds(null)} title="Share these credentials now">
          <p className="mb-3 text-sm text-ink2">This password is shown <b>once</b>. Copy and share it securely — it cannot be retrieved later (only reset).</p>
          <CredRow label="Username" value={creds.username} toast={toast} />
          <CredRow label="Temporary password" value={creds.password} toast={toast} />
          <button onClick={() => setCreds(null)} className="btn btn-primary mt-4 w-full">Done</button>
        </Modal>
      )}

      {/* Role editor */}
      {roleEditor && (
        <RoleEditorModal
          role={roleEditor.role}
          myPerms={myPerms}
          onClose={() => setRoleEditor(null)}
          onSaved={() => { setRoleEditor(null); load(); }}
          toast={toast}
        />
      )}
    </div>
  );
}

function CredRow({ label, value, toast }: { label: string; value: string; toast: (m: string, t?: "success" | "error") => void }) {
  return (
    <div className="mb-2">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm">{value}</code>
        <button onClick={() => { navigator.clipboard.writeText(value); toast("Copied", "success"); }} className="btn btn-secondary text-xs">Copy</button>
      </div>
    </div>
  );
}

function RoleHelp({ roleId, perms }: { roleId?: string; perms: PermissionSet }) {
  const seed = roleId ? roleSeed(roleId) : undefined;
  const can = seed?.can || grantedLabels(perms);
  const cannot = seed?.cannot || PERMISSIONS.filter((p) => perms[p.key] !== true).map((p) => p.label);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-[rgba(22,163,74,0.25)] bg-[#e7f6ec] p-3">
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--success)]">Can do</p>
        <ul className="space-y-1 text-sm text-ink2">{can.map((c, i) => <li key={i}>✓ {c}</li>)}</ul>
      </div>
      <div className="rounded-xl border border-[rgba(220,38,38,0.2)] bg-[#fdeaea] p-3">
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--danger)]">Cannot do</p>
        <ul className="space-y-1 text-sm text-ink2">{cannot.slice(0, 6).map((c, i) => <li key={i}>✗ {c}</li>)}</ul>
      </div>
    </div>
  );
}

function AddStaffModal({ roles, onClose, onCreated }: { roles: Role[]; onClose: () => void; onCreated: (c: { username: string; password: string }) => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id || "");
  const [pwMode, setPwMode] = useState<"generate" | "manual">("generate");
  const [password, setPassword] = useState(genPassword());
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const role = roles.find((r) => r.id === roleId);

  async function submit() {
    setErr("");
    if (!name.trim() || !roleId) { setErr("Name and role are required."); return; }
    const finalUsername = (username.trim() || slugUsername(name)).toLowerCase();
    const finalPassword = pwMode === "manual" ? password : (password || genPassword());
    if (finalPassword.length < 8) { setErr("Password must be at least 8 characters."); return; }
    setBusy(true);
    const res = await fetch("/api/admin/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), username: finalUsername, email: email.trim() || null, role_id: roleId, password: finalPassword, must_change_password: mustChange }),
    });
    const d = await res.json().catch(() => ({ ok: false }));
    setBusy(false);
    if (d.ok) onCreated({ username: d.account?.username || finalUsername, password: d.password || finalPassword });
    else setErr(d.error || "Failed to add staff.");
  }

  return (
    <Modal open onClose={onClose} title="Add staff member" maxWidth="max-w-xl">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm"><span className="label">Full name</span><input className="input" value={name} onChange={(e) => { setName(e.target.value); if (!username) setUsername(slugUsername(e.target.value)); }} /></label>
          <label className="block text-sm"><span className="label">Email (optional)</span><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        </div>
        <label className="block text-sm">
          <span className="label">Username</span>
          <div className="flex gap-2">
            <input className="input font-mono" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="auto-generated" />
            <button type="button" onClick={() => setUsername(slugUsername(name))} className="btn btn-secondary text-xs whitespace-nowrap">Regenerate</button>
          </div>
        </label>
        <label className="block text-sm">
          <span className="label">Role</span>
          <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {role?.description && <p className="mt-1 text-xs text-muted">{role.description}</p>}
        </label>
        {role && <RoleHelp roleId={role.id} perms={resolvePermissions(role.permissions)} />}

        <div className="rounded-xl border border-line p-3">
          <div className="mb-2 flex gap-3 text-sm">
            <label className="flex items-center gap-1.5"><input type="radio" checked={pwMode === "generate"} onChange={() => { setPwMode("generate"); setPassword(genPassword()); }} /> Auto-generate password</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={pwMode === "manual"} onChange={() => setPwMode("manual")} /> Set manually</label>
          </div>
          <div className="flex gap-2">
            <input className="input font-mono" type={pwMode === "manual" ? "text" : "text"} value={password} onChange={(e) => setPassword(e.target.value)} readOnly={pwMode === "generate"} />
            {pwMode === "generate" && <button type="button" onClick={() => setPassword(genPassword())} className="btn btn-secondary text-xs whitespace-nowrap">Regenerate</button>}
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} /> Require password change on first login</label>
        </div>

        {err && <p className="text-sm text-danger">{err}</p>}
        <button onClick={submit} disabled={busy} className="btn btn-primary w-full">{busy ? "Creating…" : "Create staff login"}</button>
      </div>
    </Modal>
  );
}

function EditStaffModal({ account, roles, onClose, onChanged, onPassword, toast }: {
  account: AdminAccount; roles: Role[]; onClose: () => void; onChanged: () => void; onPassword: (c: { username: string; password: string }) => void; toast: (m: string, t?: "success" | "error") => void;
}) {
  const [roleId, setRoleId] = useState(account.role_id || "");
  const [status, setStatus] = useState(account.status);
  const [busy, setBusy] = useState(false);
  const role = roles.find((r) => r.id === roleId);

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/admin/staff/${account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role_id: roleId, status }) });
    const d = await res.json().catch(() => ({ ok: false }));
    setBusy(false);
    if (d.ok) { toast("Staff updated", "success"); onChanged(); } else toast(d.error || "Update failed", "error");
  }
  async function reset() {
    if (!confirm("Generate a new temporary password for this user?")) return;
    const res = await fetch(`/api/admin/staff/${account.id}/password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const d = await res.json().catch(() => ({ ok: false }));
    if (d.ok) onPassword({ username: account.username, password: d.password });
    else toast(d.error || "Reset failed", "error");
  }
  async function remove() {
    if (!confirm(`Remove ${account.name || account.username}? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/staff/${account.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({ ok: false }));
    if (d.ok) { toast("Staff removed", "success"); onChanged(); } else toast(d.error || "Remove failed", "error");
  }

  return (
    <Modal open onClose={onClose} title={`Manage ${account.name || account.username}`} maxWidth="max-w-xl">
      <div className="space-y-3">
        <p className="text-sm text-ink2">Username: <code className="font-mono">{account.username}</code></p>
        <label className="block text-sm">
          <span className="label">Role</span>
          <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            {!roles.some((r) => r.id === account.role_id) && account.role_id && <option value={account.role_id}>{account.role || account.role_id} (current)</option>}
          </select>
        </label>
        {role && <RoleHelp roleId={role.id} perms={resolvePermissions(role.permissions)} />}
        <label className="block text-sm">
          <span className="label">Status</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as "active" | "disabled")}>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2 pt-2">
          <button onClick={save} disabled={busy} className="btn btn-primary text-sm">Save changes</button>
          <button onClick={reset} className="btn btn-secondary text-sm">Reset password</button>
          <button onClick={remove} className="btn btn-ghost text-sm text-danger">Remove</button>
        </div>
      </div>
    </Modal>
  );
}

function RolesTab({ roles, canManageRoles, myPerms, onNew, onEdit, onDeleted }: {
  roles: Role[]; canManageRoles: boolean; myPerms: PermissionSet; onNew: () => void; onEdit: (r: Role) => void; onDeleted: () => void;
}) {
  const { toast } = useToast();
  async function del(r: Role) {
    if (!confirm(`Delete the "${r.name}" role?`)) return;
    const res = await fetch(`/api/admin/roles/${r.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({ ok: false }));
    if (d.ok) { toast("Role deleted", "success"); onDeleted(); } else toast(d.error || "Delete failed", "error");
  }
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-ink2">Each role bundles permissions. Assigning a role decides exactly what a staff member can see and do.</p>
        {canManageRoles && <button onClick={onNew} className="btn btn-primary text-sm">+ New role</button>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((r) => {
          const perms = resolvePermissions(r.permissions);
          const editable = canManageRoles && r.id !== "super_admin";
          return (
            <div key={r.id} className="card p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className={`pill ${roleBadge(r.id)}`}>{r.name}</span>
                  {r.is_system && <span className="pill pill-gray ml-1">System</span>}
                  <p className="mt-2 text-sm text-ink2">{r.description}</p>
                </div>
                {editable && (
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => onEdit(r)} className="text-primary text-xs font-semibold">Edit</button>
                    {!r.is_system && <button onClick={() => del(r)} className="text-danger text-xs font-semibold">Delete</button>}
                  </div>
                )}
              </div>
              <div className="mt-3"><RoleHelp roleId={r.id} perms={perms} /></div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-muted">View permission matrix</summary>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PERMISSIONS.map((p) => (
                    <span key={p.key} className={`pill text-[11px] ${perms[p.key] ? "pill-green" : "pill-gray opacity-60"}`}>{perms[p.key] ? "✓" : "✗"} {p.label}</span>
                  ))}
                </div>
              </details>
            </div>
          );
        })}
      </div>
      {!canManageRoles && <p className="mt-4 text-xs text-muted">You can view roles but need the “Manage roles & permissions” permission to create or edit them.</p>}
      {/* myPerms reserved for future inline gating */}
      <span className="hidden">{Object.keys(myPerms).length}</span>
    </div>
  );
}

function RoleEditorModal({ role, myPerms, onClose, onSaved, toast }: {
  role: Role | null; myPerms: PermissionSet; onClose: () => void; onSaved: () => void; toast: (m: string, t?: "success" | "error") => void;
}) {
  const [name, setName] = useState(role?.name || "");
  const [description, setDescription] = useState(role?.description || "");
  const [perms, setPerms] = useState<PermissionSet>({ ...(role?.permissions || {}) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function toggle(k: PermissionKey) {
    setPerms((p) => ({ ...p, [k]: !p[k] }));
  }

  async function save() {
    setErr("");
    if (!name.trim()) { setErr("Role name is required."); return; }
    if (!canAssign(myPerms, perms)) { setErr("You can't grant permissions you don't have yourself."); return; }
    setBusy(true);
    const url = role ? `/api/admin/roles/${role.id}` : "/api/admin/roles";
    const method = role ? "PATCH" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), description, permissions: perms }) });
    const d = await res.json().catch(() => ({ ok: false }));
    setBusy(false);
    if (d.ok) { toast(role ? "Role updated" : "Role created", "success"); onSaved(); } else setErr(d.error || "Save failed");
  }

  return (
    <Modal open onClose={onClose} title={role ? `Edit role: ${role.name}` : "Create custom role"} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm"><span className="label">Role name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block text-sm"><span className="label">Short description</span><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        </div>

        <div className="rounded-xl border border-line p-3">
          {PERM_GROUPS.map((g) => (
            <div key={g} className="mb-3 last:mb-0">
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">{g}</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {PERMISSIONS.filter((p) => p.group === g).map((p) => {
                  const allowed = myPerms[p.key] === true;
                  return (
                    <label key={p.key} className={`flex items-center gap-2 text-sm ${allowed ? "" : "opacity-50"}`}>
                      <input type="checkbox" checked={perms[p.key] === true} disabled={!allowed} onChange={() => toggle(p.key)} />
                      {p.label}{p.financial && <span className="pill pill-amber text-[10px]">$</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Live preview</p>
          <RoleHelp perms={perms} />
        </div>

        {err && <p className="text-sm text-danger">{err}</p>}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">{busy ? "Saving…" : role ? "Save role" : "Create role"}</button>
      </div>
    </Modal>
  );
}
