"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Smartphone, KeyRound, Lock } from "lucide-react";
import { triggerWelcome } from "@/lib/welcome";

type Mode = "login" | "forgot";
type Factor = "ref" | "date";

export default function PortalLoginForm() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forgot-code state
  const [factor, setFactor] = useState<Factor>("ref");
  const [refLast4, setRefLast4] = useState("");
  const [payDate, setPayDate] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);

  async function doLogin(p = phone, c = code) {
    setError(null);
    if (!/^\d{10}$/.test(p) || !c.trim()) {
      setError("Enter your 10-digit mobile number and login code.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: p, code: c.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        triggerWelcome(data.name);
        router.push("/portal");
        router.refresh();
      } else {
        setError(data.error || "Login failed.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function doForgot() {
    setError(null);
    setRevealed(null);
    if (!/^\d{10}$/.test(phone)) {
      setError("Enter your 10-digit mobile number.");
      return;
    }
    if (factor === "ref" && refLast4.replace(/[^a-zA-Z0-9]/g, "").length < 4) {
      setError("Enter the last 4 characters of your payment reference.");
      return;
    }
    if (factor === "date" && !payDate) {
      setError("Select the date you made the payment.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/portal/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, method: factor, refLast4, date: payDate }),
      });
      const data = await res.json();
      if (data.ok && data.loginCode) {
        setRevealed(data.loginCode);
        setCode(data.loginCode);
      } else {
        setError(data.error || "We couldn't verify those details.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lp-card mx-auto max-w-md p-7 sm:p-8">
      {mode === "login" ? (
        <>
          <h1 className="text-xl font-bold text-[var(--navy)]">Access your purchases</h1>
          <p className="mt-1 text-sm text-ink2">Enter your mobile number and the login code from your payment receipt.</p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              doLogin();
            }}
            className="mt-6 space-y-4"
          >
            <div>
              <label className="label">Mobile Number</label>
              <div className="lp-field">
                <Smartphone size={18} className="lp-field-icon" aria-hidden />
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="10-digit mobile"
                  className="lp-input lp-input--icon"
                  autoComplete="tel"
                />
              </div>
            </div>
            <div>
              <label className="label">Login Code</label>
              <div className="lp-field">
                <KeyRound size={18} className="lp-field-icon" aria-hidden />
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 9))}
                  placeholder="e.g. K7P2QXR"
                  className="lp-input lp-input--icon font-mono tracking-[0.2em]"
                  autoComplete="off"
                />
              </div>
            </div>

            {error && <p className="rounded-xl border border-danger/20 bg-[#fdeaea] px-3 py-2 text-sm text-danger">{error}</p>}

            <button type="submit" disabled={loading} className="lp-btn mt-1">
              {loading ? "Logging in…" : (<><Lock size={16} aria-hidden /> Log in →</>)}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode("forgot");
              setError(null);
            }}
            className="mt-5 text-sm font-semibold text-primary hover:underline"
          >
            Forgot your code?
          </button>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold text-[var(--navy)]">Recover your login code</h1>
          <p className="mt-1 text-sm text-ink2">Verify it&apos;s you and we&apos;ll show your code instantly.</p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="label">Mobile Number</label>
              <div className="lp-field">
                <Smartphone size={18} className="lp-field-icon" aria-hidden />
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="10-digit mobile"
                  className="lp-input lp-input--icon"
                  autoComplete="tel"
                />
              </div>
            </div>

            <div>
              <label className="label">Verify with</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFactor("ref")}
                  className={`lp-toggle ${factor === "ref" ? "lp-toggle--active" : ""}`}
                >
                  Reference number
                </button>
                <button
                  type="button"
                  onClick={() => setFactor("date")}
                  className={`lp-toggle ${factor === "date" ? "lp-toggle--active" : ""}`}
                >
                  Payment date
                </button>
              </div>
            </div>

            {factor === "ref" ? (
              <div>
                <div className="lp-panel p-3 text-center">
                  <p className="text-xs text-muted">Your reference looks like this:</p>
                  <p className="mt-1 font-mono text-sm">
                    NAMAN-WEBINAR-MQPAJBGU-
                    <span className="rounded-md bg-primary px-1.5 py-0.5 font-bold text-white">1MKE</span>
                  </p>
                  <p className="mt-2 text-xs text-ink2">
                    Find your reference number on your payment receipt. Enter only the last 4 characters shown highlighted above.
                  </p>
                </div>
                <label className="label mt-3">Last 4 characters</label>
                <input
                  type="text"
                  value={refLast4}
                  onChange={(e) => setRefLast4(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
                  placeholder="1MKE"
                  className="lp-input text-center font-mono text-lg tracking-[0.3em]"
                  autoComplete="off"
                />
              </div>
            ) : (
              <div>
                <label className="label">Date of payment</label>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="lp-input" />
                <p className="mt-1 text-xs text-muted">Enter the date you made the payment.</p>
              </div>
            )}

            {error && <p className="rounded-xl border border-danger/20 bg-[#fdeaea] px-3 py-2 text-sm text-danger">{error}</p>}

            {revealed ? (
              <div className="lp-panel-success p-4 text-center">
                <p className="text-xs text-muted">Your login code</p>
                <p className="mt-1 font-mono text-2xl font-extrabold tracking-[0.3em] text-success">{revealed}</p>
                <button onClick={() => doLogin(phone, revealed)} disabled={loading} className="lp-btn mt-3">
                  {loading ? "Logging in…" : "Log in now →"}
                </button>
              </div>
            ) : (
              <button onClick={doForgot} disabled={loading} className="lp-btn">
                {loading ? "Verifying…" : "Reveal my code"}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
              setRevealed(null);
            }}
            className="mt-4 text-sm font-semibold text-primary hover:underline"
          >
            ← Back to login
          </button>
        </>
      )}
    </div>
  );
}
