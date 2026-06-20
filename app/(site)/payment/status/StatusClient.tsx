"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatINR } from "@/lib/dates";

interface StatusData {
  status: string;
  item: string;
  itemType: string;
  amount: number;
  gatewayRef: string | null;
  demo: boolean;
}

const TERMINAL = new Set(["PAID", "FAILED", "captured", "refunded"]);

export default function StatusClient() {
  const params = useSearchParams();
  const ref = params.get("ref") || "";
  const demo = params.get("demo") === "1";

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
        const qs = demo ? "?demo=1" : "";
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
  }, [ref, demo]);

  const status = data?.status ?? "PENDING";
  const isPaid = status === "PAID" || status === "captured";
  const isFailed = status === "FAILED";
  const isPending = !isPaid && !isFailed;

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
                  isPaid
                    ? "bg-success/10 text-success"
                    : isFailed
                      ? "bg-danger/10 text-danger"
                      : "bg-primary/10 text-primary"
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
                  <Row label="Amount" value={data.amount > 0 ? formatINR(data.amount) : "Free"} />
                  <Row label="Reference" value={ref} mono />
                  {data.gatewayRef && <Row label="Gateway Ref" value={data.gatewayRef} mono />}
                  <Row label="Status" value={status} />
                </div>
              )}
              {data?.demo && (
                <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Demo mode — this payment was simulated. Connect ICICI Eazypay (set the AES key) to process real
                  transactions.
                </p>
              )}
              {isPending && (
                <p className="mt-4 text-xs text-muted">
                  Still confirming with the bank. This page refreshes automatically.
                </p>
              )}
            </>
          )}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {isPaid && (
              <Link href="/login" className="btn btn-primary">
                Go to your portal →
              </Link>
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
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={`font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}
