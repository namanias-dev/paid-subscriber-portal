"use client";

import { useState } from "react";
import Logo from "@/components/ui/Logo";
import { isDemoMode, DEMO_ADMIN } from "@/lib/config";

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
      if (data.ok) {
        onSuccess();
      } else {
        setError(data.error || "Login failed.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-4 flex items-center gap-2">
          <Logo size={40} variant="red" />
          <div>
            <h1 className="font-heading text-lg text-text">Admin Panel</h1>
            <p className="text-xs text-muted">Naman IAS Academy</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="input-field"
            autoComplete="username"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="input-field"
            autoComplete="current-password"
          />
          {error && (
            <p className="rounded-lg bg-[rgba(231,76,60,0.12)] px-3 py-2 text-sm text-[#ff9a8f]">
              {error}
            </p>
          )}
          <button type="submit" disabled={loading} className="btn-gold w-full">
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {isDemoMode && (
          <div className="mt-4 rounded-lg border border-dashed px-3 py-2 text-xs text-gold-light" style={{ borderColor: "var(--border)" }}>
            🔑 Demo admin — {DEMO_ADMIN.username} / {DEMO_ADMIN.password}
          </div>
        )}
      </div>
    </div>
  );
}
