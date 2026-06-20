"use client";

import { useMemo, useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import SearchBar from "@/components/ui/SearchBar";
import { useToast } from "@/components/ui/Toast";
import { formatINR } from "@/lib/dates";
import type { Lead, LeadStatus } from "@/lib/types";

const STAGES: LeadStatus[] = ["New", "Contacted", "Demo Booked", "Demo Attended", "Negotiation", "Admitted", "Lost"];
const SOURCES = ["Instagram", "Meta Form", "Webinar", "Demo", "Website", "WhatsApp", "Referral"];

function waLink(phone: string, text: string) {
  const cleaned = phone.replace(/\D/g, "");
  const withCountry = cleaned.length === 10 ? `91${cleaned}` : cleaned;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}`;
}

export default function LeadsPage() {
  const { data: leads, loading, reload } = useAdminData<Lead[]>("/api/admin/leads", "leads");
  const { toast } = useToast();
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [q, setQ] = useState("");
  const [source, setSource] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [active, setActive] = useState<Lead | null>(null);

  const filtered = useMemo(() => {
    const list = leads || [];
    const query = q.trim().toLowerCase();
    return list.filter((l) => {
      if (source !== "all" && l.source !== source) return false;
      if (query && !(`${l.name} ${l.phone} ${l.city ?? ""}`.toLowerCase().includes(query))) return false;
      return true;
    });
  }, [leads, q, source]);

  async function setStatus(lead: Lead, status: LeadStatus) {
    await fetch(`/api/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, admitted: status === "Admitted" }),
    });
    reload();
  }

  function exportCsv() {
    const rows = [
      ["Name", "Phone", "City", "State", "Source", "Status", "Course Interest", "Counsellor", "Follow-up"],
      ...filtered.map((l) => [l.name, l.phone, l.city ?? "", l.state ?? "", l.source, l.status, l.course_interest ?? "", l.counsellor ?? "", l.follow_up_date ?? ""]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast("Exported leads.csv", "success");
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="Lead CRM"
        subtitle={`${filtered.length} leads`}
        action={
          <div className="flex flex-wrap gap-2">
            <button onClick={exportCsv} className="btn btn-secondary text-sm">⬇ Export CSV</button>
            <button onClick={() => setAddOpen(true)} className="btn btn-primary text-sm">+ Add Lead</button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-[200px] flex-1"><SearchBar value={q} onChange={setQ} placeholder="Search name / phone / city" /></div>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="input max-w-[180px]">
          <option value="all">All sources</option>
          {SOURCES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="flex overflow-hidden rounded-xl border border-line">
          <button onClick={() => setView("kanban")} className="px-3 py-2 text-sm" style={{ background: view === "kanban" ? "var(--primary)" : "#fff", color: view === "kanban" ? "#fff" : "var(--ink2)" }}>Kanban</button>
          <button onClick={() => setView("table")} className="px-3 py-2 text-sm" style={{ background: view === "table" ? "var(--primary)" : "#fff", color: view === "table" ? "#fff" : "var(--ink2)" }}>Table</button>
        </div>
      </div>

      {view === "kanban" ? (
        <div className="no-scrollbar flex gap-3 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const items = filtered.filter((l) => l.status === stage);
            return (
              <div key={stage} className="w-72 shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold">{stage}</span>
                  <span className="pill pill-gray">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((l) => (
                    <button key={l.id} onClick={() => setActive(l)} className="card card-hover w-full p-3 text-left">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{l.name}</span>
                        <span className={`pill ${l.temperature === "Interested" ? "pill-green" : l.temperature === "Warm" ? "pill-amber" : l.temperature === "Junk" ? "pill-red" : "pill-gray"}`}>{l.temperature}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted">{l.phone} · {l.city}</p>
                      <p className="mt-1 line-clamp-1 text-xs text-ink2">{l.course_interest}</p>
                      <p className="mt-1 text-[11px] text-muted">{l.source} · {l.counsellor}</p>
                    </button>
                  ))}
                  {items.length === 0 && <div className="rounded-xl border border-dashed border-line py-6 text-center text-xs text-muted">Empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <TableShell headers={["Name", "Phone", "City", "Source", "Interest", "Status", "Counsellor", ""]}>
          {filtered.map((l) => (
            <tr key={l.id} className="border-b border-line last:border-0 hover:bg-surface2">
              <td className="px-4 py-3 font-medium">{l.name}</td>
              <td className="px-4 py-3">{l.phone}</td>
              <td className="px-4 py-3">{l.city}</td>
              <td className="px-4 py-3">{l.source}</td>
              <td className="px-4 py-3">{l.course_interest}</td>
              <td className="px-4 py-3"><span className="pill pill-blue">{l.status}</span></td>
              <td className="px-4 py-3">{l.counsellor}</td>
              <td className="px-4 py-3"><button onClick={() => setActive(l)} className="text-primary">Open</button></td>
            </tr>
          ))}
        </TableShell>
      )}

      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={reload} />
      {active && (
        <LeadDetail
          lead={active}
          onClose={() => setActive(null)}
          onChanged={() => { reload(); }}
          setStatus={setStatus}
          waLink={waLink}
        />
      )}
    </div>
  );
}

function AddLeadModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", phone: "", city: "", source: "Website", course_interest: "" });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name || !/^\d{10}$/.test(form.phone)) { toast("Name and 10-digit phone required", "error"); return; }
    setSaving(true);
    await fetch("/api/admin/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setSaving(false);
    toast("Lead added", "success");
    setForm({ name: "", phone: "", city: "", source: "Website", course_interest: "" });
    onAdded();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Lead">
      <div className="space-y-3">
        <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" placeholder="Phone (10-digit)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
        <input className="input" placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <select className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
          {SOURCES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input className="input" placeholder="Course interest" value={form.course_interest} onChange={(e) => setForm({ ...form, course_interest: e.target.value })} />
        <button onClick={save} disabled={saving} className="btn btn-primary w-full">{saving ? "Saving..." : "Add Lead"}</button>
      </div>
    </Modal>
  );
}

function LeadDetail({
  lead,
  onClose,
  onChanged,
  setStatus,
  waLink,
}: {
  lead: Lead;
  onClose: () => void;
  onChanged: () => void;
  setStatus: (l: Lead, s: LeadStatus) => void;
  waLink: (p: string, t: string) => string;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [status, setLocalStatus] = useState<LeadStatus>(lead.status);

  async function addNote() {
    if (!note.trim()) return;
    await fetch(`/api/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _activity: { type: "note", note: note.trim(), counsellor: lead.counsellor } }),
    });
    setNote("");
    toast("Note added", "success");
  }

  return (
    <Modal open onClose={onClose} title={lead.name} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Info label="Phone" value={lead.phone} />
          <Info label="City" value={lead.city || "—"} />
          <Info label="Source" value={lead.source} />
          <Info label="Counsellor" value={lead.counsellor || "—"} />
          <Info label="Interest" value={lead.course_interest || "—"} />
          <Info label="Target" value={lead.target_year ? String(lead.target_year) : "—"} />
          {lead.admitted && <Info label="Fee" value={formatINR(lead.total_fee || 0)} />}
          {lead.admitted && <Info label="Pending" value={formatINR(lead.pending_balance || 0)} />}
        </div>

        <div>
          <label className="label">Pipeline stage</label>
          <select className="input" value={status} onChange={(e) => { const s = e.target.value as LeadStatus; setLocalStatus(s); setStatus(lead, s); onChanged(); }}>
            {STAGES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex gap-2">
          <a href={waLink(lead.phone, `Hi ${lead.name}, this is Naman IAS Academy team. `)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary flex-1 text-sm">💬 WhatsApp</a>
          <a href={`tel:${lead.phone}`} className="btn btn-secondary flex-1 text-sm">📞 Call</a>
        </div>

        <div>
          <label className="label">Add activity / note</label>
          <div className="flex gap-2">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Called, sent brochure..." />
            <button onClick={addNote} className="btn btn-primary text-sm">Log</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="text-ink">{value}</p>
    </div>
  );
}
