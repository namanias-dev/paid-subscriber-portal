/**
 * One staff-chosen courier. Mark packed never reaches this module.
 * A failed check cancels that shipment and does not try another courier.
 */

export const MARK_PACKED_BOOKS_COURIER = false;

export interface ManualCreated {
  awb: string | null;
  addressMismatch?: boolean;
  addressUnverified?: boolean;
  phoneStored?: boolean | null;
}

export function rejectionReason(created: ManualCreated): string | null {
  if (!created.awb) return "No AWB was returned.";
  if (created.addressUnverified) return "Provider did not return a destination we could check.";
  if (created.phoneStored === false) return "Provider shipment did not return a valid phone number.";
  if (created.addressMismatch) return "Provider destination did not match the order.";
  return null;
}

/** Pickup success is the only path to PICKUP_SCHEDULED. A saved AWB without pickup stays READY_FOR_PICKUP. */
export function orderStatusAfterBooking(from: string, pickupOk: boolean): "PICKUP_SCHEDULED" | "READY_FOR_PICKUP" | null {
  if (from !== "PACKED" && from !== "READY_FOR_PICKUP") return null;
  if (pickupOk) return "PICKUP_SCHEDULED";
  return from === "PACKED" ? "READY_FOR_PICKUP" : null;
}

export type ManualBookCode =
  | "CONFIRM"
  | "ACTIVE"
  | "CREATE_FAILED"
  | "CANCELLED"
  | "CANCEL_UNCONFIRMED"
  | "PICKUP_SCHEDULED"
  | "READY_FOR_PICKUP";

export async function bookOneCourier<T extends ManualCreated>(input: {
  confirm: boolean;
  alreadyActive: boolean;
  create: () => Promise<T>;
  cancel: (created: T) => Promise<boolean>;
  pickup: (created: T) => Promise<void>;
}): Promise<
  | { ok: false; code: "CONFIRM" | "ACTIVE" | "CREATE_FAILED"; reason: string; creates: number; created: null }
  | { ok: false; code: "CANCELLED" | "CANCEL_UNCONFIRMED"; reason: string; creates: number; created: T }
  | { ok: true; code: "PICKUP_SCHEDULED" | "READY_FOR_PICKUP"; created: T; creates: number; pickupError: string | null }
> {
  if (!input.confirm) {
    return { ok: false, code: "CONFIRM", reason: "Confirm the courier before booking.", creates: 0, created: null };
  }
  if (input.alreadyActive) {
    return { ok: false, code: "ACTIVE", reason: "This order already has an active shipment.", creates: 0, created: null };
  }
  let created: T;
  try {
    created = await input.create();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Shipment was not created.";
    return { ok: false, code: "CREATE_FAILED", reason, creates: 0, created: null };
  }
  const reason = rejectionReason(created);
  if (reason) {
    const cancelled = await input.cancel(created);
    if (!cancelled) {
      return { ok: false, code: "CANCEL_UNCONFIRMED", reason: `${reason} Cancellation could not be confirmed. Do not book another courier until this shipment is voided.`, creates: 1, created };
    }
    return { ok: false, code: "CANCELLED", reason, creates: 1, created };
  }
  try {
    await input.pickup(created);
    return { ok: true, code: "PICKUP_SCHEDULED", created, creates: 1, pickupError: null };
  } catch (error) {
    const pickupError = error instanceof Error ? error.message : "Pickup was not scheduled.";
    return { ok: true, code: "READY_FOR_PICKUP", created, creates: 1, pickupError };
  }
}
