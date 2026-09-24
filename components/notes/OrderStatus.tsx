"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { trackClient } from "@/lib/analytics/client";
import type { PublicOrder } from "@/lib/store/orders";

/** ~90s of confirmation polling with gentle backoff. Cron remains recovery. */
const MAX_MS = 90_000;
const GAPS_MS = [2000, 2500, 3000, 4000, 5000, 6000, 8000];

export default function OrderStatus({ order }: { order: PublicOrder }) {
  const [current, setCurrent] = useState(order);
  const [stillWaiting, setStillWaiting] = useState(false);
  const [reportReason, setReportReason] = useState("damaged");
  const [reportText, setReportText] = useState("");
  const [reportState, setReportState] = useState<string | null>(null);
  const completedFired = useRef(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    setCurrent(order);
    setStillWaiting(false);
  }, [order]);

  useEffect(() => {
    if (completedFired.current) return;
    if (!current.confirming && current.steps.some((s) => s.done)) {
      completedFired.current = true;
      trackClient("notes_order_completed", { order_no: current.order_no });
      if (current.offer_id) {
        trackClient("notes_offer_order_completed", { offer_id: current.offer_id, order_no: current.order_no });
      }
    }
  }, [current]);

  useEffect(() => {
    if (!current.confirming) return;
    const token = current.access_token;
    if (!token) return;
    let cancelled = false;
    const started = Date.now();
    let gapIdx = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      try {
        const res = await fetch(`/api/notes/order/${encodeURIComponent(current.order_no)}/verify`, {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ t: token }),
        });
        const json = await res.json();
        if (!cancelled && json.ok && json.order) {
          setCurrent(json.order);
          if (!json.order.confirming) return;
        }
      } catch {
        /* next tick retries */
      }
      if (cancelled) return;
      const elapsed = Date.now() - started;
      if (elapsed >= MAX_MS) {
        setStillWaiting(true);
        return;
      }
      const gap = GAPS_MS[Math.min(gapIdx, GAPS_MS.length - 1)];
      gapIdx += 1;
      timer = setTimeout(() => {
        void run();
      }, gap);
    };
    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [current.confirming, current.order_no, current.access_token]);

  const confirmed = !current.confirming && current.stage !== "failed";
  const exception = ["delivery_issue", "returning", "return_open", "refund", "refunded"].includes(current.stage);
  const nextStep =
    current.stage === "delivered"
      ? "Your notes have been delivered. If anything arrived damaged, wrong, or incomplete, contact support with this order number."
      : current.stage === "delivery_issue"
        ? "The courier could not complete this delivery. Naman IAS will follow up. You do not need to contact the courier yourself."
        : current.stage === "returning"
          ? "This parcel is on the way back to Naman IAS. We will contact you about the next step."
          : current.stage === "return_open"
            ? "We have your report and will review it. No return shipment has been booked yet."
            : current.stage === "refund"
              ? "Refund pending manual payment-gateway processing."
              : current.stage === "refunded"
                ? "The refund has been recorded. The payment gateway processes the money separately."
                : current.stage === "shipped" || current.stage === "in_transit" || current.stage === "out_for_delivery"
                  ? "The parcel is with the courier. Use the AWB above if it is available."
                  : current.stage === "packed"
                    ? "Your notes are packed in Chandigarh. They ship when the courier picks the parcel up."
                    : "The Academy prepares and packs your notes in Chandigarh, then hands them to the courier. You can track this order with your phone number anytime.";

  return (
    <div className="mx-auto max-w-xl">
      {confirmed && !exception && (
        <motion.p
          className="ca-eyebrow"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          Order confirmed
        </motion.p>
      )}
      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark,#9a7b2f)]">{current.order_no}</p>
      <h1 className="mt-2 font-heading text-3xl font-bold text-[var(--ca-navy)]">
        {current.confirming ? "Payment received — confirming your order" : current.stage_label}
      </h1>
      {current.confirming && (
        <p className="mt-2 text-sm text-[var(--ca-navy)]/60">
          Waiting for ICICI to confirm the payment. This page does not mark the order paid itself.
        </p>
      )}
      {stillWaiting && current.confirming && (
        <p className="mt-3 rounded-xl border border-[var(--ca-navy)]/10 bg-[var(--ca-navy)]/[0.03] p-3 text-sm text-[var(--ca-navy)]/75">
          Confirmation is taking a little longer than usual. You can leave this page — we will keep checking in the background, and you can track the order anytime with your phone number.
        </p>
      )}
      {current.promised_delivery_date && (
        <p className="mt-2 text-sm text-[var(--ca-navy)]/60">Promised by {current.promised_delivery_date}</p>
      )}
      {current.ship_to && (
        <p className="mt-2 text-sm text-[var(--ca-navy)]/65">
          <span className="font-semibold text-[var(--ca-navy)]">Delivering to</span> {current.ship_to}
        </p>
      )}
      <ol className="mt-8 space-y-0">
        {current.steps.map((s, i) => (
          <li key={s.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`mt-1 h-3 w-3 rounded-full ${s.done ? "bg-[var(--ca-gold,#d4af37)]" : "bg-[var(--ca-navy)]/20"}`} />
              {i < current.steps.length - 1 && <span className={`w-px flex-1 ${s.done ? "bg-[var(--ca-gold)]/50" : "bg-[var(--ca-navy)]/10"}`} />}
            </div>
            <div className="pb-5">
              <p className={s.done ? "font-semibold text-[var(--ca-navy)]" : "text-[var(--ca-navy)]/40"}>{s.label}</p>
            </div>
          </li>
        ))}
      </ol>
      <ul className="mt-2 divide-y rounded-3xl bg-white ns-elev-1">
        {current.items.map((it, i) => (
          <li key={i} className="flex justify-between p-4 text-sm">
            <span>
              {it.name} × {it.qty}
            </span>
            <span className="tabular-nums">{it.total}</span>
          </li>
        ))}
        <li className="flex justify-between p-4 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{current.total_label}</span>
        </li>
      </ul>
      {current.awb && (
        <p className="mt-4 text-sm text-[var(--ca-navy)]/70">
          {current.courier} · AWB {current.awb}
        </p>
      )}
      <div className="mt-6 rounded-3xl bg-white p-4 text-sm text-[var(--ca-navy)]/70 ns-elev-1">
        <p className="font-semibold text-[var(--ca-navy)]">What happens next</p>
        <p className="mt-1">{nextStep}</p>
      </div>
      {(current.stage === "delivered" || current.stage === "delivery_issue") && current.access_token && (
        <form
          className="mt-4 rounded-3xl bg-white p-4 ns-elev-1"
          onSubmit={async (e) => {
            e.preventDefault();
            setReportState(null);
            const res = await fetch(`/api/notes/order/${encodeURIComponent(current.order_no)}/support`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ t: current.access_token, reason: reportReason, description: reportText }),
            });
            const json = await res.json();
            setReportState(json.ok ? "Sent. The academy will review this order." : json.error || "Could not send the report.");
          }}
        >
          <p className="text-sm font-semibold text-[var(--ca-navy)]">Report a problem</p>
          <p className="mt-1 text-xs text-[var(--ca-navy)]/60">Damaged, wrong, missing, or incomplete notes. This does not start a return shipment by itself.</p>
          <select
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            className="mt-3 h-11 w-full rounded-xl border border-[var(--ca-navy)]/15 px-3 text-sm"
          >
            <option value="damaged">Damaged notes</option>
            <option value="wrong_subject">Wrong subject</option>
            <option value="missing_item">Missing book</option>
            <option value="incomplete_pages">Incomplete pages</option>
            <option value="print_defect">Print defect</option>
            <option value="delivery_problem">Delivery problem</option>
          </select>
          <textarea
            value={reportText}
            onChange={(e) => setReportText(e.target.value)}
            required
            minLength={8}
            rows={3}
            placeholder="What should the academy check?"
            className="mt-2 w-full rounded-xl border border-[var(--ca-navy)]/15 px-3 py-2 text-sm"
          />
          <button type="submit" className="mt-2 h-11 rounded-full bg-[var(--ca-navy)] px-5 text-sm font-semibold text-white">
            Send report
          </button>
          {reportState && <p className="mt-2 text-sm text-[var(--ca-navy)]/70">{reportState}</p>}
        </form>
      )}
    </div>
  );
}
