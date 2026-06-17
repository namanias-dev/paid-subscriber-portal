"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { isDemoMode, DEMO_STUDENT } from "@/lib/config";

export default function LoginForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!phone.trim() || !code.trim()) {
      setError("Please enter both phone number and access code.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        toast(`Welcome back! 🎯`, "success");
        router.push("/dashboard");
      } else {
        setError(data.error || "Login failed.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card mx-auto max-w-md p-6">
      <h3 className="font-heading text-xl text-text">Already a subscriber? Login here</h3>
      <p className="mt-1 text-sm text-muted">
        Use your registered mobile number and access code (NS-XXXX-XXXX).
      </p>

      <form onSubmit={submit} className="mt-5 space-y-3">
        <div>
          <label className="mb-1 block text-sm text-muted">Mobile Number</label>
          <input
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="10-digit mobile"
            className="input-field"
            autoComplete="tel"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-muted">Access Code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="NS-XXXX-XXXX"
            className="input-field font-mono tracking-wider"
            autoComplete="off"
          />
        </div>

        {error && (
          <p className="rounded-lg bg-[rgba(231,76,60,0.12)] px-3 py-2 text-sm text-[#ff9a8f]">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="btn-gold w-full">
          {loading ? "Logging in..." : "Login to Portal →"}
        </button>
      </form>

      {isDemoMode && (
        <div className="mt-4 rounded-lg border border-dashed px-3 py-2 text-xs text-gold-light" style={{ borderColor: "var(--border)" }}>
          🔑 Demo login — Phone: <b>{DEMO_STUDENT.phone}</b> · Code:{" "}
          <b>{DEMO_STUDENT.code}</b>
        </div>
      )}
    </div>
  );
}
