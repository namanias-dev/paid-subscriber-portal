"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { trackClient } from "@/lib/analytics/client";
import type { PublicIssue } from "@/lib/store/issues";
import { categoriesForStage, issueCategoryLabel } from "@/lib/store/issues";
import type { PublicOrder } from "@/lib/store/orders";
import { buildTrackingTimeline, formatPromise, trackingNarrative } from "@/lib/store/trackingView";
import IssueSheet from "./track/IssueSheet";

const MAX_MS = 90_000;
const GAPS_MS = [2000, 2500, 3000, 4000, 5000, 6000, 8000];

const HINTS: Record<string, string> = {
  ADDRESS_ISSUE: "The address on the parcel looks wrong",
  DELIVERY_DELAY: "It should have arrived by now",
  PICKUP_ISSUE: "The courier has not collected it",
  TRACKING_ISSUE: "The tracking page looks incomplete",
  STATUS_MISMATCH: "The status does not match what happened",
  DAMAGE_ISSUE: "A book arrived damaged or incomplete",
  UPDATE_REQUEST: "I need the phone or address updated",
  OTHER: "Something else about this order",
};

function formatStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export default function OrderStatus({ order }: { order: PublicOrder }) {
  const [current, setCurrent] = useState(order);
  const [stillWaiting, setStillWaiting] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [issues, setIssues] = useState<PublicIssue[]>(order.issues || []);
  const [copied, setCopied] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [followState, setFollowState] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("damaged");
  const [reportText, setReportText] = useState("");
  const [reportState, setReportState] = useState<string | null>(null);
  const completedFired = useRef(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    setCurrent(order);
    setIssues(order.issues || []);
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
          if (json.order.issues) setIssues(json.order.issues);
          if (!json.order.confirming) return;
        }
      } catch {
        /* next tick retries */
      }
      if (cancelled) return;
      if (Date.now() - started >= MAX_MS) {
        setStillWaiting(true);
        return;
      }
      const gap = GAPS_MS[Math.min(gapIdx, GAPS_MS.length - 1)];
      gapIdx += 1;
      timer = setTimeout(() => void run(), gap);
    };
    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [current.confirming, current.order_no, current.access_token]);

  const narrative = trackingNarrative({
    stage: current.stage,
    stageLabel: current.stage_label,
    orderStatus: current.order_status,
    pickupDelayed: current.pickup_delayed,
    pickupQueued: current.pickup_queued,
    placedAt: current.placed_at,
    shippedAt: current.shipped_at,
    deliveredAt: current.delivered_at,
    eventAt: current.event_at,
    promisedDeliveryDate: current.promised_delivery_date,
  });
  const timeline = buildTrackingTimeline({
    stage: current.stage,
    orderStatus: current.order_status,
    pickupDelayed: current.pickup_delayed,
    placedAt: current.placed_at,
    shippedAt: current.shipped_at,
    deliveredAt: current.delivered_at,
    eventAt: current.event_at,
  });
  const promise = formatPromise(current.promised_delivery_date);
  const openIssue = issues.find((issue) => issue.open) || null;
  const latestIssue = openIssue || issues[0] || null;
  const categories = useMemo(
    () =>
      categoriesForStage(current.stage).map((id) => ({
        id,
        label: issueCategoryLabel(id),
        hint: HINTS[id] || "",
      })),
    [current.stage],
  );
  const productLine = current.items.map((item) => `${item.name} × ${item.qty}`).join(", ");

  async function onCopy(label: string, value: string) {
    const ok = await copyText(value);
    setCopied(ok ? label : null);
    if (ok) window.setTimeout(() => setCopied(null), 1400);
  }

  async function sendFollowUp(e: React.FormEvent) {
    e.preventDefault();
    if (!latestIssue || !current.access_token) return;
    setFollowState(null);
    const res = await fetch(`/api/notes/order/${encodeURIComponent(current.order_no)}/issues/comment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: current.access_token, reference: latestIssue.reference, comment: followUp }),
    });
    const json = await res.json();
    if (json.ok && json.issue) {
      setIssues((list) => [json.issue, ...list.filter((item) => item.reference !== json.issue.reference)]);
      setFollowUp("");
      setFollowState("Added to your issue.");
    } else {
      setFollowState(json.error || "Could not add that.");
    }
  }

  const fade = reduce ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="mx-auto w-full max-w-lg">
      <motion.section {...fade} className="overflow-hidden rounded-[28px] border border-[var(--ca-navy)]/8 bg-white ns-elev-3">
        <div className="h-1 bg-[var(--ca-gold)]" />
        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-xs font-semibold tracking-wide text-[var(--ca-gold-dark)]">{current.order_no}</p>
            <button
              type="button"
              onClick={() => onCopy("Order number", current.order_no)}
              className="min-h-11 rounded-full px-3 text-xs font-semibold text-[var(--ca-navy)]"
            >
              {copied === "Order number" ? "Copied" : "Copy"}
            </button>
          </div>
          <h1 className="mt-2 font-heading text-[1.85rem] font-bold leading-tight text-[var(--ca-navy)] sm:text-4xl">
            {narrative.headline}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--ca-navy)]/75">{narrative.explanation}</p>
          {promise && <p className="mt-4 text-sm font-semibold text-[var(--ca-navy)]">{promise}</p>}
          {productLine && <p className="mt-2 text-sm text-[var(--ca-navy)]/70">{productLine}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {current.courier && (
              <span className="rounded-full bg-[var(--ca-navy)]/[0.04] px-3 py-2 text-sm text-[var(--ca-navy)]">{current.courier}</span>
            )}
            {current.awb && (
              <button
                type="button"
                onClick={() => onCopy("AWB", current.awb || "")}
                className="min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white"
              >
                {copied === "AWB" ? "AWB copied" : `AWB ${current.awb}`}
              </button>
            )}
          </div>
          {stillWaiting && current.confirming && (
            <p className="mt-4 rounded-2xl bg-[var(--ca-navy)]/[0.04] p-3 text-sm text-[var(--ca-navy)]/75">
              Confirmation is taking a little longer than usual. You can leave this page and track the order with your phone number.
            </p>
          )}
        </div>
      </motion.section>

      <section className="mt-4 rounded-[28px] border border-[var(--ca-navy)]/8 bg-white p-5 ns-elev-1 sm:p-6">
        <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Shipment progress</h2>
        <ol className="mt-5">
          {timeline.map((step, index) => (
            <li key={step.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`mt-1 flex h-3.5 w-3.5 items-center justify-center rounded-full ${
                    step.state === "done"
                      ? "bg-[var(--ca-gold)]"
                      : step.state === "current"
                        ? "bg-[var(--ca-navy)] ring-4 ring-[var(--ca-gold)]/35"
                        : step.state === "exception"
                          ? "bg-[#8a5a12] ring-4 ring-[#8a5a12]/20"
                          : "bg-[var(--ca-navy)]/15"
                  }`}
                  aria-hidden
                />
                {index < timeline.length - 1 && (
                  <span className={`min-h-8 w-px flex-1 ${step.state === "done" ? "bg-[var(--ca-gold)]/70" : "bg-[var(--ca-navy)]/10"}`} />
                )}
              </div>
              <div className="pb-4">
                <p
                  className={`text-[15px] ${
                    step.state === "upcoming" ? "text-[var(--ca-navy)]/40" : "font-semibold text-[var(--ca-navy)]"
                  }`}
                >
                  {step.label}
                  {step.state === "current" && <span className="sr-only">, current step</span>}
                </p>
                {step.at && <p className="text-xs text-[var(--ca-navy)]/50">{step.at}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-4 rounded-[28px] border border-[var(--ca-gold-dark)]/30 bg-[#fffdf8] p-5 ns-elev-1">
        <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">What happens next</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--ca-navy)]/75">{narrative.next}</p>
      </section>

      <section className="mt-4 rounded-[28px] border border-[var(--ca-navy)]/8 bg-white p-5 ns-elev-1">
        <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Order details</h2>
        <ul className="mt-3 divide-y divide-[var(--ca-navy)]/8">
          {current.items.map((item, index) => (
            <li key={index} className="flex items-start justify-between gap-4 py-3 text-sm">
              <span className="text-[var(--ca-navy)]">
                {item.name}
                <span className="text-[var(--ca-navy)]/50"> × {item.qty}</span>
              </span>
              <span className="tabular-nums text-[var(--ca-navy)]">{item.total}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-1 space-y-1 text-sm text-[var(--ca-navy)]/70">
          {current.subtotal_label && (
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{current.subtotal_label}</dd>
            </div>
          )}
          {current.discount_label && (
            <div className="flex justify-between">
              <dt>{current.discount_name ? `Offer · ${current.discount_name}` : "Offer"}</dt>
              <dd className="tabular-nums">− {current.discount_label}</dd>
            </div>
          )}
          {current.shipping_label && (
            <div className="flex justify-between">
              <dt>Shipping</dt>
              <dd className="tabular-nums">{current.shipping_label}</dd>
            </div>
          )}
          <div className="flex justify-between pt-2 text-base font-semibold text-[var(--ca-navy)]">
            <dt>Total</dt>
            <dd className="tabular-nums">{current.total_label}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-4 rounded-[28px] border border-[var(--ca-navy)]/8 bg-white p-5 ns-elev-1">
        <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Shipping</h2>
        {current.ship_to && <p className="mt-3 text-sm leading-relaxed text-[var(--ca-navy)]/80">{current.ship_to}</p>}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onCopy("Order number", current.order_no)}
            className="min-h-12 rounded-2xl border border-[var(--ca-navy)]/10 px-3 text-sm font-semibold text-[var(--ca-navy)]"
          >
            {copied === "Order number" ? "Copied" : "Copy order number"}
          </button>
          {current.awb && (
            <button
              type="button"
              onClick={() => onCopy("AWB", current.awb || "")}
              className="min-h-12 rounded-2xl border border-[var(--ca-navy)]/10 px-3 text-sm font-semibold text-[var(--ca-navy)]"
            >
              {copied === "AWB" ? "Copied" : "Copy AWB"}
            </button>
          )}
        </div>
        {current.courier_track_url && (
          <a
            href={current.courier_track_url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-12 items-center text-sm font-semibold text-[var(--ca-navy)] underline decoration-[var(--ca-gold)] underline-offset-4"
          >
            Track on courier site
          </a>
        )}
      </section>

      {latestIssue ? (
        <section className="mt-4 rounded-[28px] border border-[var(--ca-navy)]/8 bg-white p-5 ns-elev-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">{latestIssue.status_label}</p>
          <h2 className="mt-1 font-heading text-xl font-bold text-[var(--ca-navy)]">{latestIssue.reference}</h2>
          <p className="mt-2 text-sm text-[var(--ca-navy)]/70">
            {latestIssue.category_label} · {formatStamp(latestIssue.created_at)}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[var(--ca-navy)]/80">{latestIssue.customer_note || latestIssue.next_step}</p>
          {latestIssue.open && current.access_token && (
            <form onSubmit={sendFollowUp} className="mt-4">
              <label className="block text-sm font-medium text-[var(--ca-navy)]">
                Add more details
                <textarea
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  minLength={8}
                  rows={3}
                  className="mt-2 w-full rounded-2xl border border-[var(--ca-navy)]/12 px-3 py-3 text-base"
                />
              </label>
              <button type="submit" className="mt-2 min-h-12 rounded-full bg-[var(--ca-navy)] px-5 text-sm font-semibold text-white">
                Send update
              </button>
              {followState && <p className="mt-2 text-sm text-[var(--ca-navy)]/70">{followState}</p>}
            </form>
          )}
        </section>
      ) : (
        current.access_token &&
        current.stage !== "pending" && (
          <section className="mt-4 rounded-[28px] border border-[var(--ca-navy)]/8 bg-white p-5 ns-elev-1">
            <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Need help with this order?</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ca-navy)]/70">
              Address, pickup, delivery, or a status that does not look right. We’ll reply on this page.
            </p>
            <button
              type="button"
              onClick={() => setSheet(true)}
              className="mt-4 min-h-12 w-full rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white"
            >
              Raise an issue
            </button>
          </section>
        )
      )}

      {(current.stage === "delivered" || current.stage === "delivery_issue") && current.access_token && (
        <form
          className="mt-4 rounded-[28px] border border-[var(--ca-navy)]/8 bg-white p-5 ns-elev-1"
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
          <p className="text-sm font-semibold text-[var(--ca-navy)]">Report damaged or incomplete notes</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--ca-navy)]/60">
            This is for a delivered parcel. It does not start a return shipment by itself.
          </p>
          <select
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            className="mt-3 min-h-12 w-full rounded-2xl border border-[var(--ca-navy)]/12 px-3 text-sm"
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
            className="mt-2 w-full rounded-2xl border border-[var(--ca-navy)]/12 px-3 py-3 text-base"
          />
          <button type="submit" className="mt-2 min-h-12 rounded-full bg-[var(--ca-navy)] px-5 text-sm font-semibold text-white">
            Send report
          </button>
          {reportState && <p className="mt-2 text-sm text-[var(--ca-navy)]/70">{reportState}</p>}
        </form>
      )}

      {current.access_token && (
        <IssueSheet
          open={sheet}
          orderNo={current.order_no}
          token={current.access_token}
          categories={categories}
          onClose={() => setSheet(false)}
          onCreated={(issue) => {
            setIssues((list) => [issue, ...list.filter((item) => item.reference !== issue.reference)]);
          }}
        />
      )}
    </div>
  );
}
