import crypto from "crypto";

/**
 * ICICI Eazypay integration — BACKEND ONLY.
 *
 * Never import this into a client component: it reads the AES key from the
 * environment. The key must live only in env/config (e.g. .env.local) and is
 * never exposed to the browser bundle, logged, or committed.
 *
 * Encryption: AES/ECB/PKCS5Padding, Base64 output (per ICICI Eazypay spec).
 * Cipher size auto-selected from the key length (16 => AES-128, 24 => 192, 32 => 256).
 * Response verification: SHA-512 over pipe-joined response fields + AES key.
 *
 * Mirrors lib/razorpay.ts conventions: lazy env reads, never throws on missing
 * config — returns null/false so the app keeps building/running in DEMO MODE.
 */

export const EAZYPAY_BASE_URL = "https://eazypay.icicibank.com/EazyPG";
export const PAYMENT_GATEWAY = "ICICI_EAZYPAY" as const;

export function getMerchantId(): string {
  return process.env.ICICI_EAZYPAY_MERCHANT_ID || "343526";
}

export function getReturnUrl(): string {
  return (
    process.env.ICICI_EAZYPAY_RETURN_URL ||
    "https://namanias.com/api/v1/bank/payment"
  );
}

function getAesKey(): string | null {
  const key = process.env.ICICI_EAZYPAY_AES_KEY;
  return key && key.trim() !== "" ? key.trim() : null;
}

/** Eazypay is "configured" once the backend AES key is present. */
export function isEazypayConfigured(): boolean {
  return getAesKey() !== null;
}

function cipherAlgoForKey(keyBytes: Buffer): string | null {
  switch (keyBytes.length) {
    case 16:
      return "aes-128-ecb";
    case 24:
      return "aes-192-ecb";
    case 32:
      return "aes-256-ecb";
    default:
      return null;
  }
}

/**
 * AES/ECB/PKCS5Padding encrypt -> Base64. Returns null if key missing/invalid.
 * Each Eazypay request parameter value is encrypted independently.
 */
export function encrypt(value: string): string | null {
  const key = getAesKey();
  if (key === null) return null;
  try {
    const keyBytes = Buffer.from(key, "utf8");
    const algo = cipherAlgoForKey(keyBytes);
    if (!algo) return null;
    const cipher = crypto.createCipheriv(algo, keyBytes, null);
    cipher.setAutoPadding(true); // PKCS#7/PKCS5 padding
    const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    return encrypted.toString("base64");
  } catch {
    return null;
  }
}

export interface PaymentUrlParams {
  referenceNo: string;
  subMerchantId: string;
  amount: number | string;
  name: string;
  email: string;
  mobile: string;
  paymode?: number | string;
}

/**
 * Build the final encrypted Eazypay payment URL.
 * `merchantid` is plaintext; every other parameter value is AES-encrypted and
 * URL-encoded. Param names (including the ones with spaces) match the ICICI spec.
 * Returns null when the AES key is not configured.
 */
export function buildPaymentUrl(params: PaymentUrlParams): string | null {
  const { referenceNo, subMerchantId, amount, name, email, mobile } = params;
  const paymode = String(params.paymode ?? 9);
  const amountStr = String(amount);

  // ReferenceNo|SubMerchantID|PGAmount|Name|Email|Mobile
  const mandatory = [referenceNo, subMerchantId, amountStr, name, email, mobile].join("|");

  const parts: Record<string, string> = {
    "mandatory fields": mandatory,
    "optional fields": "",
    returnurl: getReturnUrl(),
    "Reference No": referenceNo,
    submerchantid: subMerchantId,
    "transaction amount": amountStr,
    paymode,
  };

  const query: string[] = [`merchantid=${encodeURIComponent(getMerchantId())}`];
  for (const [name_, value] of Object.entries(parts)) {
    // Eazypay expects empty optional fields to remain blank (encrypted-or-blank).
    const enc = value === "" ? "" : encrypt(value);
    if (enc === null) return null; // key missing => cannot build a real URL
    query.push(`${encodeURIComponent(name_)}=${encodeURIComponent(enc)}`);
  }

  return `${EAZYPAY_BASE_URL}?${query.join("&")}`;
}

/** Fields returned by Eazypay on the callback, in signature order. */
export interface EazypayResponseFields {
  ID: string;
  "Response Code": string;
  "Unique Ref Number": string;
  "Service Tax Amount": string;
  "Processing Fee Amount": string;
  "Total Amount": string;
  "Transaction Amount": string;
  "Transaction Date": string;
  "Interchange Value": string;
  TDR: string;
  "Payment Mode": string;
  SubMerchantId: string;
  ReferenceNo: string;
  TPS: string;
}

const SIGNATURE_ORDER: (keyof EazypayResponseFields)[] = [
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

/**
 * Recompute the SHA-512 signature from the response fields + AES key and
 * compare against the bank-provided RS. Returns false if the key is missing
 * or the signatures do not match.
 */
export function verifyResponseSignature(fields: Partial<EazypayResponseFields>, rs: string | null): boolean {
  const key = getAesKey();
  if (key === null || !rs) return false;
  try {
    const values = SIGNATURE_ORDER.map((k) => fields[k] ?? "");
    const payload = [...values, key].join("|");
    const computed = crypto.createHash("sha512").update(payload, "utf8").digest("hex");
    const a = Buffer.from(computed.toLowerCase());
    const b = Buffer.from(String(rs).toLowerCase());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * SubMerchantID resolution. ICICI expects a (numeric-ish) SubMerchantID; our
 * courses use string ids, so we map known items and fall back to "11".
 * Override/extend via ICICI_EAZYPAY_SUBMERCHANT_MAP env (JSON: {"slug":"12"}).
 */
function subMerchantMap(): Record<string, string> {
  const raw = process.env.ICICI_EAZYPAY_SUBMERCHANT_MAP;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export function eazypaySubMerchantId(itemType: string, idOrSlug: string): string {
  const map = subMerchantMap();
  return map[idOrSlug] || map[`${itemType}:${idOrSlug}`] || "11";
}

/**
 * Unique, Eazypay-safe reference number.
 * Format: NAMAN-<CODE>-<base36 ts>-<rand4>  (uppercase, <= ~28 chars).
 */
export function makeReferenceNo(code: string): string {
  const safeCode = (code || "ITEM")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8) || "ITEM";
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `NAMAN-${safeCode}-${ts}-${rand}`;
}

/**
 * Stateless status hand-off.
 *
 * On a serverless platform the ICICI callback and the status page may run on
 * different instances than the one that created the (in-memory) record, so we
 * can't rely on shared memory. Instead the callback — which has ALREADY
 * verified ICICI's SHA-512 signature server-side — signs the final result with
 * an HMAC (keyed by the backend AES key) and passes it to the status page via
 * the redirect. The status endpoint re-verifies the HMAC, so the result is
 * authoritative and cannot be spoofed by a user editing the URL. When a real
 * database is configured the record is also persisted for the admin/ledger.
 */
export function signStatusParams(referenceNo: string, status: string, amount: string | number): string {
  const key = getAesKey();
  if (key === null) return "";
  const payload = `${referenceNo}|${status}|${amount}`;
  return crypto.createHmac("sha256", key).update(payload, "utf8").digest("hex");
}

export function verifyStatusSignature(
  referenceNo: string,
  status: string,
  amount: string | number,
  sig: string | null
): boolean {
  const key = getAesKey();
  if (key === null || !sig) return false;
  try {
    const expected = signStatusParams(referenceNo, status, amount);
    const a = Buffer.from(expected);
    const b = Buffer.from(String(sig));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Gateway-truth from the evidence we ALREADY persisted on the payment row.
 *
 * The verified callback (/api/v1/bank/payment) records ICICI's `Response Code`
 * and whether its SHA-512 signature checked out. That is authoritative gateway
 * data — no outbound call needed:
 *   - response_code E000 + verified_signature true -> "paid"
 *   - any other present response_code (gateway reported an outcome)      -> "failed"
 *   - nothing recorded (callback never landed)                          -> "unknown"
 *
 * "unknown" is the fail-safe: callers must NOT flip such rows to failed without
 * an explicit decision, so a genuinely-paid user is never wrongly failed.
 */
export function verifyFromStoredCallback(row: {
  response_code?: string | null;
  verified_signature?: boolean | null;
}): "paid" | "failed" | "unknown" {
  const code = (row.response_code || "").trim().toUpperCase();
  if (!code) return "unknown";
  if (code === "E000" && row.verified_signature === true) return "paid";
  return "failed";
}

// ============================ ICICI EAZYPAY VERIFY URL (status API) ============================
/**
 * ICICI Eazypay "Verify URL" — the real, authoritative transaction-status API.
 *
 * Queried by Merchant ID + our own Reference No (Option 3 in the Eazypay v4.3
 * integration doc). Needs NO new credentials, NO AES encryption and NO request
 * signature — it is a plain GET that returns a plaintext `key=value&…` packet.
 *
 *   GET https://eazypay.icicibank.com/EazyPGVerify?merchantid=<MID>&pgreferenceno=<ref>
 *
 * Status values (8.1.5):
 *   RIP (Reconciliation in Progress), SIP (Settlement in Progress), Success
 *       -> money received from the payer's bank -> PAID
 *   FAILED / TIMEOUT / Transaction Expired / Cheque-DD Returned
 *       -> ICICI-reported non-success -> FAILED
 *   Transaction Initiated / Challan Generated / Cheque-DD In Clearance
 *       -> payer never completed -> ABANDONED (hot lead)
 *   (empty / unreachable / parse error) -> "unknown" (do NOT change the row)
 *
 * IMPORTANT — ICICI firewalls this endpoint by source IP. It only answers from a
 * server IP whitelisted with ICICI for the merchant. On Vercel (dynamic egress)
 * route the call through a fixed-IP proxy whose IP ICICI has whitelisted, via
 * EAZYPAY_VERIFY_PROXY_URL (QuotaGuard/Fixie HTTP proxy, or a relay — see env).
 */
export const EAZYPAY_VERIFY_URL = "https://eazypay.icicibank.com/EazyPGVerify";

export type VerifyOutcome = "paid" | "failed" | "abandoned" | "unknown";

export interface EazypayVerifyResult {
  /** Did we get a parseable response from ICICI at all? */
  reachable: boolean;
  /** Mapped lifecycle outcome. */
  outcome: VerifyOutcome;
  /** Raw `status=` token from ICICI, for audit/debugging. */
  rawStatus: string | null;
  /** ICICI's eazypay transaction id, when present. */
  gatewayRef: string | null;
  /** Amount echoed back by ICICI, when present. */
  amount: number | null;
  /** Populated when reachable=false. */
  error?: string;
}

/** Map an ICICI Verify-URL `status` token to our lifecycle outcome. */
export function mapVerifyStatus(rawStatus: string | null | undefined): VerifyOutcome {
  const s = (rawStatus || "").trim().toUpperCase();
  if (!s) return "unknown";
  // Money received from the bank (reconciling / settling / settled).
  if (s === "RIP" || s === "SIP" || s === "SUCCESS" || s === "PAID") return "paid";
  // ICICI explicitly reported a non-success terminal outcome.
  if (
    s === "FAILED" ||
    s === "TIMEOUT" ||
    s.includes("EXPIRED") ||
    s.includes("RETURNED") ||
    s.includes("CANCEL") ||
    s.includes("REJECT")
  )
    return "failed";
  // Payer started but never completed (or non-card challan awaiting payment).
  if (
    s.includes("INITIATED") ||
    s.includes("CHALLAN") ||
    s.includes("CLEARANCE") ||
    s.includes("PENDING")
  )
    return "abandoned";
  return "unknown";
}

/** Parse the plaintext `key=value&key=value` packet ICICI returns. */
function parseVerifyPacket(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (body || "").split("&")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

/**
 * Build the proxied/direct fetch for the Verify URL.
 *
 * EAZYPAY_VERIFY_PROXY_URL (optional) routes the call through a fixed, ICICI-
 * whitelisted IP. Two supported shapes:
 *   - HTTP forward proxy (QuotaGuard/Fixie):  http://user:pass@host:port
 *       (default) — used as an undici ProxyAgent dispatcher.
 *   - Relay endpoint (EAZYPAY_VERIFY_PROXY_MODE=relay): your tiny static-IP
 *       service that fetches the target. We call:  <proxyUrl>?target=<encoded>
 *       (or substitute a `{target}` placeholder if present).
 */
async function fetchVerify(targetUrl: string, timeoutMs: number): Promise<Response> {
  const proxy = (process.env.EAZYPAY_VERIFY_PROXY_URL || "").trim();
  const mode = (process.env.EAZYPAY_VERIFY_PROXY_MODE || "").trim().toLowerCase();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (proxy && mode === "relay") {
      const relay = proxy.includes("{target}")
        ? proxy.replace("{target}", encodeURIComponent(targetUrl))
        : `${proxy}${proxy.includes("?") ? "&" : "?"}target=${encodeURIComponent(targetUrl)}`;
      return await fetch(relay, { signal: controller.signal, cache: "no-store" });
    }
    if (proxy) {
      // HTTP forward proxy (QuotaGuard/Fixie). undici ships with Node/Next at
      // runtime. Resolve via a runtime require so neither webpack nor tsc tries
      // to bundle/type-resolve it at build time.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeRequire = eval("require") as (m: string) => any;
      const { ProxyAgent } = nodeRequire("undici") as { ProxyAgent: new (uri: string) => unknown };
      const dispatcher = new ProxyAgent(proxy);
      return await fetch(targetUrl, {
        signal: controller.signal,
        cache: "no-store",
        // @ts-expect-error undici dispatcher is accepted by the runtime fetch
        dispatcher,
      });
    }
    return await fetch(targetUrl, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Query ICICI's Verify URL for the live status of a payment by our reference no.
 * Never throws — on any network/parse failure returns reachable:false so callers
 * keep the row in its current (non-terminal) state. Read-only; no DB writes here.
 */
export async function eazypayVerify(
  referenceNo: string,
  opts?: { timeoutMs?: number }
): Promise<EazypayVerifyResult> {
  const unreachable = (error: string): EazypayVerifyResult => ({
    reachable: false,
    outcome: "unknown",
    rawStatus: null,
    gatewayRef: null,
    amount: null,
    error,
  });
  const ref = (referenceNo || "").trim();
  if (!ref) return unreachable("missing reference");

  const qs = new URLSearchParams({
    ezpaytranid: "",
    amount: "",
    paymentmode: "",
    merchantid: getMerchantId(),
    trandate: "",
    pgreferenceno: ref,
  });
  const target = `${EAZYPAY_VERIFY_URL}?${qs.toString()}`;

  try {
    const res = await fetchVerify(target, opts?.timeoutMs ?? 12_000);
    if (!res.ok) return unreachable(`HTTP ${res.status}`);
    const body = await res.text();
    const packet = parseVerifyPacket(body);
    const rawStatus = packet["status"] ?? packet["Status"] ?? null;
    // ICICI returns a body but with no status token for an unknown reference.
    if (rawStatus === null && Object.keys(packet).length === 0) {
      return { reachable: true, outcome: "unknown", rawStatus: null, gatewayRef: null, amount: null };
    }
    const amtRaw = packet["amount"] ?? packet["Amount"] ?? "";
    const amt = amtRaw !== "" && !Number.isNaN(Number(amtRaw)) ? Number(amtRaw) : null;
    return {
      reachable: true,
      outcome: mapVerifyStatus(rawStatus),
      rawStatus,
      gatewayRef: packet["ezpaytranid"] || null,
      amount: amt,
    };
  } catch (e) {
    return unreachable((e as Error).message || "verify request failed");
  }
}

/** Human-readable item label derived from the reference prefix (NAMAN-<TYPE>-…). */
export function itemTypeFromReference(referenceNo: string): "course" | "plan" | "webinar" | "item" {
  const seg = referenceNo.split("-")[1]?.toUpperCase() || "";
  if (seg === "COURSE") return "course";
  if (seg === "PLAN") return "plan";
  if (seg === "WEBINAR") return "webinar";
  return "item";
}
