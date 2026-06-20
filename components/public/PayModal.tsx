"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import { startPayment, type StartPaymentInput } from "@/lib/startPayment";
import { formatINR } from "@/lib/dates";

/**
 * Reusable name/email/mobile form that starts an Eazypay payment.
 * Used for items that don't already collect details (plans, paid webinars).
 * No crypto here — it just calls /api/v1/bank/create-payment.
 */
export default function PayModal({
  open,
  onClose,
  title,
  amount,
  payload,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  amount: number;
  payload: Omit<StartPaymentInput, "name" | "email" | "mobile">;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Please enter your full name.");
    if (!/^\d{10}$/.test(mobile)) return setError("Enter a valid 10-digit mobile number.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");

    setLoading(true);
    const result = await startPayment({
      ...payload,
      name: name.trim(),
      email: email.trim(),
      mobile,
    });
    if (!result.ok) {
      setError(result.error || "Could not start payment.");
      setLoading(false);
    }
    // On success the helper navigates away.
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-3">
        <input className="input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className="input"
          placeholder="10-digit mobile"
          inputMode="numeric"
          value={mobile}
          onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
        />
        <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={loading} className="btn btn-primary w-full">
          {loading ? "Starting…" : `Pay ${formatINR(amount)} →`}
        </button>
        <p className="text-center text-xs text-muted">Secure checkout via ICICI Eazypay.</p>
      </form>
    </Modal>
  );
}
