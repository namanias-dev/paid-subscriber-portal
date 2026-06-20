"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { isDemoMode } from "@/lib/config";

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
        toast("Welcome back! 🎯", "success");
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
      <h3 className="text-xl">Student Login</h3>
      <p className="mt-1 text-sm text-ink2">Use your registered mobile number and access code (NS-XXXX-XXXX).</p>

      <form onSubmit={submit} className="mt-5 space-y-3">
        <div>
          <label className="label">Mobile Number</label>
          <input
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="10-digit mobile"
            className="input"
            autoComplete="tel"
          />
        </div>
        <div>
          <label className="label">Access Code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="NS-XXXX-XXXX"
            className="input font-mono tracking-wider"
            autoComplete="off"
          />
        </div>

        {error && <p className="rounded-xl bg-[#fdeaea] px-3 py-2 text-sm text-danger">{error}</p>}

        <button type="submit" disabled={loading} className="btn btn-primary w-full">
          {loading ? "Logging in..." : "Login to Portal →"}
        </button>
      </form>

      {isDemoMode && (
        <div className="mt-4 rounded-xl border border-dashed border-line bg-surface2 px-3 py-2 text-xs text-ink2">
          🔑 Demo mode is on. Demo credentials are listed in the README / .env.example.
        </div>
      )}
    </div>
  );
}
