import type { PlanId } from "./types";

/**
 * Client-safe Razorpay links. These NEXT_PUBLIC_* vars are referenced
 * statically so Next.js can inline them into the client bundle.
 * Empty string => not configured => demo payment toast.
 */
export const RAZORPAY_LINKS: Record<PlanId, string> = {
  "1m": process.env.NEXT_PUBLIC_RAZORPAY_LINK_1M || "",
  "3m": process.env.NEXT_PUBLIC_RAZORPAY_LINK_3M || "",
  "6m": process.env.NEXT_PUBLIC_RAZORPAY_LINK_6M || "",
  "12m": process.env.NEXT_PUBLIC_RAZORPAY_LINK_12M || "",
  lifetime: process.env.NEXT_PUBLIC_RAZORPAY_LINK_LIFETIME || "",
};

export function clientRazorpayLink(plan: PlanId): string | null {
  const link = RAZORPAY_LINKS[plan];
  return link && link.trim() !== "" ? link : null;
}
