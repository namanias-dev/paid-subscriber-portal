/**
 * Real SenderPort — the ONLY bridge from the engine to the SINGLE chokepoint
 * (lib/sms/service.sendSms). It is invoked ONLY by the adapter's LIVE branch, which
 * only runs when every gate passes. It does not re-implement any compliance: the
 * chokepoint enforces kill switch, DLT gate, opt-out/DND, quiet hours, freq caps,
 * and insert-first UNIQUE dedupe (via the dedupeKey we pass = idempotencyKey).
 */
import { sendSms } from "@/lib/sms/service";
import type { SenderPort } from "./ports";
import type { SendRequest, SendOutcome } from "./types";

export const realSender: SenderPort = {
  async send(req: SendRequest): Promise<SendOutcome> {
    const res = await sendSms({
      mobile: req.mobile,
      templateId: req.templateId,
      variables: req.variables,
      relatedEntity: req.relatedEntity,
      sentBy: { userId: null, type: "SYSTEM" },
      triggerEvent: req.triggerEvent,
      audienceType: req.audienceType,
      dedupeKey: req.dedupeKey,   // deterministic idempotencyKey → chokepoint UNIQUE dedupe
      enforceWindow: true,        // respect the chokepoint's IST send window for autosends
    });
    return { ok: res.ok, skipped: res.skipped, error: res.error, logId: res.logId };
  },
};
