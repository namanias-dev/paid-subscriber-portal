/**
 * Notes Store — ICICI Eazypay client. BACKEND ONLY.
 *
 * The store shares merchant 343526, paymode 9 and the return URL with course
 * payments, because ICICI will not issue a second return URL or SubMerchantId.
 * Isolation therefore rests on the `NIASN-N-` reference namespace, on store-owned
 * tables, and on the fact that the callback is advisory only while EazyPGVerify
 * is the sole terminal authority.
 *
 * What is reused from lib/eazypay.ts: exactly two pure functions, `encrypt()` and
 * `verifyResponseSignature()`. Nothing else. lib/eazypay.ts is never modified.
 *
 * What is deliberately duplicated rather than imported, and why:
 *  - The Verify HTTP call. It carries two hard-won operational landmines that
 *    must not be lost: ICICI's WAF serves an HTML error page to Node's default
 *    User-Agent (so we must look like curl), and sending `trandate` makes
 *    EazyPGVerify report NotInitiated for settled payments, falsely expiring real
 *    money. Both are reproduced below with their reasoning intact.
 *  - The status mapping, which lives in ./status.ts.
 * The cost is that an ICICI behaviour change needs applying twice. That is the
 * accepted price of two money domains that cannot corrupt each other.
 */
import { encrypt, verifyResponseSignature, type EazypayResponseFields } from "@/lib/eazypay";

export const STORE_EAZYPAY_BASE_URL = "https://eazypay.icicibank.com/EazyPG";
export const STORE_EAZYPAY_VERIFY_URL = "https://eazypay.icicibank.com/EazyPGVerify";
export const STORE_PAYMENT_PROVIDER = "ICICI_EAZYPAY" as const;

/** Same merchant as courses. Read directly so nothing extra is imported. */
export function storeMerchantId(): string {
  return process.env.ICICI_EAZYPAY_MERCHANT_ID || "343526";
}

/**
 * The SHARED return URL. Store callbacks land on the course endpoint and are
 * dispatched to the store by reference prefix. This is safe because the callback
 * is advisory and the store independently re-verifies the signature.
 */
export function storeReturnUrl(): string {
  return process.env.ICICI_EAZYPAY_RETURN_URL || "https://namanias.com/api/v1/bank/payment";
}

/**
 * Store SubMerchantId. Production has only ever used "11", so "21" is free
 * signal: it is a per-request parameter and it sits inside the signed response
 * payload, letting the store callback assert that a response really is its own.
 * If ICICI rejects an unregistered SubMerchantId, set NOTES_STORE_SUBMERCHANT_ID
 * to "11" — nothing depends on it.
 */
export function storeSubMerchantId(): string {
  return (process.env.NOTES_STORE_SUBMERCHANT_ID || "21").trim() || "21";
}

/** Same paymode as courses. Never experimented with against a live merchant. */
export const STORE_PAYMODE = 9;

/**
 * Rupee string for the gateway. Eazypay is given rupees, while the store keeps
 * paise internally; whole rupees are sent without decimals, matching what the
 * course path has always sent successfully.
 */
export function paiseToGatewayAmount(paise: number): string {
  const p = Math.round(paise);
  return p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2);
}

export interface StorePaymentUrlInput {
  referenceNo: string;
  amountPaise: number;
  name: string;
  email: string;
  mobile: string;
}

/**
 * Build the encrypted Eazypay payment URL for a store order.
 *
 * Parameter names, ordering and the encrypt-each-value-independently rule are
 * ICICI's, not ours. `merchantid` is plaintext; every other value is
 * AES-encrypted then URL-encoded; a blank optional field stays blank.
 * Returns null when the AES key is absent, so the app still runs unconfigured.
 */
export function buildStorePaymentUrl(input: StorePaymentUrlInput): string | null {
  const amount = paiseToGatewayAmount(input.amountPaise);
  const subMerchantId = storeSubMerchantId();

  // ReferenceNo|SubMerchantID|PGAmount|Name|Email|Mobile
  const mandatory = [
    input.referenceNo,
    subMerchantId,
    amount,
    input.name,
    input.email,
    input.mobile,
  ].join("|");

  const parts: Record<string, string> = {
    "mandatory fields": mandatory,
    "optional fields": "",
    returnurl: storeReturnUrl(),
    "Reference No": input.referenceNo,
    submerchantid: subMerchantId,
    "transaction amount": amount,
    paymode: String(STORE_PAYMODE),
  };

  const query: string[] = [`merchantid=${encodeURIComponent(storeMerchantId())}`];
  for (const [key, value] of Object.entries(parts)) {
    const enc = value === "" ? "" : encrypt(value);
    if (enc === null) return null; // no AES key — cannot build a real URL
    query.push(`${encodeURIComponent(key)}=${encodeURIComponent(enc)}`);
  }

  return `${STORE_EAZYPAY_BASE_URL}?${query.join("&")}`;
}

/** Re-verify ICICI's SHA-512 response signature. Never trusts the router. */
export function verifyStoreCallbackSignature(
  fields: Partial<EazypayResponseFields>,
  rs: string | null,
): boolean {
  return verifyResponseSignature(fields, rs);
}

// ============================ EazyPGVerify (terminal authority) ==============

export interface StoreVerifyResult {
  /** Did we get a parseable response at all? */
  reachable: boolean;
  /** Raw `status=` token, kept for audit. */
  rawStatus: string | null;
  /** ICICI's transaction id, when present. */
  gatewayRef: string | null;
  /** Amount echoed back, in rupees, when present. */
  amount: number | null;
  httpStatus: number | null;
  error?: string;
}

/** Parse the plaintext `key=value&key=value` packet ICICI returns. */
function parseVerifyPacket(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (body || "").split(/[&\r\n]+/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim().toLowerCase();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

async function fetchVerify(targetUrl: string, timeoutMs: number): Promise<Response> {
  const proxy = (process.env.EAZYPAY_VERIFY_PROXY_URL || "").trim();
  const mode = (process.env.EAZYPAY_VERIFY_PROXY_MODE || "").trim().toLowerCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // ICICI's Verify endpoint sits behind a WAF that serves a generic HTML error
  // page — with no `status=` token — to the default Node/undici User-Agent,
  // which is exactly what runs on the server. A curl-style UA gets the real
  // plaintext packet. Verified empirically on the course path; do not "clean
  // this up" by removing the headers.
  const headers = { "User-Agent": "curl/8.4.0", Accept: "*/*" } as const;

  try {
    if (proxy && mode === "relay") {
      const relay = proxy.includes("{target}")
        ? proxy.replace("{target}", encodeURIComponent(targetUrl))
        : `${proxy}${proxy.includes("?") ? "&" : "?"}target=${encodeURIComponent(targetUrl)}`;
      return await fetch(relay, { signal: controller.signal, cache: "no-store", headers });
    }
    if (proxy) {
      const nodeRequire = eval("require") as (m: string) => unknown;
      const { ProxyAgent } = nodeRequire("undici") as { ProxyAgent: new (uri: string) => unknown };
      const dispatcher = new ProxyAgent(proxy);
      return await fetch(targetUrl, {
        signal: controller.signal,
        cache: "no-store",
        headers,
        // @ts-expect-error undici dispatcher is accepted by the runtime fetch
        dispatcher,
      });
    }
    return await fetch(targetUrl, { signal: controller.signal, cache: "no-store", headers });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Query EazyPGVerify for the live status of a store payment by our own
 * reference. Read-only: never writes, never throws. On any failure it reports
 * reachable:false so the caller leaves the row exactly as it was.
 */
export async function storeEazypayVerify(
  referenceNo: string,
  opts?: { gatewayRef?: string | null; amountPaise?: number | null; timeoutMs?: number },
): Promise<StoreVerifyResult> {
  const unreachable = (error: string, httpStatus?: number | null): StoreVerifyResult => ({
    reachable: false,
    rawStatus: null,
    gatewayRef: null,
    amount: null,
    httpStatus: httpStatus ?? null,
    error,
  });

  const ref = (referenceNo || "").trim();
  if (!ref) return unreachable("missing reference");

  const blankOr = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v).trim());
  const qs = new URLSearchParams({
    merchantid: storeMerchantId(),
    pgreferenceno: ref,
    ezpaytranid: blankOr(opts?.gatewayRef),
    amount: opts?.amountPaise != null ? paiseToGatewayAmount(opts.amountPaise) : "",
    paymentmode: "",
    // CRITICAL: never send trandate. Any value makes EazyPGVerify answer
    // NotInitiated for settled Success rows, which would falsely EXPIRE real
    // payments once the callback has stored a transaction date.
    trandate: "",
  });

  const target = `${STORE_EAZYPAY_VERIFY_URL}?${qs.toString()}`;

  try {
    const res = await fetchVerify(target, opts?.timeoutMs ?? 12_000);
    const body = await res.text().catch(() => "");
    console.info(
      `[store/eazypayVerify] ref=${ref} http=${res.status} raw=${(body || "").slice(0, 300).replace(/\s+/g, " ")}`,
    );
    if (!res.ok) return unreachable(`HTTP ${res.status}`, res.status);

    const packet = parseVerifyPacket(body);
    const rawStatus = packet["status"] ?? null;
    if (rawStatus === null && Object.keys(packet).length === 0) {
      // A body with no recognisable pairs means ICICI does not know this
      // reference yet. Not an answer.
      return { reachable: true, rawStatus: null, gatewayRef: null, amount: null, httpStatus: res.status };
    }

    // ICICI writes literal "NA" / "null" placeholders for empty fields.
    const clean = (v: string | undefined) => {
      const t = (v ?? "").trim();
      return t && t.toUpperCase() !== "NA" && t.toLowerCase() !== "null" ? t : "";
    };
    const amountRaw = clean(packet["amount"]);
    const amount = amountRaw !== "" && !Number.isNaN(Number(amountRaw)) ? Number(amountRaw) : null;

    return {
      reachable: true,
      rawStatus,
      gatewayRef: clean(packet["ezpaytranid"]) || null,
      amount,
      httpStatus: res.status,
    };
  } catch (e) {
    return unreachable((e as Error).message || "verify request failed");
  }
}
