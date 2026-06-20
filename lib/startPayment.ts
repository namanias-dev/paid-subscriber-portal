/**
 * Client-side helper to kick off an ICICI Eazypay payment.
 * No crypto here — it only calls the backend create-payment endpoint and
 * routes the user to the returned paymentUrl.
 *
 * Always navigates the CURRENT tab (full-page redirect). Hosted payment
 * gateways must redirect back to our return URL, which then lands on the status
 * page in the same tab — a new tab would strand the user on a blank status tab.
 */
export interface StartPaymentInput {
  itemType: "course" | "plan" | "webinar";
  name: string;
  email: string;
  mobile: string;
  courseSlug?: string;
  planId?: string;
  webinarSlug?: string;
  couponCode?: string;
}

export interface StartPaymentResult {
  ok: boolean;
  error?: string;
  referenceNo?: string;
  paymentUrl?: string;
  demo?: boolean;
  free?: boolean;
}

export async function startPayment(input: StartPaymentInput): Promise<StartPaymentResult> {
  try {
    const res = await fetch("/api/v1/bank/create-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as StartPaymentResult;
    if (!json.ok || !json.paymentUrl) {
      return { ok: false, error: json.error || "Could not start payment." };
    }

    // Full-page redirect (same tab) for both the real gateway and demo/relative
    // URLs, so ICICI's return redirect lands back on our status page cleanly.
    window.location.href = json.paymentUrl;
    return json;
  } catch {
    return { ok: false, error: "Network error. Please try again." };
  }
}
