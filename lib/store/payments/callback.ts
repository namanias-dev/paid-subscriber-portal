/**
 * Store Eazypay callback handling — ADVISORY ONLY.
 *
 * This function can move a payment from INITIATED to UNCONFIRMED, store what
 * ICICI said, and bring the next Verify forward. It can never write CAPTURED,
 * FAILED or EXPIRED. Terminal truth comes only from EazyPGVerify (./verify.ts),
 * because a browser redirect can be replayed, dropped, forged or arrive out of
 * order, and because the customer's network is not a source of truth about money.
 *
 * Idempotency has two independent layers:
 *  1. A unique index on store_payment_events.event_id, so the same callback
 *     recorded twice is a conflict rather than a second effect.
 *  2. The advisory update is conditional on the row still being open, so a
 *     duplicate arriving after Verify has captured the payment changes nothing.
 */
import { storeDb } from "@/lib/store/db";
import { alertStoreMisroute } from "@/lib/store/alerts";
import { isStoreReference } from "@/lib/store/references";
import { verifyStoreCallbackSignature, storeSubMerchantId } from "./eazypay";
import { STORE_OPEN_STATUSES } from "./status";
import type { EazypayResponseFields } from "@/lib/eazypay";

/** The signed field set, in ICICI's order. The store's own copy. */
const FIELD_KEYS: (keyof EazypayResponseFields)[] = [
  "ID",
  "Response Code",
  "Unique Ref Number",
  "Service Tax Amount",
  "Processing Fee Amount",
  "Total Amount",
  "Transaction Amount",
  "Transaction Date",
  "Interchange Value",
  "TDR",
  "Payment Mode",
  "SubMerchantId",
  "ReferenceNo",
  "TPS",
];

function redirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}

export async function handleStoreCallback(
  req: Request,
  params: Map<string, string>,
  referenceNo: string,
): Promise<Response> {
  const origin = new URL(req.url).origin;
  const get = (k: string) => params.get(k) ?? "";

  // Defence in depth: the dispatcher already checked, and so do we. The store
  // never trusts the routing layer about whose money this is.
  if (!isStoreReference(referenceNo)) {
    void alertStoreMisroute({
      where: "store callback handler",
      referenceNo,
      note: "A non-store reference reached store callback processing. Routing is wrong.",
    });
    return redirect(`${origin}/notes`);
  }

  const fields: Partial<EazypayResponseFields> = {};
  for (const k of FIELD_KEYS) fields[k] = get(k);
  const signatureValid = verifyStoreCallbackSignature(fields, get("RS") || null);

  const responseCode = get("Response Code");
  const gatewayRef = get("Unique Ref Number").trim();
  const raw: Record<string, string> = {};
  params.forEach((v, k) => {
    raw[k] = v;
  });

  const db = storeDb();
  if (!db) {
    // Nothing can be recorded, so promise nothing: send the customer to tracking.
    return redirect(`${origin}/notes/track?ref=${encodeURIComponent(referenceNo)}`);
  }

  // 1. Record the raw event before interpreting it. event_id makes a replayed
  //    callback a unique-index conflict rather than a repeated effect.
  const eventId = `cb:${referenceNo}:${gatewayRef || "none"}:${responseCode || "none"}`;
  const { error: eventError } = await db.from("store_payment_events").insert({
    event_id: eventId,
    event_type: "gateway_callback",
    reference_no: referenceNo,
    signature_ok: signatureValid,
    raw_json: raw,
  });
  const duplicate = !!eventError && String(eventError.code) === "23505";
  if (eventError && !duplicate) {
    console.error(`[store/callback] event insert failed ref=${referenceNo}:`, eventError.message);
  }

  // 2. Find our payment row. This is also the misroute detector: a store-shaped
  //    reference we never issued means either a forged callback or a bug, and
  //    either way ops needs to know rather than find out in a fortnight.
  const { data: payment } = await db
    .from("store_order_payments")
    .select("id,order_id,status,sub_merchant_id,amount_paise")
    .eq("reference_no", referenceNo)
    .maybeSingle();

  if (!payment) {
    await db
      .from("store_payment_events")
      .update({ misrouted: true, processing_result: "unknown_reference", processed_at: new Date().toISOString() })
      .eq("event_id", eventId);
    void alertStoreMisroute({
      where: "store callback handler",
      referenceNo,
      note: "Store-shaped reference with no matching store_order_payments row.",
    });
    return redirect(`${origin}/notes/track?ref=${encodeURIComponent(referenceNo)}`);
  }

  // Free extra signal: the SubMerchantId travels inside the signed payload, so a
  // mismatch means the response is not the one we initiated. Recorded, not
  // enforced — the reference namespace is the isolation guarantee, and ICICI may
  // legitimately echo the registered submerchant rather than ours.
  const echoedSub = get("SubMerchantId").trim();
  if (echoedSub && echoedSub !== storeSubMerchantId()) {
    console.warn(
      `[store/callback] submerchant echo mismatch ref=${referenceNo} sent=${storeSubMerchantId()} echoed=${echoedSub}`,
    );
  }

  // 3. Advisory update. UPDATE-only, conditional on the row still being open, so
  //    a duplicate or late callback cannot disturb a captured payment.
  if (!duplicate) {
    const nowIso = new Date().toISOString();
    await db
      .from("store_order_payments")
      .update({
        status: "UNCONFIRMED",
        callback_payload: raw,
        response_code: responseCode || null,
        verified_signature: signatureValid,
        gateway_ref: gatewayRef || null,
        method: get("Payment Mode") || null,
        gateway_amount: get("Total Amount") || get("Transaction Amount") || null,
        transaction_date: get("Transaction Date") || null,
        sub_merchant_id: echoedSub || payment.sub_merchant_id,
        // Bring Verify forward: the customer is watching the order page now.
        next_verify_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", payment.id)
      .in("status", STORE_OPEN_STATUSES);

    await db.from("store_order_events").insert({
      order_id: payment.order_id,
      event: "payment_callback_received",
      actor_type: "gateway",
      payload_json: { reference_no: referenceNo, response_code: responseCode, signature_ok: signatureValid },
    });
  }

  await db
    .from("store_payment_events")
    .update({
      processing_result: duplicate ? "duplicate_ignored" : "advisory_applied",
      processed_at: new Date().toISOString(),
    })
    .eq("event_id", eventId);

  console.info(
    `[store/callback] ref=${referenceNo} code=${responseCode} signature=${signatureValid} duplicate=${duplicate} (terminal deferred to Verify)`,
  );

  // 4. Send the customer to their order. The page says "Payment received —
  //    confirming your order" and resolves to confirmed once Verify answers.
  const { data: order } = await db
    .from("store_orders")
    .select("order_no")
    .eq("id", payment.order_id)
    .maybeSingle();

  return redirect(
    order?.order_no
      ? `${origin}/notes/order/${encodeURIComponent(order.order_no)}`
      : `${origin}/notes/track?ref=${encodeURIComponent(referenceNo)}`,
  );
}
