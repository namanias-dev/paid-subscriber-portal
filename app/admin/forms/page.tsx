"use client";

import { useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { LeadFormConfig } from "@/lib/types";

const FIELD_OPTIONS = ["name", "phone", "city", "state", "course_interest", "target_year", "mode_pref"];

export default function FormsAdmin() {
  const { data: forms, loading, reload } = useAdminData<LeadFormConfig[]>("/api/admin/forms", "forms");
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", campaign: "", fields: ["name", "phone"] });

  function toggleField(f: string) {
    setForm((p) => ({ ...p, fields: p.fields.includes(f) ? p.fields.filter((x) => x !== f) : [...p.fields, f] }));
  }

  async function create() {
    if (!form.name) { toast("Name required", "error"); return; }
    await fetch("/api/admin/forms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    toast("Form created — shareable link generated", "success");
    setForm({ name: "", campaign: "", fields: ["name", "phone"] });
    setOpen(false);
    reload();
  }

  function copyLink(slug: string) {
    navigator.clipboard.writeText(`${window.location.origin}/contact?form=${slug}`);
    toast("Form link copied", "success");
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Lead Forms Builder" subtitle="Custom capture forms — submissions flow into the CRM" action={<button onClick={() => setOpen(true)} className="btn btn-primary text-sm">+ New Form</button>} />

      <TableShell headers={["Form", "Campaign", "Fields", "Submissions", "Share"]}>
        {(forms || []).map((f) => (
          <tr key={f.id} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3 font-medium">{f.name}</td>
            <td className="px-4 py-3">{f.campaign}</td>
            <td className="px-4 py-3 text-xs">{f.fields.join(", ")}</td>
            <td className="px-4 py-3">{f.submissions}</td>
            <td className="px-4 py-3"><button onClick={() => copyLink(f.slug)} className="text-primary text-xs">Copy link</button></td>
          </tr>
        ))}
      </TableShell>

      <Modal open={open} onClose={() => setOpen(false)} title="New Lead Form">
        <div className="space-y-3">
          <input className="input" placeholder="Form name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Campaign / destination tag" value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })} />
          <div>
            <label className="label">Fields</label>
            <div className="flex flex-wrap gap-2">
              {FIELD_OPTIONS.map((f) => (
                <button key={f} type="button" onClick={() => toggleField(f)} className={`chip ${form.fields.includes(f) ? "chip-active" : ""}`}>{f}</button>
              ))}
            </div>
          </div>
          <button onClick={create} className="btn btn-primary w-full">Create Form</button>
        </div>
      </Modal>
    </div>
  );
}
