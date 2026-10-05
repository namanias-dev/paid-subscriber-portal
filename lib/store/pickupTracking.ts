/**
 * Customer-facing Academy Pickup lifecycle: Order confirmed → Preparing → Printing →
 * Ready for collection → Collected. No courier, AWB, delivery date or address copy.
 * Pure and client-safe.
 */
import type { CustomerStage } from "./projection";
import type { StepVisual } from "./trackingView";

export type PickupStepId = "confirmed" | "preparing" | "printing" | "ready" | "collected";

export interface PickupTimelineStep {
  id: PickupStepId;
  label: string;
  state: StepVisual;
  at: string | null;
}

const ORDER: PickupStepId[] = ["confirmed", "preparing", "printing", "ready", "collected"];

const LABEL: Record<PickupStepId, string> = {
  confirmed: "Order confirmed",
  preparing: "Preparing",
  printing: "Printing",
  ready: "Ready for collection",
  collected: "Collected",
};

export interface PickupViewInput {
  stage: CustomerStage;
  placedAt?: string | null;
  readyAt?: string | null;
  collectedAt?: string | null;
}

/** Customer date/time in IST, e.g. "6 Oct, 11:40 am". */
export function formatCustomerWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Built by hand: Intl output differs between Node and Safari ICU, which breaks hydration.
  const ist = new Date(date.getTime() + 330 * 60_000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hours = ist.getUTCHours();
  const minutes = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${ist.getUTCDate()} ${months[ist.getUTCMonth()]}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? "am" : "pm"}`;
}

function currentIndex(stage: CustomerStage): number {
  switch (stage) {
    case "preparing":
      return 1;
    case "printing":
      return 2;
    case "ready_for_collection":
      return 3;
    case "collected":
    case "return_open":
    case "refund":
    case "refunded":
      return 4;
    default:
      return 0;
  }
}

export function buildPickupTimeline(input: PickupViewInput): PickupTimelineStep[] {
  const current = currentIndex(input.stage);
  const cancelled = input.stage === "failed";
  return ORDER.map((id, index) => {
    let state: StepVisual = index < current ? "done" : index === current ? "current" : "upcoming";
    if (cancelled) state = index === 0 ? "exception" : "upcoming";
    if (input.stage === "collected" && id === "collected") state = "done";
    const label = id === "confirmed" && cancelled ? "Cancelled" : LABEL[id];
    const at = state === "upcoming"
      ? null
      : id === "confirmed"
        ? formatCustomerWhen(input.placedAt)
        : id === "ready"
          ? formatCustomerWhen(input.readyAt)
          : id === "collected"
            ? formatCustomerWhen(input.collectedAt)
            : null;
    return { id, label, state, at };
  });
}

export interface PickupNarrative {
  headline: string;
  explanation: string;
  next: string;
}

export const PICKUP_READY_PROMISE =
  "Your notes will be ready after they are prepared, printed and packed. We’ll let you know when they’re ready to collect.";

export function pickupNarrative(input: PickupViewInput & { academyName?: string | null }): PickupNarrative {
  const academy = input.academyName || "Naman Sharma IAS Academy";
  switch (input.stage) {
    case "pending":
      return {
        headline: "Confirming your payment",
        explanation: "We've received the payment attempt. This page updates when the bank confirms it.",
        next: "You can leave this page. Track the order anytime with your phone number.",
      };
    case "failed":
      return {
        headline: "Order not completed",
        explanation: "This order is not moving. If you were charged, the academy will reconcile it.",
        next: "Raise an issue if the status does not match what you expected.",
      };
    case "preparing":
      return {
        headline: "Preparing your notes",
        explanation: "Your notes are being prepared for printing at the academy.",
        next: "We’ll let you know when they’re ready to collect.",
      };
    case "printing":
      return {
        headline: "Printing your notes",
        explanation: "Your notes are being printed.",
        next: "They will be packed and kept ready for you at the academy. We’ll let you know when they’re ready to collect.",
      };
    case "ready_for_collection":
      return {
        headline: "Ready for collection",
        explanation: `Your notes are ready at the academy.`,
        next: "Collect them from the academy. Call the academy before you visit if you want to check timings.",
      };
    case "collected":
      return {
        headline: "Collected",
        explanation: `Your order was collected from ${academy}.`,
        next: "Thank you. Your invoice stays available on this page.",
      };
    case "refund":
    case "refunded":
      return {
        headline: input.stage === "refund" ? "Refund pending" : "Refund recorded",
        explanation: "The academy is handling a refund for this order.",
        next: "We'll update this page when there is progress.",
      };
    default:
      return {
        headline: "Order confirmed",
        explanation: "Your payment is confirmed. The academy has your order for Academy Pickup.",
        next: PICKUP_READY_PROMISE,
      };
  }
}
