/**
 * Safe Notes Store preview smoke (no real charge).
 * Usage:
 *   npx vercel env run -e development -- node scripts/notes-preview-smoke.mjs <preview-origin>
 *
 * Uses x-vercel-trusted-oidc-idp-token. Never prints the token or payment secrets.
 */
const origin = (process.argv[2] || "").replace(/\/$/, "");
const token = process.env.VERCEL_OIDC_TOKEN || "";
if (!origin) {
  console.error("usage: notes-preview-smoke.mjs <preview-origin>");
  process.exit(2);
}
if (!token) {
  console.error("VERCEL_OIDC_TOKEN missing — run via `vercel env run -e development --`");
  process.exit(2);
}

const jar = new Map();

function storeCookies(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const line of raw) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function req(path, opts = {}) {
  const headers = {
    ...(opts.headers || {}),
    "x-vercel-trusted-oidc-idp-token": token,
  };
  if (jar.size) headers.cookie = cookieHeader();
  const res = await fetch(`${origin}${path}`, { ...opts, headers, redirect: "follow" });
  storeCookies(res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: res.status, headers: res.headers, text: text.slice(0, 500_000), json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const status = await req("/api/notes/status");
  assert(status.status === 200, `status http ${status.status}: ${status.text.slice(0, 120)}`);
  assert(status.json?.enabled === true, `store not enabled: ${JSON.stringify(status.json)}`);

  const product = await req("/notes/products/test-only-polity-notes");
  assert(product.status === 200, `product page ${product.status}`);
  assert(product.text.includes("TEST ONLY"), "product page missing TEST ONLY label");
  assert(/₹\s*1\b|₹1/.test(product.text), "product page missing ₹1");

  // Prefer known TEST SKU id; fall back to parsing the PDP payload.
  let productId = "a1dcaa29-bc07-49ae-b810-2854e24d8d59";
  const idMatch =
    product.text.match(/"id":"([0-9a-f-]{36})"/) ||
    product.text.match(/productId["']?\s*[:=]\s*["']([0-9a-f-]{36})/);
  if (idMatch) productId = idMatch[1];

  const add = await req("/api/notes/cart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ product_id: productId, qty: 1 }),
  });
  assert(add.json?.ok, `add to cart failed: ${JSON.stringify(add.json)}`);

  const cart = await req("/api/notes/cart");
  assert(cart.json?.ok && cart.json.cart?.items?.length, "cart empty after add");

  // Max qty clamp (max_quantity_per_order = 2 on TEST SKU)
  const itemId = cart.json.cart.items[0].id;
  const over = await req("/api/notes/cart", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ item_id: itemId, qty: 99 }),
  });
  assert(over.json?.ok, `qty update failed: ${JSON.stringify(over.json)}`);
  const qty = over.json.cart.items[0].qty;
  assert(qty <= 2, `qty ${qty} exceeded max`);

  const pin = await req("/api/notes/pin?pin=160099");
  assert(pin.json?.ok && pin.json.shipping_paise === 0, "PIN 160099 should be zero shipping");

  // Do NOT call checkout here — that reserves inventory and creates a live
  // PAYMENT_PENDING row. The ₹1 human payment uses a fresh browser checkout.

  const trackBad = await req("/api/notes/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_no: "NIAS-N-2099-999999", phone: "9999999999" }),
  });
  assert(trackBad.status === 404, "bad track should 404");
  assert(trackBad.json?.error === "No order matches that number and phone", "enumerable track error");

  const verifyBad = await req("/api/notes/order/NIAS-N-2099-999999/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ t: "not-a-real-token" }),
  });
  assert(verifyBad.status === 404 && verifyBad.json?.error === "not found", "verify must not enumerate");

  const orderBare = await req("/notes/order/NIAS-N-2099-999999");
  assert(orderBare.status === 200, "bare order page should render capability prompt");
  assert(orderBare.text.includes("Confirm this order") || orderBare.text.includes("Track an order"), "missing capability UX");

  // Portal regression surface checks (public)
  const home = await req("/");
  assert(home.status === 200, `home ${home.status}`);
  const session = await req("/api/session/state");
  assert(session.status === 200, `session state ${session.status}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        origin,
        product_id: productId,
        cart_qty_after_clamp: qty,
        pin_shipping_paise: pin.json.shipping_paise,
        store_enabled: true,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
