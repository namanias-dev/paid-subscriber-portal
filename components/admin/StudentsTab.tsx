"use client";

import { useMemo, useState } from "react";
import SearchBar from "@/components/ui/SearchBar";
import FilterTabs from "@/components/ui/FilterTabs";
import StatusPill, { statusOf } from "@/components/ui/StatusPill";
import Modal from "@/components/ui/Modal";
import EmptyState from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { getPlan, PLANS } from "@/lib/config";
import { formatDate, formatINR } from "@/lib/dates";
import { buildWelcomeMessage, buildWhatsAppLink } from "@/lib/whatsapp";
import type { Student } from "@/lib/types";

const TABS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "expiring", label: "Expiring" },
  { id: "expired", label: "Expired" },
  { id: "lifetime", label: "Lifetime" },
];
const PAGE_SIZE = 20;

export default function StudentsTab({
  students,
  onChanged,
}: {
  students: Student[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Student | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      const status = statusOf(s.expiry_date, s.is_active);
      if (tab !== "all" && status !== tab) return false;
      if (q) {
        const hay = `${s.name} ${s.phone} ${s.access_code}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [students, query, tab]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  async function patch(id: string, body: Record<string, unknown>, label: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/students/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        toast(label, "success");
        onChanged();
      } else {
        toast(data.error || "Action failed", "error");
      }
    } catch {
      toast("Action failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(s: Student) {
    if (!confirm(`Revoke access for ${s.name}?`)) return;
    await patch(s.id, { action: "revoke" }, "Access revoked");
  }

  function whatsapp(s: Student) {
    const plan = getPlan(s.plan);
    const message = buildWelcomeMessage({
      name: s.name,
      code: s.access_code,
      phone: s.phone,
      planName: plan?.name || s.plan,
      expiry: s.expiry_date,
    });
    window.open(buildWhatsAppLink(s.phone, message), "_blank", "noopener,noreferrer");
  }

  function exportCSV() {
    const headers = [
      "Name",
      "Phone",
      "Email",
      "Plan",
      "Amount",
      "Code",
      "Start",
      "Expiry",
      "Status",
    ];
    const rows = filtered.map((s) => [
      s.name,
      s.phone,
      s.email ?? "",
      s.plan,
      String(s.amount_paid ?? 0),
      s.access_code,
      formatDate(s.start_date),
      s.expiry_date ? formatDate(s.expiry_date) : "Lifetime",
      statusOf(s.expiry_date, s.is_active),
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "naman-ias-students.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchBar
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(0);
            }}
            placeholder="Search name, phone or code..."
          />
        </div>
        <button onClick={exportCSV} className="btn-outline text-sm">
          ⬇ Export CSV
        </button>
      </div>

      <FilterTabs
        options={TABS}
        active={tab}
        onChange={(t) => {
          setTab(t);
          setPage(0);
        }}
      />

      {pageItems.length === 0 ? (
        <EmptyState icon="👥" title="No students found" subtitle="Add your first subscriber above." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-muted" style={{ borderColor: "var(--border)" }}>
                <th className="p-3">Name / Phone</th>
                <th className="p-3">Plan</th>
                <th className="p-3">Amount</th>
                <th className="hidden p-3 md:table-cell">Code</th>
                <th className="hidden p-3 md:table-cell">Start</th>
                <th className="p-3">Expiry</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((s) => (
                <tr key={s.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="p-3">
                    <div className="font-medium text-text">{s.name}</div>
                    <div className="text-xs text-muted">{s.phone}</div>
                  </td>
                  <td className="p-3 text-muted">{getPlan(s.plan)?.name || s.plan}</td>
                  <td className="p-3 text-muted">{formatINR(s.amount_paid ?? 0)}</td>
                  <td className="hidden p-3 font-mono text-xs text-gold-light md:table-cell">
                    {s.access_code}
                  </td>
                  <td className="hidden p-3 text-muted md:table-cell">{formatDate(s.start_date)}</td>
                  <td className="p-3 text-muted">
                    {s.expiry_date ? formatDate(s.expiry_date) : "∞"}
                  </td>
                  <td className="p-3">
                    <StatusPill expiry={s.expiry_date} isActive={s.is_active} />
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      <ActionBtn
                        onClick={() => patch(s.id, { action: "extend", days: 30 }, "Extended 30 days")}
                        disabled={busy === s.id}
                      >
                        +30d
                      </ActionBtn>
                      <ActionBtn onClick={() => setEditing(s)}>Edit</ActionBtn>
                      <ActionBtn onClick={() => whatsapp(s)}>WA</ActionBtn>
                      <ActionBtn danger onClick={() => revoke(s)} disabled={busy === s.id}>
                        Revoke
                      </ActionBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm text-muted">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="btn-outline px-3 py-1.5 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span>
            Page {page + 1} / {pages}
          </span>
          <button
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            className="btn-outline px-3 py-1.5 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      {editing && (
        <EditStudentModal
          student={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border px-2 py-1 text-xs transition disabled:opacity-40"
      style={{
        borderColor: danger ? "rgba(231,76,60,0.5)" : "var(--border)",
        color: danger ? "#ff9a8f" : "var(--gold-light)",
      }}
    >
      {children}
    </button>
  );
}

function EditStudentModal({
  student,
  onClose,
  onSaved,
}: {
  student: Student;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(student.name);
  const [email, setEmail] = useState(student.email || "");
  const [plan, setPlan] = useState(student.plan);
  const [amount, setAmount] = useState(String(student.amount_paid ?? ""));
  const [targetYear, setTargetYear] = useState(
    student.target_year ? String(student.target_year) : ""
  );
  const [optional, setOptional] = useState(student.optional_subject || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const planObj = getPlan(plan);
      const res = await fetch(`/api/admin/students/${student.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: email || null,
          amount_paid: amount ? Number(amount) : 0,
          target_year: targetYear ? Number(targetYear) : null,
          optional_subject: optional || null,
          months: planObj?.months ?? null,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast("Student updated", "success");
        onSaved();
      } else {
        toast(data.error || "Update failed", "error");
      }
    } catch {
      toast("Update failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${student.name}`}>
      <div className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="Name" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" placeholder="Email" />
        <select value={plan} onChange={(e) => setPlan(e.target.value as Student["plan"])} className="input-field">
          {PLANS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {formatINR(p.price)}
            </option>
          ))}
        </select>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          className="input-field"
          placeholder="Amount paid"
          inputMode="numeric"
        />
        <select value={targetYear} onChange={(e) => setTargetYear(e.target.value)} className="input-field">
          <option value="">Target year — not set</option>
          {[2025, 2026, 2027, 2028, 2029].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <input value={optional} onChange={(e) => setOptional(e.target.value)} className="input-field" placeholder="Optional subject" />
        <p className="text-xs text-muted">
          Changing the plan recalculates expiry from the current start date.
        </p>
        <button onClick={save} disabled={saving} className="btn-gold w-full">
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}
