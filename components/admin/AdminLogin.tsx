"use client";

import { useState } from "react";
import Logo from "@/components/ui/Logo";
import { isDemoMode } from "@/lib/config";

export default function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (data.ok) onSuccess();
      else setError(data.error || "Invalid credentials.");
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-5 flex items-center gap-3">
          <Logo size={40} variant="admin" />
          <div>
            <p className="font-heading text-lg font-extrabold">Admin Panel</p>
            <p className="text-xs text-muted">Naman IAS Academy</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Username</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error && <p className="rounded-xl bg-[#fdeaea] px-3 py-2 text-sm text-danger">{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary w-full">
            {loading ? "Signing in..." : "Sign in →"}
          </button>
        </form>
        {isDemoMode && (
          <p className="mt-4 rounded-xl border border-dashed border-line bg-surface2 px-3 py-2 text-xs text-ink2">
            🔑 Demo mode — admin credentials are in the README / .env.example.
          </p>
        )}
      </div>
    </div>
  );
}
