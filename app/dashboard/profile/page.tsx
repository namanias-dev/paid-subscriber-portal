"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "@/components/dashboard/DashboardContext";
import RenewModal from "@/components/dashboard/RenewModal";
import StatusPill from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/Toast";
import { getPlan } from "@/lib/config";
import { formatDate, daysLeft } from "@/lib/dates";

export default function ProfilePage() {
  const { loading, student, updateProfile } = useDashboard();
  const router = useRouter();
  const { toast } = useToast();
  const [renewOpen, setRenewOpen] = useState(false);
  const [targetYear, setTargetYear] = useState("");
  const [optional, setOptional] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (student) {
      setTargetYear(student.target_year ? String(student.target_year) : "");
      setOptional(student.optional_subject || "");
    }
  }, [student]);

  async function save() {
    setSaving(true);
    await updateProfile({
      target_year: targetYear ? Number(targetYear) : null,
      optional_subject: optional || null,
    });
    setSaving(false);
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    toast("Logged out", "success");
    router.replace("/login");
  }

  if (loading || !student) {
    return <div className="card h-64 animate-pulse" />;
  }

  const plan = getPlan(student.plan ?? "");
  const lifetime = student.expiry_date === null;
  const left = daysLeft(student.expiry_date);
  const years = [2025, 2026, 2027, 2028, 2029];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="font-heading text-2xl">Profile</h1>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-heading text-xl">{student.name}</p>
            <p className="text-sm text-muted">{student.phone}</p>
            {student.email && <p className="text-sm text-muted">{student.email}</p>}
          </div>
          <StatusPill expiry={student.expiry_date} isActive={student.is_active} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Info label="Plan" value={plan?.name || student.plan || "—"} />
          <Info label="Access Code" value={student.access_code} mono />
          <Info label="Start Date" value={formatDate(student.start_date)} />
          <Info
            label="Valid Till"
            value={lifetime ? "∞ Lifetime" : formatDate(student.expiry_date)}
          />
          {!lifetime && (
            <Info label="Days Remaining" value={`${Math.max(0, left)} days`} />
          )}
          <Info label="Amount Paid" value={`₹${student.amount_paid ?? 0}`} />
        </div>

        <button onClick={() => setRenewOpen(true)} className="btn btn-primary mt-5 w-full">
          Renew / Upgrade Plan
        </button>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 font-heading text-lg">UPSC Preferences</h3>
        <label className="mb-1 block text-sm text-muted">Target Prelims Year</label>
        <select value={targetYear} onChange={(e) => setTargetYear(e.target.value)} className="input mb-4">
          <option value="">Not set</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-sm text-muted">Optional Subject</label>
        <input
          value={optional}
          onChange={(e) => setOptional(e.target.value)}
          list="optionals"
          placeholder="e.g. Sociology"
          className="input mb-4"
        />
        <datalist id="optionals">
          {["Sociology", "PSIR", "Geography", "Anthropology", "History", "Public Administration"].map(
            (o) => (
              <option key={o} value={o} />
            )
          )}
        </datalist>

        <button onClick={save} disabled={saving} className="btn btn-primary w-full">
          {saving ? "Saving..." : "Save Preferences"}
        </button>
      </div>

      <button onClick={logout} className="btn btn-secondary w-full">
        Logout
      </button>

      <RenewModal
        open={renewOpen}
        onClose={() => setRenewOpen(false)}
        currentPlan={student.plan ?? undefined}
      />
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={mono ? "font-mono text-primary" : "text-ink"}>{value}</p>
    </div>
  );
}
