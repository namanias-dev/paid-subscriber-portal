import type { CustomerStage } from "./projection";

export type TrackStepId =
  | "confirmed"
  | "preparing"
  | "packed"
  | "pickup"
  | "shipped"
  | "in_transit"
  | "out_for_delivery"
  | "delivered";

export type StepVisual = "done" | "current" | "upcoming" | "exception";

export interface TrackingTimelineStep {
  id: TrackStepId;
  label: string;
  state: StepVisual;
  at: string | null;
}

export interface TrackingNarrative {
  headline: string;
  explanation: string;
  next: string;
  exception: string | null;
}

const STEP_LABEL: Record<TrackStepId, string> = {
  confirmed: "Order confirmed",
  preparing: "Preparing your notes",
  packed: "Packed",
  pickup: "Pickup scheduled",
  shipped: "Shipped",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
};

const ORDER: TrackStepId[] = [
  "confirmed",
  "preparing",
  "packed",
  "pickup",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
];

export interface TrackingViewInput {
  stage: CustomerStage;
  stageLabel?: string | null;
  orderStatus?: string | null;
  pickupDelayed?: boolean;
  pickupQueued?: boolean;
  placedAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  eventAt?: string | null;
  promisedDeliveryDate?: string | null;
}

function formatWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  const wall = value.includes(" ") && !value.includes("T") ? `${value.replace(" ", "T")}+05:30` : value.includes("T") ? value : `${value}T00:00:00+05:30`;
  const date = new Date(wall);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: value.includes(":") ? "numeric" : undefined,
    minute: value.includes(":") ? "2-digit" : undefined,
  }).format(date);
}

function currentIndex(input: TrackingViewInput): number {
  if (input.orderStatus === "PICKUP_SCHEDULED" || input.pickupDelayed) return ORDER.indexOf("pickup");
  switch (input.stage) {
    case "pending":
    case "failed":
    case "confirmed":
      return 0;
    case "preparing":
      return 1;
    case "packed":
      return 2;
    case "shipped":
      return 4;
    case "in_transit":
      return 5;
    case "out_for_delivery":
    case "delivery_issue":
      return 6;
    case "delivered":
    case "return_open":
    case "refund":
    case "refunded":
      return 7;
    case "returning":
      return 6;
    default:
      return 1;
  }
}

export function buildTrackingTimeline(input: TrackingViewInput): TrackingTimelineStep[] {
  const current = currentIndex(input);
  const cancelled = input.stage === "failed";
  const deliveryException = input.stage === "delivery_issue";
  const returned = input.stage === "returning";
  const pickupException = !!input.pickupDelayed;
  return ORDER.map((id, index) => {
    let state: StepVisual = index < current ? "done" : index === current ? "current" : "upcoming";
    if (cancelled) state = index === 0 ? "exception" : "upcoming";
    if (pickupException && id === "pickup") state = "exception";
    if (deliveryException && id === "out_for_delivery") state = "exception";
    if (returned && id === "out_for_delivery") state = "exception";
    if (input.stage === "delivered" && id === "delivered") state = "done";
    let label = STEP_LABEL[id];
    if (id === "pickup" && pickupException) label = "Pickup delayed";
    if (id === "out_for_delivery" && deliveryException) label = "Delivery delayed";
    if (id === "out_for_delivery" && returned) label = "Returned";
    if (id === "confirmed" && cancelled) label = "Cancelled";
    const at =
      state === "upcoming"
        ? null
        : id === "confirmed"
          ? formatWhen(input.placedAt)
          : id === "shipped"
            ? formatWhen(input.shippedAt)
            : id === "delivered"
              ? formatWhen(input.deliveredAt)
              : id === "pickup" || id === "in_transit" || id === "out_for_delivery"
                ? formatWhen(input.eventAt)
                : null;
    return { id, label, state, at };
  });
}

export function trackingNarrative(input: TrackingViewInput): TrackingNarrative {
  if (input.stage === "pending") {
    return {
      headline: "Confirming your payment",
      explanation: "We've received the payment attempt. This page updates when the bank confirms it.",
      next: "You can leave this page. Track the order anytime with your phone number.",
      exception: null,
    };
  }
  if (input.stage === "failed") {
    return {
      headline: input.stageLabel || "Order not completed",
      explanation: "This order is not moving. If you were charged, the academy will reconcile it before anything ships.",
      next: "Raise an issue if the status does not match what you expected.",
      exception: "Cancelled",
    };
  }
  if (input.pickupDelayed) {
    return {
      headline: "Pickup delayed",
      explanation: "Your notes are packed and waiting with us. Courier collection is being rescheduled.",
      next: "We'll update this page when the next collection is confirmed. You don't need to contact the courier.",
      exception: "Pickup delayed",
    };
  }
  if (input.orderStatus === "PICKUP_SCHEDULED" && input.pickupQueued) {
    return {
      headline: "Pickup scheduled",
      explanation: "Your parcel is packed and still waiting for courier collection. The pickup request remains in the courier queue.",
      next: "Keep an eye on this page. We'll show it as shipped only after the courier actually collects the parcel.",
      exception: null,
    };
  }
  if (input.orderStatus === "PICKUP_SCHEDULED") {
    return {
      headline: "Pickup scheduled",
      explanation: "Your parcel is packed and awaiting courier collection.",
      next: "Our courier partner will collect the parcel next. You don't need to do anything.",
      exception: null,
    };
  }
  switch (input.stage) {
    case "confirmed":
      return {
        headline: "Order confirmed",
        explanation: "Your payment is confirmed. The academy has your order.",
        next: "We'll prepare your notes in Chandigarh and update this page when they are packed.",
        exception: null,
      };
    case "preparing":
      return {
        headline: "Preparing your notes",
        explanation: "Your notes are being prepared for dispatch.",
        next: "Next they are packed, then handed to the courier.",
        exception: null,
      };
    case "packed":
      return {
        headline: "Packed",
        explanation: "Your notes are packed in Chandigarh.",
        next: "Courier collection is the next step.",
        exception: null,
      };
    case "shipped":
      return {
        headline: "Shipped",
        explanation: "Your order has been handed to the courier and is on the way.",
        next: "The parcel is moving into the courier network.",
        exception: null,
      };
    case "in_transit":
      return {
        headline: "In transit",
        explanation: "Your parcel is moving through the courier network.",
        next: "The next update is usually out for delivery.",
        exception: null,
      };
    case "out_for_delivery":
      return {
        headline: "Out for delivery",
        explanation: "Your notes are on the way today.",
        next: "Keep your phone available. The courier may call before arriving.",
        exception: null,
      };
    case "delivered":
      return {
        headline: "Delivered",
        explanation: "Your notes have been delivered.",
        next: "If a book arrived damaged or incomplete, raise an issue and we'll review it.",
        exception: null,
      };
    case "delivery_issue":
      return {
        headline: "Delivery delayed",
        explanation: "The courier could not complete this delivery yet.",
        next: "Naman IAS will follow up. You don't need to contact the courier yourself.",
        exception: "Delivery delayed",
      };
    case "returning":
      return {
        headline: "Returned",
        explanation: "This parcel is on the way back to Naman IAS.",
        next: "We'll contact you about the next step.",
        exception: "Returned",
      };
    case "return_open":
      return {
        headline: "We're reviewing your report",
        explanation: "Your report is with the academy. No return shipment has been booked from this page.",
        next: "We'll update this page when the review moves.",
        exception: null,
      };
    case "refund":
      return {
        headline: "Refund pending",
        explanation: "A refund is pending with the payment gateway.",
        next: "The academy does not send a second payment from this page.",
        exception: null,
      };
    case "refunded":
      return {
        headline: "Refund recorded",
        explanation: "The refund has been recorded. The payment gateway processes the money separately.",
        next: "Allow the usual bank time for the amount to show.",
        exception: null,
      };
    default:
      return {
        headline: input.stageLabel || "Order update",
        explanation: "We'll keep this page current as the order moves.",
        next: "Check back here for the next step.",
        exception: null,
      };
  }
}

export function formatPromise(date: string | null | undefined): string | null {
  if (!date) return null;
  const formatted = formatWhen(date);
  return formatted ? `Expected by ${formatted}` : null;
}

/** Public courier pages only. Stored admin or fixture URLs stay hidden. */
export function safeCourierTrackUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/^www\./, "");
  const allowed = ["xpressbees.com", "shiprocket.in", "shiprocket.co", "delhivery.com", "bluedart.com", "dtdc.in"];
  if (!allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
  return parsed.toString();
}
