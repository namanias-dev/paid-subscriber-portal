"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.error || "Login failed.");
        setBusy(false);
        return;
      }
      router.replace("/aiva");
      router.refresh();
    } catch {
      setError("Network error.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="aiva-card aiva-card-pad space-y-4">
      <div>
        <label className="aiva-label" htmlFor="u">Username</label>
        <input id="u" className="aiva-input mt-1" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
      </div>
      <div>
        <label className="aiva-label" htmlFor="p">Password</label>
        <input id="p" type="password" className="aiva-input mt-1" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <button type="submit" className="aiva-btn-primary w-full" disabled={busy}>
        {busy ? "Signing in…" : "Enter AIVA"}
      </button>
      <p className="text-center text-xs text-muted">Uses your existing Naman IAS admin credentials.</p>
    </form>
  );
}
