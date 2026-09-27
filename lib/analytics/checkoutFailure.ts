/**
 * Stable, PII-free reason for a checkout request that never opened ICICI.
 * The raw server message stays on screen for the shopper and is not stored.
 */
export function checkoutFailureReason(message: string): string {
  const text = message.toLowerCase();
  if (
    text.includes("failed to fetch")
    || text.includes("networkerror")
    || text.includes("network error")
    || text.includes("load failed")
    || text.includes("aborted")
    || text.includes("timeout")
  ) return "network";
  if (text.includes("confirm the delivery")) return "address_unconfirmed";
  if (text.includes("cart is empty")) return "empty_cart";
  if (text.includes("too many attempts")) return "rate_limited";
  if (text.includes("sold out") || text.includes("no longer available") || text.includes("not available")) return "unavailable";
  if (text.includes("pin")) return "pin";
  if (text.includes("mobile") || text.includes("phone")) return "phone";
  if (text.includes("gateway") || text.includes("could not be started")) return "gateway";
  if (text.includes("offer") || text.includes("discount") || text.includes("coupon")) return "discount";
  if (text.includes("unexpected token") || text.includes("not valid json") || text.includes("unreadable") || text.includes("json")) return "bad_response";
  return "checkout_rejected";
}
