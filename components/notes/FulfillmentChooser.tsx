"use client";

import { Building2, Truck } from "lucide-react";
import type { FulfillmentMethod } from "@/lib/store/fulfillment";

/**
 * "How would you like your notes?" A real radio group (fieldset/legend), so keyboard,
 * screen readers and form semantics come for free. Cards stack on narrow phones and sit
 * side by side from `sm`. Each option is a 44px+ target.
 */
export default function FulfillmentChooser({
  value,
  onChange,
  disabled = false,
  name = "fulfillment_method",
  legend = "How would you like your notes?",
  deliveryHint = "Shipping calculated at checkout",
  className = "",
}: {
  value: FulfillmentMethod;
  onChange: (method: FulfillmentMethod) => void;
  disabled?: boolean;
  name?: string;
  legend?: string;
  deliveryHint?: string;
  className?: string;
}) {
  const options: Array<{ method: FulfillmentMethod; title: string; hint: string; Icon: typeof Truck }> = [
    { method: "DELIVERY", title: "Delivery", hint: deliveryHint, Icon: Truck },
    { method: "ACADEMY_PICKUP", title: "Pick up from academy", hint: "Sector 17C, Chandigarh · Free", Icon: Building2 },
  ];
  return (
    <fieldset className={`min-w-0 ${className}`} disabled={disabled}>
      <legend className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">{legend}</legend>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {options.map(({ method, title, hint, Icon }) => {
          const checked = value === method;
          return (
            <label
              key={method}
              className={`relative flex min-h-[64px] cursor-pointer items-center gap-3 rounded-2xl border p-3.5 transition-colors duration-150 motion-reduce:transition-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--ca-gold)] has-[:focus-visible]:ring-offset-2 ${
                checked
                  ? "border-[var(--ca-navy)] bg-[var(--ca-navy)]/[0.03]"
                  : "border-[var(--ca-navy)]/15 bg-white hover:border-[var(--ca-navy)]/30"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name={name}
                value={method}
                checked={checked}
                onChange={() => onChange(method)}
                className="peer sr-only"
                data-fulfillment-option={method}
              />
              <span
                aria-hidden
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${checked ? "bg-[var(--ca-navy)] text-white" : "bg-[var(--ca-navy)]/[0.05] text-[var(--ca-navy)]"}`}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold leading-snug text-[var(--ca-navy)]">{title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-[var(--ca-navy)]/60">{hint}</span>
              </span>
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${checked ? "border-[var(--ca-navy)]" : "border-[var(--ca-navy)]/25"}`}
              >
                {checked && <span className="h-2.5 w-2.5 rounded-full bg-[var(--ca-navy)]" />}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
