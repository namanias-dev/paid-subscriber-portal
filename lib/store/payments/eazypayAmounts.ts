/**
 * ICICI EazyPGVerify amount semantics for the Notes Store.
 *
 * The verify packet is plaintext `key=value` pairs. Live responses use:
 *   BA             merchant / base amount we submitted (rupees)
 *   amount         total charged to the customer (rupees)
 *   PF             processing fee charged by the gateway (rupees)
 *   TAX            tax on that fee, when ICICI fills it (rupees)
 *   PaymentMode    CREDIT_CARD, UPI_ICICI, NET_BANKING, …
 *   status         RIP / SIP / Success / …
 *
 * For a credit card, `amount` is the cardholder total (merchant + fee + tax).
 * For UPI and other fee-free modes, `amount` equals `BA` and `PF`/`TAX` are 0.
 * The order is confirmed only when the merchant amount equals the order total
 * in integer paise. A higher cardholder total is recorded, never accepted as
 * the order amount, and never folded into Notes revenue.
 */

export type EazypayMerchantSource = "BA" | "amount_when_fee_free";

export type EazypayAmountReason =
  | "ok"
  | "missing_merchant_amount"
  | "merchant_exceeds_cardholder"
  | "reference_mismatch"
  | "callback_transaction_mismatch";

export interface EazypayNormalizedAmounts {
  trusted: boolean;
  reason: EazypayAmountReason;
  merchant_amount_paise: number | null;
  cardholder_total_paise: number | null;
  processing_fee_paise: number | null;
  processing_fee_tax_paise: number | null;
  payment_mode: string | null;
  verified_status: string | null;
  merchant_source: EazypayMerchantSource | null;
  /** Signed callback "Transaction Amount", when it agrees with BA. */
  submitted_amount_paise: number | null;
}

export interface SignedCallbackAmounts {
  transactionAmount?: string | null;
  serviceTaxAmount?: string | null;
}

/** Integer paise from an ICICI rupee token. Rejects anything that is not 0–2 decimal places. */
export function gatewayRupeesToPaise(raw: string | null | undefined): number | null {
  const t = String(raw ?? "").trim();
  if (!t || t.toUpperCase() === "NA" || t.toLowerCase() === "null") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const paise = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(paise)) return null;
  return paise;
}

function cleanToken(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  if (!t || t.toUpperCase() === "NA" || t.toLowerCase() === "null") return "";
  return t;
}

function feeCloses(merchant: number, fee: number, tax: number, total: number): boolean {
  return merchant + fee + tax === total;
}

/**
 * Read merchant amount, cardholder total, and gateway fee fields from one
 * EazyPGVerify packet. Does not decide whether the payment is paid.
 */
export function normalizeEazypayVerifyAmounts(input: {
  packet: Record<string, string> | null | undefined;
  expectedReference: string;
  signedCallback?: SignedCallbackAmounts | null;
}): EazypayNormalizedAmounts {
  const packet = input.packet || {};
  const empty: EazypayNormalizedAmounts = {
    trusted: false,
    reason: "missing_merchant_amount",
    merchant_amount_paise: null,
    cardholder_total_paise: null,
    processing_fee_paise: null,
    processing_fee_tax_paise: null,
    payment_mode: cleanToken(packet["paymentmode"]) || null,
    verified_status: cleanToken(packet["status"]) || null,
    merchant_source: null,
    submitted_amount_paise: null,
  };

  const echoedRef = cleanToken(packet["pgreferenceno"]);
  if (echoedRef && echoedRef !== input.expectedReference) {
    return { ...empty, reason: "reference_mismatch" };
  }

  const base = gatewayRupeesToPaise(packet["ba"]);
  const total = gatewayRupeesToPaise(packet["amount"]);
  const fee = gatewayRupeesToPaise(packet["pf"]);
  const tax = gatewayRupeesToPaise(packet["tax"]);

  let merchant: number | null = null;
  let source: EazypayMerchantSource | null = null;
  if (base != null) {
    merchant = base;
    source = "BA";
  } else if (total != null && (fee == null || fee === 0) && (tax == null || tax === 0)) {
    // Fee-free packets that omit BA still name the merchant amount in `amount`.
    // A packet that shows a processing fee without BA is not this case.
    merchant = total;
    source = "amount_when_fee_free";
  }

  if (merchant == null) return { ...empty, cardholder_total_paise: total, processing_fee_paise: fee, processing_fee_tax_paise: tax };

  if (total != null && merchant > total) {
    return {
      ...empty,
      reason: "merchant_exceeds_cardholder",
      cardholder_total_paise: total,
      processing_fee_paise: fee,
      processing_fee_tax_paise: tax,
    };
  }

  const callbackTxn = gatewayRupeesToPaise(input.signedCallback?.transactionAmount);
  if (callbackTxn != null && callbackTxn !== merchant) {
    return {
      ...empty,
      reason: "callback_transaction_mismatch",
      cardholder_total_paise: total,
      processing_fee_paise: fee,
      processing_fee_tax_paise: tax,
    };
  }

  const feePaise = fee;
  const callbackTax = gatewayRupeesToPaise(input.signedCallback?.serviceTaxAmount);
  let taxPaise = tax;
  if (total != null) {
    const feePart = feePaise ?? 0;
    if (tax != null && feeCloses(merchant, feePart, tax, total)) taxPaise = tax;
    else if (callbackTax != null && feeCloses(merchant, feePart, callbackTax, total)) taxPaise = callbackTax;
  }

  return {
    trusted: true,
    reason: "ok",
    merchant_amount_paise: merchant,
    cardholder_total_paise: total,
    processing_fee_paise: feePaise,
    processing_fee_tax_paise: taxPaise,
    payment_mode: empty.payment_mode,
    verified_status: empty.verified_status,
    merchant_source: source,
    submitted_amount_paise: callbackTxn,
  };
}

/** Exact integer-paise equality. A missing or untrusted merchant amount does not pass. */
export function merchantAmountDecision(
  normalized: EazypayNormalizedAmounts | null | undefined,
  expectedOrderPaise: number,
): "accept" | "mismatch" | "untrusted" {
  if (!normalized?.trusted || normalized.merchant_amount_paise == null) return "untrusted";
  if (!Number.isSafeInteger(expectedOrderPaise)) return "untrusted";
  if (normalized.merchant_amount_paise !== expectedOrderPaise) return "mismatch";
  if (normalized.submitted_amount_paise != null && normalized.submitted_amount_paise !== expectedOrderPaise) {
    return "mismatch";
  }
  return "accept";
}

export interface StoredGatewayCharges {
  order_amount_paise: number;
  processing_fee_paise: number | null;
  processing_fee_tax_paise: number | null;
  gateway_fee_paise: number;
  cardholder_total_paise: number;
}

/** Staff-facing fee split. Absent when the customer was not charged a gateway fee. */
export function gatewayChargesForStaff(payload: unknown, orderAmountPaise: number): StoredGatewayCharges | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const merchant = numberOrNull(row.merchant_amount_paise);
  const cardholder = numberOrNull(row.cardholder_total_paise);
  if (merchant == null || cardholder == null || cardholder <= merchant) return null;
  return {
    order_amount_paise: orderAmountPaise,
    processing_fee_paise: numberOrNull(row.processing_fee_paise),
    processing_fee_tax_paise: numberOrNull(row.processing_fee_tax_paise),
    gateway_fee_paise: cardholder - merchant,
    cardholder_total_paise: cardholder,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

export function verifyAmountPayload(input: {
  normalized: EazypayNormalizedAmounts;
  rawStatus: string | null;
  httpStatus: number | null;
  amountMismatch?: boolean;
  expectedPaise?: number;
}): Record<string, unknown> {
  const merchant = input.normalized.merchant_amount_paise;
  const cardholder = input.normalized.cardholder_total_paise;
  return {
    status: input.rawStatus,
    http: input.httpStatus,
    amount_compared: input.normalized.merchant_source,
    merchant_amount_paise: merchant,
    cardholder_total_paise: cardholder,
    processing_fee_paise: input.normalized.processing_fee_paise,
    processing_fee_tax_paise: input.normalized.processing_fee_tax_paise,
    payment_mode: input.normalized.payment_mode,
    gateway_fee_paise: merchant != null && cardholder != null ? cardholder - merchant : null,
    ...(input.amountMismatch
      ? { amount_mismatch: true, expected_paise: input.expectedPaise ?? null }
      : {}),
  };
}

export function formatReconciledPaymentAlert(input: {
  orderNo: string;
  orderAmountPaise: number;
  gatewayFeePaise: number | null;
}): string {
  const orderNo = String(input.orderNo || "").replace(/[<>&]/g, "");
  const lines = [
    "<b>NOTES PAYMENT RECONCILED</b>",
    "",
    "Order:",
    orderNo,
    "",
    "Order amount:",
    formatInr(input.orderAmountPaise),
  ];
  if (input.gatewayFeePaise != null && input.gatewayFeePaise > 0) {
    lines.push("", "Gateway card fee:", formatInr(input.gatewayFeePaise));
  }
  lines.push("", "Payment verified successfully.", "", "Order confirmed.");
  return lines.join("\n");
}

function formatInr(paise: number): string {
  const p = Math.round(paise);
  const whole = p % 100 === 0;
  const rupees = p / 100;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}
