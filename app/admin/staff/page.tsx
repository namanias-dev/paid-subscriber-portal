"use client";

import { useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { Staff, StaffRole } from "@/lib/types";

const ROLES: StaffRole[] = ["Super Admin", "Counsellor", "Content Manager"];

export default function StaffAdmin() {
  const { data: staff, loading, reload } = useAdminData<Staff[]>("/api/admin/staff", "staff");
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", username: "", role: "Counsellor" as StaffRole, email: "" });

  async function add() {
    if (!form.name) { toast("Name required", "error"); return; }
    await fetch("/api/admin/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    toast("Staff added", "success");
    setForm({ name: "", username: "", role: "Counsellor", email: "" });
    setOpen(false);
    reload();
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Staff & Roles" subtitle="Counsellors, content managers & admins" action={<button onClick={() => setOpen(true)} className="btn btn-primary text-sm">+ Add Staff</button>} />
      <TableShell headers={["Name", "Username", "Role", "Email", "Status"]}>
        {(staff || []).map((s) => (
          <tr key={s.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{s.name}</td>
            <td className="px-4 py-3">{s.username}</td>
            <td className="px-4 py-3"><span className="pill pill-blue">{s.role}</span></td>
            <td className="px-4 py-3">{s.email || "—"}</td>
            <td className="px-4 py-3"><span className={`pill ${s.active ? "pill-green" : "pill-gray"}`}>{s.active ? "Active" : "Inactive"}</span></td>
          </tr>
        ))}
      </TableShell>

      <Modal open={open} onClose={() => setOpen(false)} title="Add Staff Member">
        <div className="space-y-3">
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input className="input" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <button onClick={add} className="btn btn-primary w-full">Add Staff</button>
        </div>
      </Modal>
    </div>
  );
}
