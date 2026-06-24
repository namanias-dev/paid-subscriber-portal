"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import StatusPill from "@/components/ui/StatusPill";
import SearchBar from "@/components/ui/SearchBar";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/dates";
import type { Student } from "@/lib/types";

export default function StudentsAdmin() {
  const { data: students, loading, reload } = useAdminData<Student[]>("/api/admin/students", "students");
  const { toast } = useToast();
  const [q, setQ] = useState("");

  const filtered = (students || []).filter((s) =>
    `${s.name} ${s.phone} ${s.access_code} ${s.email || ""}`.toLowerCase().includes(q.toLowerCase())
  );

  async function action(id: string, action: string, days?: number) {
    await fetch(`/api/admin/students/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, days }) });
    toast("Updated", "success");
    reload();
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="Students & Enrollments"
        subtitle="Manage access, fees and credentials"
        action={<Link href="/admin/students/new" className="btn btn-primary text-sm">+ Add Student</Link>}
      />

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
    </div>
  );
}
