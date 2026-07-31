"use client";

/**
 * Public unified login form (buyer + student).
 *
 * VISUAL POLISH ONLY — do not change:
 *  - /api/auth/login payload ({ phone, code })
 *  - validation rules beyond what already existed
 *  - redirect targets from the API response
 *  - forgot-code flow (/api/portal/forgot)
 *
 * Login codes are intentionally a single free-text field: buyer codes are
 * 7–9 alphanumeric, student access codes keep dashes (NS-XXXX-XXXX). Segmented
 * OTP-style boxes would break student login — never add them here.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Smartphone, KeyRound, Lock, Check } from "lucide-react";
import { isDemoMode } from "@/lib/config";
import { triggerWelcome } from "@/lib/welcome";

type Mode = "login" | "forgot";
type Factor = "ref" | "date";
/** Staged post-auth UI only — never changes the API call. */
type SuccessPhase = "idle" | "verified" | "welcome";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export default function LoginForm() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<SuccessPhase>("idle");
  const [shake, setShake] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forgot-code state
  const [factor, setFactor] = useState<Factor>("ref");
  const [refLast4, setRefLast4] = useState("");
  const [payDate, setPayDate] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);

  const locked = loading || phase !== "idle";
  const verified = phase === "verified" || phase === "welcome";
  const welcomed = phase === "welcome";

  function flashError(msg: string) {
    setError(msg);
    setPhase("idle");
    setShake(true);
    window.setTimeout(() => setShake(false), 450);
  }

  /**
   * After backend confirms success: green verify → Welcome back → overlay flag → redirect.
   * Auth already completed; this only spaces presentation so each beat is visible.
   */
  async function finishSuccess(name: string | undefined, redirect: string) {
    setLoading(false);
    if (prefersReducedMotion()) {
      setPhase("welcome");
      triggerWelcome(name);
      router.push(redirect);
      router.refresh();
      return;
    }
    setPhase("verified");
    await sleep(900);
    setPhase("welcome");
    await sleep(650);
    triggerWelcome(name);
    await sleep(280);
    router.push(redirect);
    router.refresh();
  }

  async function doLogin(p = phone, c = code) {
    setError(null);
    setPhase("idle");
    if (!p.trim() || !c.trim()) {
      flashError("Please enter both your mobile number and login code.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: p.trim(), code: c.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        await finishSuccess(data.student?.name ?? data.name, data.redirect || "/dashboard");
      } else {
        flashError(data.error || "Login failed.");
      }
    } catch {
      flashError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function doForgot() {
    setError(null);
    setRevealed(null);
    if (!/^\d{10}$/.test(phone)) {
      flashError("Enter your 10-digit mobile number.");
      return;
    }
    if (factor === "ref" && refLast4.replace(/[^a-zA-Z0-9]/g, "").length < 4) {
      flashError("Enter the last 4 characters of your payment reference.");
      return;
    }
    if (factor === "date" && !payDate) {
      flashError("Select the date you made the payment.");
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
        flashError(data.error || "We couldn't verify those details.");
      }
    } catch {
      flashError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const cardClass = [
    "lp-card mx-auto max-w-md p-7 sm:p-8",
    shake ? "lp-card--shake lp-card--error" : "",
    verified ? "lp-card--success" : "",
    welcomed ? "lp-card--welcome" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (mode === "forgot") {
    return (
      <div className={cardClass}>
        <h3 className="text-xl font-bold text-[var(--navy)]">Recover your login code</h3>
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

          {error && <p className="rounded-xl border border-danger/20 bg-[#fdeaea] px-3 py-2 text-sm text-danger" role="alert">{error}</p>}

          {revealed ? (
            <div className="lp-panel-success p-4 text-center">
              <p className="text-xs text-muted">Your login code</p>
              <p className="mt-1 font-mono text-2xl font-extrabold tracking-[0.3em] text-success">{revealed}</p>
              <button onClick={() => doLogin(phone, revealed)} disabled={locked} className={`lp-btn mt-3 ${loading ? "lp-btn--loading" : ""} ${verified ? "lp-btn--success" : ""}`}>
                {welcomed ? (<><span className="lp-success-check"><Check size={14} strokeWidth={3} aria-hidden /></span> Welcome back</>) : verified ? (<><span className="lp-success-check"><Check size={14} strokeWidth={3} aria-hidden /></span> Login verified</>) : loading ? "Logging in…" : "Log in now →"}
              </button>
            </div>
          ) : (
            <button onClick={doForgot} disabled={loading} className={`lp-btn ${loading ? "lp-btn--loading" : ""}`}>
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
            setShake(false);
            setPhase("idle");
          }}
          className="lp-forgot mt-5 text-sm font-semibold text-primary hover:underline"
        >
          ← Back to login
        </button>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <h3 key={phase} className={`flex items-center gap-2 text-xl font-bold text-[var(--navy)] ${welcomed || verified ? "lp-heading-swap" : ""}`}>
        {welcomed ? (
          <>
            <span className="lp-success-check"><Check size={14} strokeWidth={3} aria-hidden /></span>
            Welcome back
          </>
        ) : verified ? (
          <>
            <span className="lp-success-check"><Check size={14} strokeWidth={3} aria-hidden /></span>
            Verified
          </>
        ) : (
          "Login"
        )}
      </h3>
      <p className="mt-1 text-sm text-ink2">
        {welcomed
          ? "Taking you to your dashboard…"
          : verified
            ? "Login confirmed — just a moment…"
            : "Use your registered mobile number and the login code from your payment receipt."}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!locked) doLogin();
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
              disabled={locked}
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
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. K7P2QXR"
              className="lp-input lp-input--icon font-mono tracking-[0.2em]"
              autoComplete="off"
              disabled={locked}
              spellCheck={false}
            />
          </div>
        </div>

        {error && <p className="rounded-xl border border-danger/20 bg-[#fdeaea] px-3 py-2 text-sm text-danger" role="alert">{error}</p>}

        <button
          type="submit"
          disabled={locked}
          className={`lp-btn mt-1 ${loading ? "lp-btn--loading" : ""} ${verified ? "lp-btn--success" : ""}`}
        >
          {welcomed ? (
            <><span className="lp-success-check"><Check size={14} strokeWidth={3} aria-hidden /></span> Welcome back</>
          ) : verified ? (
            <><span className="lp-success-check"><Check size={14} strokeWidth={3} aria-hidden /></span> Login verified</>
          ) : loading ? (
            "Logging in..."
          ) : (
            <><Lock size={16} aria-hidden /> Log in →</>
          )}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode("forgot");
          setError(null);
          setShake(false);
        }}
        className="lp-forgot mt-5 text-sm font-semibold text-primary hover:underline"
        disabled={locked}
      >
        Forgot your code?
      </button>

      {isDemoMode && (
        <div className="mt-4 rounded-xl border border-dashed border-line bg-surface2 px-3 py-2 text-xs text-ink2">
          🔑 Demo mode is on. Demo credentials are listed in the README / .env.example.
        </div>
      )}
    </div>
  );
}
