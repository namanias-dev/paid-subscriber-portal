# ICICI Eazypay — "Verifying" Payments Investigation & Report

**Prepared:** 2026-06-28 · **Scope:** last 100 payments (live Supabase) + full code review of the Eazypay flow.
**Status:** Investigation + report only. No changes were made to the live payment flow in this pass.

> Parts of this report (Sections 2, 5, 6) are written so they can be sent directly to the ICICI Eazypay integration team.

---

## 1. Executive summary

A large share of recent payments are stuck in the **`VERIFYING`** state and never resolve to `PAID` or `FAILED`.

In the **last 100 payments**:

| Status | Count | What it means |
|---|---:|---|
| **VERIFYING** | **59** | We never got a result from ICICI for these. 47 webinar + 12 course. |
| **PAID** | 28 | Confirmed (24 via the ICICI return callback, 2 offline, 2 other). |
| **FAILED** | 13 | ICICI told us the payment failed (declined / E006 etc.). |

The single biggest finding:

> **All 59 `VERIFYING` rows have NO callback data at all** (`response_code` is empty). For these customers, **ICICI never delivered the return/callback to our server**, and our fallback **server-to-server "Verify URL" check cannot reach ICICI because our server IP is not whitelisted**. So the payment can never be auto-confirmed — it just stays "Verifying" forever.

Two independent problems compound here:

1. **The browser return-callback is the only thing that confirms a payment today, and it often doesn't arrive** (user closes the tab / UPI app, network drop, no server-to-server confirmation). 63 of the last 100 payments (`response_code` null) never produced a callback on our side.
2. **The reconciliation fallback is blocked.** Our daily cron + "Re-verify" button call ICICI's Verify URL, but it is **firewalled by source IP** and Vercel has **no fixed outbound IP**, and **no static-IP proxy was ever set up**. So every verify attempt returns "unreachable/unknown" and the row is left in `VERIFYING`. Evidence: of the 59 stuck rows, 40 have already been retried an average of **4.1 times** with zero resolutions.

**Net effect:** genuinely-paying students sit in limbo (no access, no login until staff manually accept), and we can't tell paid-but-lost-callback apart from abandoned checkouts automatically.

---

## 2. How the ICICI Eazypay verification flow works today (for the ICICI team)

**Merchant:** ID `343526` · **Sub-merchant:** per-item (default `11`).
**Encryption:** AES/ECB/PKCS5Padding, Base64 (per Eazypay spec). **Callback signature:** SHA-512 over pipe-joined response fields + AES key.

There are **three** mechanisms in our code; only the first currently works in production:

### (a) Browser return callback — *works when it arrives*
- After payment, ICICI redirects the payer's browser to our **Return URL**:
  `https://namanias.com/api/v1/bank/payment`
- We read `ReferenceNo`, `Response Code`, `RS` (signature) and the amount fields, **recompute the SHA-512 signature** and compare.
- `Response Code = E000` **and** valid signature → mark **PAID** (+ grant access, issue receipt/login code). Anything else → **FAILED**.
- **Problem:** this is a *browser redirect*, not a guaranteed server-to-server postback. If the customer closes the tab/app, loses network, or the redirect never fires, **we receive nothing** and the row never leaves its pre-callback state. In our data, **63/100** payments produced **no callback at all**.

### (b) Verify URL (server-to-server status API) — *blocked by IP whitelisting*
- We call `GET https://eazypay.icicibank.com/EazyPGVerify?merchantid=<MID>&pgreferenceno=<ourRef>` and map the `status` token:
  - `RIP` / `SIP` / `Success` → PAID
  - `FAILED` / `TIMEOUT` / `EXPIRED` / `RETURNED` → FAILED
  - `Initiated` / `Challan` / `Clearance` / `Pending` → ABANDONED (not completed)
  - empty / unreachable → **unknown → leave the row unchanged (stays VERIFYING)**
- **Problem:** ICICI **firewalls this endpoint by source IP**. Our server (Vercel serverless) is **not whitelisted**, and Vercel has **no fixed egress IP**, so the call is refused/unreachable. Every attempt returns "unknown". **This is why the 59 stuck rows never resolve** despite ~4 retries each.

### (c) Timer / promotion — *safe holding state, not a confirmation*
- A daily cron (`/api/cron/verify-payments`, 03:00) and an on-read sweep run mechanism (b). A timer **never** marks a payment `FAILED`; it can only move a stale `PENDING` → **`VERIFYING`** (a "we're still checking" label). So `VERIFYING` is precisely "we couldn't get an answer from ICICI."

**Important design note (correct, keep it):** we deliberately never auto-fail a payment on a timeout — only an explicit ICICI answer can produce `FAILED`. This protects genuinely-paid students from being wrongly failed. The downside is that without a working Verify channel, unanswered payments accumulate as `VERIFYING`.

---

## 3. The data — last 100 payments, categorized with root cause

### 3.1 By status, item and gateway
| Status | Item | Gateway | Count |
|---|---|---|---:|
| VERIFYING | webinar | ICICI | 47 |
| PAID | webinar | ICICI | 24 |
| FAILED | webinar | ICICI | 13 |
| VERIFYING | course | ICICI | 12 |
| PAID | webinar | offline | 2 |
| PAID | course | ICICI | 2 |

### 3.2 By callback evidence (the root-cause cut)
| Status | Count | Has ICICI callback | No callback | Valid signature | Verify retried | Avg verify attempts |
|---|---:|---:|---:|---:|---:|---:|
| **VERIFYING** | 59 | **0** | **59** | 0 | 40 | **4.1** |
| PAID | 28 | 24 | 4 | 22 | 4 | 0.8 |
| FAILED | 13 | 13 | 0 | 1 | 11 | 5.8 |

### 3.3 By ICICI response code
| Response code | Count | → PAID | → VERIFYING | → FAILED | Meaning |
|---|---:|---:|---:|---:|---|
| *(none / no callback)* | 63 | 4 | **59** | 0 | ICICI never called us back |
| `E000` | 22 | 22 | 0 | 0 | Success |
| `E006` | 13 | 2 | 0 | 11 | Transaction failed/declined |
| `E0801` | 1 | 0 | 0 | 1 | Failure |
| `E00335` | 1 | 0 | 0 | 1 | Failure |

### 3.4 Root-cause categories (counts)
- **No callback received + cannot verify server-side → stuck (59):** the core problem. ICICI didn't postback, and the Verify URL is IP-blocked. A mix of (i) real payments whose callback was lost and (ii) customers who abandoned at the bank page — **we currently cannot tell them apart automatically**.
- **Confirmed via callback (35):** 22 success (`E000`→PAID) + 13 failure (`E006`/other→FAILED). When the callback lands, the flow works correctly.
- **Resolved without callback (4 PAID):** offline recording / manual accept.

**Conclusion:** this is **not** a signature-mismatch problem (every `E000` callback verified fine). It is a **delivery + reconciliation** problem: the callback frequently doesn't reach us, and the only fallback (Verify URL) is **blocked by missing IP whitelisting**.

---

## 4. Is there automated reconciliation? What's missing?

- **Exists:** a daily cron + manual "Re-verify" button + lazy on-read sweep, all built on ICICI's Verify URL, with backoff and a T+3-day window. The logic is correct and idempotent (never downgrades a PAID row, never auto-fails).
- **Missing / blocked:**
  1. **A reachable verification channel.** The Verify URL is firewalled; we have no whitelisted static IP/proxy, so reconciliation produces "unknown" every time.
  2. **A guaranteed server-to-server callback** from ICICI (independent of the customer's browser), so confirmation doesn't depend on the redirect completing.

Fix either one and the `VERIFYING` backlog drains automatically.

---

## 5. ⚠️ Infra gap: Vercel ↔ ICICI static-IP whitelisting (NOT done)

**We have NOT completed the static-IP whitelisting with ICICI. The dedicated static IP we discussed was never created.** This is a primary contributor to the stuck-`VERIFYING` flood.

**Why it matters:**
- ICICI's **Verify URL** (and typically their server-to-server callbacks) are **restricted to whitelisted source IPs** for the merchant.
- **Vercel serverless functions do not have a fixed outbound IP** — egress comes from a large, changing AWS pool. So even if ICICI tried to whitelist us, there is **no single IP to whitelist**, and our outbound verify calls originate from IPs ICICI doesn't recognize → blocked.
- Result: outbound reconciliation calls fail, and any IP-restricted inbound postback would also be unreliable.

**Options to fix (pick one):**
1. **Static-IP egress proxy (fastest):** route only the ICICI verify call through a fixed-IP HTTP proxy (e.g. QuotaGuard Static / Fixie) and give ICICI that proxy IP to whitelist. *Our code already supports this* via `EAZYPAY_VERIFY_PROXY_URL` (HTTP proxy) or `EAZYPAY_VERIFY_PROXY_MODE=relay` (relay endpoint) — no code change needed, just provision + set the env var + ask ICICI to whitelist that IP.
2. **Tiny relay on fixed-IP infra:** a small always-on service (a cheap VPS / Cloud Run with a static IP / AWS NAT-gateway EIP) that performs the verify call; whitelist its IP with ICICI. Point `EAZYPAY_VERIFY_PROXY_URL` at it in relay mode.
3. **Server-to-server callback (best long-term):** ask ICICI to enable a **guaranteed S2S callback/webhook** to a dedicated endpoint, so confirmation never depends on the browser redirect. Combine with (1)/(2) for reconciliation.

**Action item:** provision a static outbound IP (proxy or relay), set `EAZYPAY_VERIFY_PROXY_URL`, and have ICICI whitelist that exact IP for merchant `343526`. Until then, reconciliation cannot run and stuck payments must be cleared manually (Accept / Upload-proof + Approve flow).

---

## 6. What we need from the ICICI Eazypay team (please action / answer)

1. **Server-to-server verification:** confirm the correct **Verify URL / Status API** for merchant `343526`, the exact request params, and whether it is **IP-restricted**. If yes, provide the whitelisting process and confirm which **single source IP** we should submit (we will route via a fixed-IP proxy).
2. **Whitelist our IP:** once we provide a static IP, please whitelist it for both the Verify URL and any server-to-server callbacks.
3. **Guaranteed callback/webhook:** can you enable a **server-to-server postback** (not just the browser return URL) that fires on every terminal outcome (success/failure), with retries? If so, what is the payload, signature scheme, and retry policy?
4. **Status token reference:** please confirm the full list of `status` values the Verify URL can return and the official mapping to *success / failed / pending/abandoned* (we currently map `RIP/SIP/Success`→paid; `FAILED/TIMEOUT/EXPIRED/RETURNED`→failed; `Initiated/Challan/Clearance/Pending`→not-completed).
5. **Response codes:** confirm the meaning of the codes we're seeing — `E000` (success), `E006`, `E0801`, `E00335` — and the complete code list.
6. **Reconciliation/MIS:** is there a **bulk settlement/MIS report or batch status API** we can pull daily to reconcile a day's references in one call?
7. **Callback reliability:** for the references we'll share (all `VERIFYING`, prefix `NAMAN-…`), can you confirm from your side whether money was actually received, so we can reconcile the backlog?

*(We can share a CSV of the stuck reference numbers, amounts and timestamps on request.)*

---

## 7. Safe, additive improvements (no risk to the live flow)

- **Already available:** the admin **"Re-verify payments"** button (global / filtered / per-row) and the per-row **↻** action call the same idempotent verifier on demand — useful the moment the IP whitelisting is in place, to drain the backlog instantly. No new risky code was added.
- **New (this pass), unrelated to risk:** staff can now **Upload proof + Approve** a payment, and a Super Admin can **Reverse** an approval, all written to an immutable audit log — so the `VERIFYING` backlog can be cleared safely and accountably by hand until ICICI verification is reachable. (See `docs/staff/payments.md`.)
- **Recommended next (after whitelisting):** point `EAZYPAY_VERIFY_PROXY_URL` at the static-IP proxy/relay; the existing daily cron + sweep will then auto-resolve `VERIFYING` rows with no further code changes.

---

## 8. Bottom line

The "Verifying" flood is **not a bug in our verification logic** — it's caused by (1) ICICI's browser callback frequently not arriving and (2) our server-to-server Verify URL being **blocked because the Vercel↔ICICI static-IP whitelisting was never set up**. Standing up a fixed-IP proxy/relay and whitelisting it with ICICI (and/or enabling a guaranteed S2S callback) will let the existing reconciliation drain the backlog automatically. Until then, use the manual **Upload-proof → Approve** flow to clear genuine payers.
