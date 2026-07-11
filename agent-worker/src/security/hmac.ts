/**
 * HMAC request signing (worker side). MUST match the portal's verification in
 * `lib/ai-agent/security/hmac.ts`:
 *
 *   canonical = `${timestamp}\n${nonce}\n${rawBody}`
 *   signature = hex( HMAC-SHA256(secret, canonical) )
 *
 * with headers:
 *   x-ai-agent-timestamp, x-ai-agent-nonce, x-ai-agent-signature
 */
import { createHmac, randomBytes } from "node:crypto";

export const HMAC_HEADERS = {
  timestamp: "x-ai-agent-timestamp",
  nonce: "x-ai-agent-nonce",
  signature: "x-ai-agent-signature",
} as const;

export interface SignedHeaders {
  [key: string]: string;
}

/** Build the signed headers for a request body. */
export function buildSignedHeaders(secret: string, rawBody: string): SignedHeaders {
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}\n${nonce}\n${rawBody}`)
    .digest("hex");
  return {
    "Content-Type": "application/json",
    [HMAC_HEADERS.timestamp]: timestamp,
    [HMAC_HEADERS.nonce]: nonce,
    [HMAC_HEADERS.signature]: signature,
  };
}
