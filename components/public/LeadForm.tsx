"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { COURSE_CATEGORIES } from "@/lib/config";

export default function LeadForm({
  source = "Website",
  campaign,
  compact,
  cta = "Get Free Counselling",
}: {
  source?: string;
  campaign?: string;
  compact?: boolean;
  cta?: string;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [interest, setInterest] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !/^\d{10}$/.test(phone)) {
      setError("Enter your name and a valid 10-digit mobile.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/public/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone, city, course_interest: interest, source, campaign, source_form: "public_lead_form" }),
      });
      const data = await res.json();
      if (data.ok) {
        setDone(true);
        toast("Thanks! Our team will call you soon. 🎯", "success");
      } else {
        setError(data.error || "Something went wrong.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-line bg-surface2 p-6 text-center">
        <div className="mb-2 flex justify-center text-[var(--success)]">
          <CheckCircle2 size={36} strokeWidth={2} aria-hidden="true" />
        </div>
        <p className="font-heading text-lg">Request received!</p>
        <p className="mt-1 text-sm text-ink2">Naman Sir&apos;s team will reach out shortly.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={compact ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}>
      <div>
        <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <input
          className="input"
          placeholder="10-digit mobile"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
        />
      </div>
      <div>
        <input className="input" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
      </div>
      <div>
        <select className="input" value={interest} onChange={(e) => setInterest(e.target.value)}>
          <option value="">Interested in...</option>
          {COURSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      {error && <p className={`text-sm text-danger ${compact ? "sm:col-span-2" : ""}`}>{error}</p>}
      <button type="submit" disabled={loading} className={`btn btn-primary ${compact ? "sm:col-span-2" : "w-full"}`}>
        {loading ? "Submitting..." : cta}
      </button>
    </form>
  );
}
