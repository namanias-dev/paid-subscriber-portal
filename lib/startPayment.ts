/**
 * Client-side helper to kick off an ICICI Eazypay payment.
 * No crypto here — it only calls the backend create-payment endpoint and
 * routes the user to the returned paymentUrl.
 *
 *  - Absolute URL (real Eazypay gateway) => open in a new tab.
 *  - Relative URL (demo / free / status)  => navigate the current tab.
 */
export interface StartPaymentInput {
  itemType: "course" | "plan" | "webinar";
  name: string;
  email: string;
  mobile: string;
  courseSlug?: string;
  planId?: string;
  webinarSlug?: string;
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

    if (/^https?:\/\//i.test(json.paymentUrl)) {
      window.open(json.paymentUrl, "_blank", "noopener,noreferrer");
      // Also move this tab to the status page so the user can track it.
      if (json.referenceNo) {
        window.location.href = `/payment/status?ref=${encodeURIComponent(json.referenceNo)}`;
      }
    } else {
      window.location.href = json.paymentUrl;
    }
    return json;
  } catch {
    return { ok: false, error: "Network error. Please try again." };
  }
}
