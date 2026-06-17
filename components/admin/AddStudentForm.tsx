"use client";

import { useState } from "react";
import { PLANS } from "@/lib/config";
import { formatINR, todayISODate } from "@/lib/dates";
import { useToast } from "@/components/ui/Toast";
import AccessCodeBox from "./AccessCodeBox";
import type { Student } from "@/lib/types";

interface Result {
  student: Student;
  whatsappLink: string;
  emailSent: boolean;
}

export default function AddStudentForm({ onAdded }: { onAdded: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [planId, setPlanId] = useState("3m");
  const [amount, setAmount] = useState("");
  const [startDate, setStartDate] = useState(todayISODate());
  const [targetYear, setTargetYear] = useState("");
  const [optional, setOptional] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const selectedPlan = PLANS.find((p) => p.id === planId);
  const amountValue = amount !== "" ? amount : String(selectedPlan?.price ?? "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Name is required.");
    if (!/^\d{10}$/.test(phone)) return setError("Enter a valid 10-digit mobile.");

    setLoading(true);
    try {
      const res = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone,
          email: email.trim() || null,
          plan: planId,
          amount_paid: amountValue ? Number(amountValue) : undefined,
          start_date: startDate,
          target_year: targetYear ? Number(targetYear) : null,
          optional_subject: optional.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult({
          student: data.student,
          whatsappLink: data.whatsappLink,
          emailSent: data.emailSent,
        });
        toast(`${data.student.name} added! ✅`, "success");
        setName("");
        setPhone("");
        setEmail("");
        setAmount("");
        setTargetYear("");
        setOptional("");
        onAdded();
      } else {
        setError(data.error || "Failed to add student.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-5">
      <h3 className="mb-4 font-heading text-lg text-text">Add Subscriber</h3>

      {result && (
        <div
          className="mb-4 rounded-xl border p-4"
          style={{ borderColor: "var(--gold)", background: "rgba(201,168,76,0.08)" }}
        >
          <p className="mb-2 text-sm text-text">
            ✅ <b>{result.student.name}</b> added. Share the access code:
          </p>
          <AccessCodeBox code={result.student.access_code} whatsappLink={result.whatsappLink} />
          <p className="mt-2 text-xs text-muted">
            {result.emailSent ? "Welcome email sent." : "Email skipped (no Resend key / no email)."}
          </p>
        </div>
      )}

      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Name *">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="Full name" />
        </Field>
        <Field label="Mobile (10 digits) *">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            className="input-field"
            placeholder="9876543210"
            inputMode="numeric"
          />
        </Field>
        <Field label="Email (optional)">
          <input value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" placeholder="name@email.com" />
        </Field>
        <Field label="Plan">
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="input-field">
            {PLANS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {formatINR(p.price)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount Paid (₹)">
          <input
            value={amountValue}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            className="input-field"
            inputMode="numeric"
          />
        </Field>
        <Field label="Start Date">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field" />
        </Field>
        <Field label="Target Year (optional)">
          <select value={targetYear} onChange={(e) => setTargetYear(e.target.value)} className="input-field">
            <option value="">Not set</option>
            {[2025, 2026, 2027, 2028, 2029].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Optional Subject (optional)">
          <input value={optional} onChange={(e) => setOptional(e.target.value)} className="input-field" placeholder="e.g. Sociology" />
        </Field>

        {error && (
          <p className="rounded-lg bg-[rgba(231,76,60,0.12)] px-3 py-2 text-sm text-[#ff9a8f] sm:col-span-2">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="btn-gold sm:col-span-2">
          {loading ? "Adding..." : "Add Subscriber & Generate Code"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      {children}
    </label>
  );
}
