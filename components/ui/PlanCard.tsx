"use client";

import { useState } from "react";
import { formatINR } from "@/lib/dates";
import PayModal from "@/components/public/PayModal";
import type { PlanInfo } from "@/lib/types";

export default function PlanCard({
  plan,
  current,
  compact,
}: {
  plan: PlanInfo;
  current?: boolean;
  compact?: boolean;
}) {
  const [payOpen, setPayOpen] = useState(false);

  function handlePay() {
    setPayOpen(true);
  }

  return (
    <div
      className={`card card-hover relative flex flex-col p-5 ${plan.highlight ? "ring-2 ring-primary" : ""}`}
    >
      {plan.badge && (
        <span className="pill pill-blue absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
          {plan.badge}
        </span>
      )}
      <div className="mb-1 mt-1 flex items-baseline justify-between">
        <h3 className="text-xl">{plan.name}</h3>
        {current && <span className="pill pill-green">Current</span>}
      </div>
      <p className="text-xs text-muted">{plan.durationLabel}</p>
      <div className="my-4">
        <span className="font-heading text-3xl text-primary">{formatINR(plan.price)}</span>
      </div>
      {!compact && (
        <ul className="mb-5 space-y-2 text-sm text-ink2">
          {plan.bullets.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <span className="text-primary">✓</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      <button onClick={handlePay} className="btn btn-primary mt-auto w-full">
        Get {plan.name} →
      </button>
      <PayModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title={`${plan.name} Subscription`}
        amount={plan.price}
        payload={{ itemType: "plan", planId: plan.id }}
      />
    </div>
  );
}
