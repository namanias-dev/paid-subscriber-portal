/**
 * Address correction decisions with injected courier calls.
 * A failed or ambiguous cancellation never creates the next shipment.
 */
import type { AddressChangeDecision } from "./deliveryAddress";

export type CancelOutcome = "cancelled" | "ambiguous" | "still_active";

export interface CorrectionResult {
  ok: boolean;
  code: string;
  message: string;
  updated: boolean;
  rebooked: boolean;
}

export async function executeAddressCorrection(input: {
  decision: AddressChangeDecision;
  confirmRebook: boolean;
  recordRequest: boolean;
}, deps: {
  updateAddress: () => Promise<void>;
  cancelActive: () => Promise<CancelOutcome>;
  refulfill: () => Promise<{ ok: boolean; awb: string | null }>;
  recordRequest: () => Promise<void>;
}): Promise<CorrectionResult> {
  if (input.decision.action === "immutable" || input.decision.action === "rejected" || input.decision.action === "busy" || input.decision.action === "locked") {
    return { ok: false, code: input.decision.code, message: input.decision.message, updated: false, rebooked: false };
  }
  if (input.decision.action === "request_only") {
    if (input.recordRequest) await deps.recordRequest();
    return { ok: false, code: input.decision.code, message: input.decision.message, updated: false, rebooked: false };
  }
  if (input.decision.action === "rebook") {
    if (!input.confirmRebook) {
      return { ok: false, code: "CONFIRM_REBOOK", message: input.decision.message, updated: false, rebooked: false };
    }
    const cancelled = await deps.cancelActive();
    if (cancelled !== "cancelled") {
      return {
        ok: false,
        code: "ACTION_REQUIRED",
        message: "Could not safely confirm cancellation of the existing shipment.",
        updated: false,
        rebooked: false,
      };
    }
    await deps.updateAddress();
    const next = await deps.refulfill();
    return {
      ok: next.ok,
      code: next.ok ? "REBOOKED" : "ADDRESS_SAVED_REBOOK_PENDING",
      message: next.ok ? "Address updated and a new shipment was created." : "Address updated. The new shipment was not created.",
      updated: true,
      rebooked: next.ok,
    };
  }
  await deps.updateAddress();
  return { ok: true, code: "UPDATED", message: input.decision.message, updated: true, rebooked: false };
}
