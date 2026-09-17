/**
 * Notes Store callback dispatcher — the routing layer.
 *
 * ICICI will not issue a second return URL, so store and course callbacks arrive
 * at the same endpoint. This module is what the authorised additive shim at the
 * top of app/api/v1/bank/payment/route.ts calls, and it answers one question:
 * "is this response mine?"
 *
 * Two properties make it safe to put in front of the course handler:
 *
 *  1. It reads the body from `req.clone()`, so the original request body is
 *     untouched and the course handler's own readParams(req) still sees every
 *     field. Verified by test: draining a clone leaves all fields readable on the
 *     original. This is also why the middleware option was rejected — middleware
 *     has no way to hand a consumed body to a downstream handler, and a course
 *     callback arriving with an empty body would lose its ReferenceNo entirely.
 *
 *  2. A non-store reference returns null before anything else happens: no
 *     database call, no store module loaded, no logging. The course path is byte
 *     for byte what it was.
 *
 * The heavy handler is loaded by dynamic import, and only for a store reference,
 * so a fault in store code cannot affect a course callback even at module-load
 * time.
 */
import { isStoreReference } from "@/lib/store/references";

/**
 * Read query and form fields into a plain map. Deliberately the store's own
 * reader rather than the course route's, so the two never share a mutation path.
 */
export async function readCallbackParams(req: Request): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    new URL(req.url).searchParams.forEach((v, k) => map.set(k, v));
  } catch {
    /* unparseable URL — nothing to read */
  }
  if (req.method === "POST") {
    try {
      const form = await req.formData();
      form.forEach((v, k) => map.set(k, String(v)));
    } catch {
      /* GET-style callback, or an empty body */
    }
  }
  return map;
}

/**
 * Returns a Response when the callback belongs to the store, or null when the
 * caller should continue into its own (course) handling unchanged.
 */
export async function maybeDispatchNotesStoreCallback(req: Request): Promise<Response | null> {
  let params: Map<string, string>;
  try {
    // Clone: the caller's request body must remain fully readable.
    params = await readCallbackParams(req.clone());
  } catch {
    return null; // could not even look — never claim the callback
  }

  const referenceNo = (params.get("ReferenceNo") || "").trim();
  if (!isStoreReference(referenceNo)) return null;

  try {
    const { handleStoreCallback } = await import("./callback");
    return await handleStoreCallback(req, params, referenceNo);
  } catch (e) {
    // The store owns this reference, so it must not fall through into course
    // code. Send the customer somewhere honest and let Verify resolve the order.
    console.error(`[store/callback] dispatch failed ref=${referenceNo}:`, (e as Error).message);
    const origin = new URL(req.url).origin;
    return Response.redirect(`${origin}/notes/track?ref=${encodeURIComponent(referenceNo)}`, 302);
  }
}
