"use client";

import { clientRazorpayLink } from "@/lib/publicLinks";
import { formatINR } from "@/lib/dates";
import { useToast } from "@/components/ui/Toast";
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
  const { toast } = useToast();
  const link = clientRazorpayLink(plan.id);

  function handlePay() {
    if (link) {
      window.open(link, "_blank", "noopener,noreferrer");
    } else {
      toast("Demo mode — connect Razorpay to enable payments", "info");
    }
  }

  return (
    <div
      className="card card-hover relative flex flex-col p-5"
      style={
        plan.highlight
          ? { borderColor: "rgba(201,168,76,0.6)", boxShadow: "0 0 0 1px rgba(201,168,76,0.3)" }
          : undefined
      }
    >
      {plan.badge && (
        <span
          className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-bold"
          style={{
            background:
              plan.id === "lifetime"
                ? "linear-gradient(135deg,#c9a84c,#f0d080)"
                : plan.highlight
                ? "linear-gradient(135deg,#c9a84c,#e8c96a)"
                : "rgba(201,168,76,0.18)",
            color: plan.highlight || plan.id === "lifetime" ? "#0a1628" : "var(--gold-light)",
          }}
        >
          {plan.badge}
        </span>
      )}

      <div className="mb-1 mt-1 flex items-baseline justify-between">
        <h3 className="font-heading text-xl text-text">{plan.name}</h3>
        {current && <span className="pill pill-active">Current</span>}
      </div>
      <p className="text-xs text-muted">{plan.durationLabel}</p>

      <div className="my-4">
        <span className="font-heading text-3xl text-gold-light">{formatINR(plan.price)}</span>
      </div>

      {!compact && (
        <ul className="mb-5 space-y-2 text-sm text-muted">
          {plan.bullets.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <span className="text-gold">✓</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      <button onClick={handlePay} className="btn-gold mt-auto w-full">
        Pay {formatINR(plan.price)} & Get Access →
      </button>
    </div>
  );
}
