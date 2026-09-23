/**
 * Shipping configuration. Names only — values live in the server environment.
 * Billable courier writes stay off unless both gates are set, and no route
 * calls a create-shipment API even then.
 */

const PIN = /^[1-9][0-9]{5}$/;

export function pickupPostcode(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.NOTES_STORE_PICKUP_POSTCODE || env.SHIPROCKET_PICKUP_POSTCODE || env.DELHIVERY_PICKUP_POSTCODE || "").trim();
  return PIN.test(raw) ? raw : null;
}

export function shiprocketBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SHIPROCKET_API_BASE_URL || "https://apiv2.shiprocket.in/v1/external").replace(/\/+$/, "");
}

export function delhiveryBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.DELHIVERY_API_BASE_URL || "https://track.delhivery.com").replace(/\/+$/, "");
}

export function shiprocketCredentials(env: NodeJS.ProcessEnv = process.env): { email: string; password: string } | null {
  const email = (env.SHIPROCKET_EMAIL || "").trim();
  const password = (env.SHIPROCKET_PASSWORD || "").trim();
  if (!email || !password) return null;
  return { email, password };
}

export function delhiveryToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = (env.DELHIVERY_API_TOKEN || "").trim();
  return token || null;
}

export function courierWebhookKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = (env.NOTES_STORE_COURIER_WEBHOOK_KEY || "").trim();
  return key || null;
}

/**
 * Both must be set before any future billable call. Production must not set
 * the confirmation value until the owner authorizes a live label or pickup.
 */
export function shippingWritesAuthorized(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NOTES_STORE_SHIPPING_WRITES === "1" && env.NOTES_STORE_SHIPPING_WRITE_CONFIRM === "I_AUTHORIZE_BILLABLE_SHIPMENT";
}
