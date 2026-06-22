"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatINR } from "@/lib/dates";

interface Contact {
  name: string;
  address: string;
  phone: string;
  email: string;
  whatsapp: string;
  logoUrl: string | null;
  logoAlt: string;
}

interface StatusData {
  status: string;
  item: string;
  itemType: string;
  amount: number;
  gatewayRef: string | null;
  loginCode?: string | null;
  demo: boolean;
  awaiting?: boolean;
}

const TERMINAL = new Set(["PAID", "FAILED", "captured", "refunded"]);

export default function StatusClient({ contact }: { contact: Contact }) {
  const params = useSearchParams();
  const ref = params.get("ref") || "";
  const demo = params.get("demo") === "1";
  const st = params.get("st");
  const amt = params.get("amt");
  const sig = params.get("sig");

  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ref) {
      setError("No payment reference provided.");
      setLoading(false);
      return;
    }
    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      attempts += 1;
      try {
        const q = new URLSearchParams();
        if (demo) q.set("demo", "1");
        if (st) q.set("st", st);
        if (amt) q.set("amt", amt);
        if (sig) q.set("sig", sig);
        const qs = q.toString() ? `?${q.toString()}` : "";
        const res = await fetch(`/api/v1/bank/payment-status/${encodeURIComponent(ref)}${qs}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!active) return;
        if (!json.ok) {
          setError(json.error || "Could not fetch payment status.");
          setLoading(false);
          return;
        }
        setData(json as StatusData);
        setLoading(false);
        if (!TERMINAL.has(json.status) && attempts < 15) {
          timer = setTimeout(poll, 2000);
        }
      } catch {
        if (!active) return;
        if (attempts < 15) {
          timer = setTimeout(poll, 2000);
        } else {
          setError("Could not fetch payment status.");
          setLoading(false);
        }
      }
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [ref, demo, st, amt, sig]);

  const status = data?.status ?? "PENDING";
  const isPaid = status === "PAID" || status === "captured";
  const isFailed = status === "FAILED";
  const isPending = !isPaid && !isFailed;
  const loginCode = data?.loginCode || null;
  const amountLabel = data && data.amount > 0 ? formatINR(data.amount) : "Free";
  const dateLabel = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="container-wide section">
      <div className="mx-auto max-w-lg">
        <div className="card p-8 text-center">
          {loading && !data ? (
            <>
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-line border-t-primary" />
              <h1 className="text-2xl">Checking payment…</h1>
              <p className="mt-2 text-sm text-muted">Please wait while we confirm your transaction.</p>
            </>
          ) : error ? (
            <>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-2xl text-danger">!</div>
              <h1 className="text-2xl">Something went wrong</h1>
              <p className="mt-2 text-sm text-muted">{error}</p>
            </>
          ) : (
            <>
              <div
                className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-2xl ${
                  isPaid ? "bg-success/10 text-success" : isFailed ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary"
                }`}
              >
                {isPaid ? "✓" : isFailed ? "✕" : "…"}
              </div>
              <h1 className="text-2xl">
                {isPaid ? "Payment Successful" : isFailed ? "Payment Failed" : "Payment Pending"}
              </h1>
              {data && (
                <div className="mt-5 space-y-2 rounded-xl bg-surface p-4 text-left text-sm">
                  <Row label="Item" value={data.item} />
                  <Row label="Amount" value={amountLabel} />
                  <Row label="Reference" value={ref} mono />
                  {data.gatewayRef && <Row label="Gateway Ref" value={data.gatewayRef} mono />}
                  <Row label="Status" value={status} />
                </div>
              )}

              {/* Login code + portal instructions */}
              {isPaid && loginCode && (
                <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-4 text-left">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">Your login code</p>
                  <p className="mt-1 text-center font-mono text-3xl font-extrabold tracking-[0.3em] text-primary">{loginCode}</p>
                  <p className="mt-3 text-sm text-ink2">
                    Go to <span className="font-semibold">{siteOrigin()}/portal</span>, enter your <b>mobile number</b> and this{" "}
                    <b>login code</b> to access what you purchased. Save this code — you&apos;ll need it every time you log in.
                  </p>
                </div>
              )}

              {isPaid && !loginCode && (
                <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Your login code will appear here shortly. If it doesn&apos;t, use &quot;Forgot your code?&quot; on the portal
                  login page to retrieve it.
                </p>
              )}

              {data?.demo && (
                <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Demo mode — this payment was simulated. Connect ICICI Eazypay (set the AES key) to process real transactions.
                </p>
              )}
              {isPending && (
                <p className="mt-4 text-xs text-muted">Still confirming with the bank. This page refreshes automatically.</p>
              )}
            </>
          )}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {isPaid && (
              <Link href="/portal/login" className="btn btn-primary">
                Go to your portal →
              </Link>
            )}
            {isPaid && (
              <button onClick={() => window.print()} className="btn btn-secondary">
                Download receipt (PDF)
              </button>
            )}
            {isFailed && (
              <Link href="/courses" className="btn btn-primary">
                Try again
              </Link>
            )}
            <Link href="/" className="btn btn-secondary">
              Back to home
            </Link>
          </div>

          {/* Trust signals */}
          {isPaid && (
            <div className="mt-6 border-t border-line pt-4 text-xs text-muted">
              <p className="font-semibold text-ink">{contact.name}</p>
              <p className="mt-1">{contact.address}</p>
              <p className="mt-1">
                {contact.phone} · {contact.email}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Print-only official receipt (hidden on screen; shown by print CSS) */}
      {isPaid && data && (
        <ReceiptDoc
          contact={contact}
          item={data.item}
          amount={amountLabel}
          reference={ref}
          gatewayRef={data.gatewayRef}
          loginCode={loginCode}
          date={dateLabel}
        />
      )}
    </div>
  );
}

function siteOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={`font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function ReceiptDoc({
  contact,
  item,
  amount,
  reference,
  gatewayRef,
  loginCode,
  date,
}: {
  contact: Contact;
  item: string;
  amount: string;
  reference: string;
  gatewayRef: string | null;
  loginCode: string | null;
  date: string;
}) {
  const portalUrl = `${siteOrigin()}/portal`;
  return (
    <div className="receipt-print" style={{ color: "#0a0a0a", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: 32, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "3px solid #0057FF", paddingBottom: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {contact.logoUrl ? (
            <img src={contact.logoUrl} alt={contact.logoAlt} style={{ height: 48, width: "auto" }} />
          ) : (
            <div
              style={{
                height: 48,
                width: 48,
                borderRadius: 12,
                background: "#0057FF",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 24,
              }}
            >
              N
            </div>
          )}
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{contact.name}</div>
            <div style={{ fontSize: 12, color: "#555" }}>Official Payment Receipt</div>
          </div>
        </div>

        <h2 style={{ color: "#0a8a3a", fontSize: 22, margin: "20px 0 4px" }}>Payment Successful</h2>
        <div style={{ fontSize: 12, color: "#555" }}>{date}</div>

        {/* Details */}
        <table style={{ width: "100%", marginTop: 20, borderCollapse: "collapse", fontSize: 14 }}>
          <tbody>
            {[
              ["Item", item],
              ["Amount", amount],
              ["Reference", reference],
              ...(gatewayRef ? [["Gateway Ref", gatewayRef] as [string, string]] : []),
              ["Status", "PAID"],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: "8px 0", color: "#555", borderBottom: "1px solid #eee", width: 160 }}>{k}</td>
                <td style={{ padding: "8px 0", fontWeight: 600, borderBottom: "1px solid #eee" }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Login code */}
        {loginCode && (
          <div style={{ marginTop: 20, border: "2px solid #0057FF", borderRadius: 12, padding: 16, textAlign: "center" }}>
            <div style={{ fontSize: 11, letterSpacing: 1, color: "#0057FF", fontWeight: 700, textTransform: "uppercase" }}>
              Your Login Code
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, color: "#0057FF", marginTop: 6, fontFamily: "monospace" }}>
              {loginCode}
            </div>
          </div>
        )}

        {/* Instructions */}
        <div style={{ marginTop: 16, fontSize: 13, color: "#333", lineHeight: 1.6 }}>
          <b>How to access your purchase:</b>
          <br />
          1. Go to <b>{portalUrl}</b>
          <br />
          2. Enter your <b>mobile number</b> and the <b>login code</b> above.
          <br />
          3. You&apos;ll see everything you&apos;ve purchased.
        </div>

        {/* Contact */}
        <div style={{ marginTop: 24, borderTop: "1px solid #eee", paddingTop: 16, fontSize: 12, color: "#555" }}>
          <div style={{ fontWeight: 700, color: "#0a0a0a" }}>{contact.name}</div>
          <div>{contact.address}</div>
          <div>
            Phone: {contact.phone} &nbsp;|&nbsp; WhatsApp: {contact.whatsapp}
          </div>
          <div>Email: {contact.email}</div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#999" }}>
            This is a system-generated receipt. Keep your login code confidential.
          </div>
        </div>
      </div>
    </div>
  );
}
