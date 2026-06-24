"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import StatusPill from "@/components/ui/StatusPill";
import SearchBar from "@/components/ui/SearchBar";
import { useToast } from "@/components/ui/Toast";
import { PLANS } from "@/lib/config";
import { formatDate } from "@/lib/dates";
import type { Student } from "@/lib/types";

export default function StudentsAdmin() {
  const { data: students, loading, reload } = useAdminData<Student[]>("/api/admin/students", "students");
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", plan: "3m", target_year: "" });
  const [waLink, setWaLink] = useState<string | null>(null);

  const filtered = (students || []).filter((s) =>
    `${s.name} ${s.phone} ${s.access_code} ${s.email || ""}`.toLowerCase().includes(q.toLowerCase())
  );

  async function add() {
    if (!form.name || !/^\d{10}$/.test(form.phone)) { toast("Name & 10-digit phone required", "error"); return; }
    const res = await fetch("/api/admin/students", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await res.json();
    if (data.ok) {
      toast(`Student added · code ${data.student.access_code}`, "success");
      setWaLink(data.whatsappLink || null);
      setForm({ name: "", phone: "", email: "", plan: "3m", target_year: "" });
      reload();
    } else toast(data.error || "Failed", "error");
  }

  async function action(id: string, action: string, days?: number) {
    await fetch(`/api/admin/students/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, days }) });
    toast("Updated", "success");
    reload();
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Students & Enrollments" subtitle="Manage access, fees and credentials" action={<button onClick={() => { setWaLink(null); setAddOpen(true); }} className="btn btn-primary text-sm">+ Add Student</button>} />

      <div className="mb-4 max-w-sm"><SearchBar value={q} onChange={setQ} placeholder="Search by name, phone or code" /></div>

      <TableShell headers={["Name", "Phone", "Plan", "Access Code", "Valid Till", "Status", ""]}>
        {filtered.map((s) => (
          <tr key={s.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">
              <Link href={`/admin/students/${s.id}`} className="text-ink hover:text-primary hover:underline">{s.name}</Link>
            </td>
            <td className="px-4 py-3">{s.phone}</td>
            <td className="px-4 py-3 uppercase">{s.plan}</td>
            <td className="px-4 py-3 font-mono text-xs text-primary">{s.access_code}</td>
            <td className="px-4 py-3">{s.expiry_date ? formatDate(s.expiry_date) : "∞ Lifetime"}</td>
            <td className="px-4 py-3"><StatusPill expiry={s.expiry_date} isActive={s.is_active} /></td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-3 text-xs">
                <Link href={`/admin/students/${s.id}`} className="font-semibold text-primary">View profile</Link>
                <button onClick={() => action(s.id, "extend", 30)} className="text-ink2 hover:text-primary">+30d</button>
                <button onClick={() => action(s.id, "revoke")} className="text-danger">Revoke</button>
              </div>
            </td>
          </tr>
        ))}
      </TableShell>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Student">
        {waLink ? (
          <div className="space-y-3 text-center">
            <p className="text-success">✅ Student created!</p>
            <a href={waLink} target="_blank" rel="noopener noreferrer" className="btn btn-primary w-full">💬 Send credentials on WhatsApp</a>
            <button onClick={() => setWaLink(null)} className="btn btn-secondary w-full">Add another</button>
          </div>
        ) : (
          <div className="space-y-3">
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Phone (10-digit)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
            <input className="input" placeholder="Email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <select className="input" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                {PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input className="input" placeholder="Target year" value={form.target_year} onChange={(e) => setForm({ ...form, target_year: e.target.value })} />
            </div>
            <button onClick={add} className="btn btn-primary w-full">Create & Generate Code</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
