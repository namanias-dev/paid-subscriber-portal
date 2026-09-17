# Naman IAS Notes Store — Product & Engineering Specification

> Save this file into the repo at `docs/notes-store-spec.md` and commit it **before**
> giving the build prompt to Cursor. The agent must read requirements from the repo,
> not from chat attachments.

**Status:** requirements source of truth
**Owner:** Naman IAS Academy
**Gateway:** ICICI Eazypay (NOT Razorpay)
**COD:** not supported, at any phase

---

## 1. What this is

A production D2C physical-commerce layer inside the existing Naman IAS portal, selling
premium printed hard copies of Naman Sir's handwritten and curated UPSC notes.

It is a **tab inside the existing portal** — same codebase, same domain, same deploy.
A `/notes` entry in the public nav, its own sub-navigation, its own admin group under
`/admin/notes`. Not a subdomain. Not a second Next app. Not Shopify.

It shares: design tokens, typography, colour, component library, `PublicNav` shell,
R2 media, SMS/DLT sender, Telegram alerting, attribution, rate limiting, feature flags,
admin shell and audit logging.

It shares **nothing** in the money or entitlement layer.

### Positioning

Premium but accessible UPSC preparation material. Serious, aspirational, academic,
trustworthy, Indian, faculty-led, student-first. Sits between free social content and
high-ticket courses, and acts as a low-ticket entry point into the academy funnel.

Taste level: Apple / Stripe / Notion / premium Indian D2C — but unmistakably Naman IAS.
Deep navy, warm ivory, subtle premium gold. Light, spacious, editorial, minimal clutter.

**Not** a generic Shopify theme pasted into the portal. **Not** a low-cost stationery site.

### The value proposition

Curation, not page count. Clarity, revision efficiency, exam relevance, trust.
The product helps students consume **less but better-organised** material.

---

## 2. Absolute prohibitions

These are non-negotiable and apply to every phase.

### 2.1 No COD

Cash on delivery is not supported now or later. Prepaid only.

Do not build, and delete if already planned: COD risk tables, COD rules, OTP-confirm
before dispatch, COD ceilings, manual payout refunds, `cod_allowed` on products,
`payment_mode` on orders, COD columns in serviceability, COD/prepaid split metrics,
COD RTO scoring.

Serviceability checks remain — they answer deliverability and ETA only.

### 2.2 No false urgency or fabricated trust

No "14 people viewing", no "only 2 left" unless the number is real, no countdown timers,
no fabricated reviews, no unsupported topper claims. Reviews come from verified buyers
only, enforced at schema level.

### 2.3 No fake data in production

Seeded demo content must be visibly labelled and excluded from production builds.

### 2.4 Never trust the client

Price, quantity, coupon, shipping and total are recomputed server-side from the database
at capture. An order is never marked paid on a frontend response.

---

## 3. Domain isolation — the single most important rule

Store orders are a **separate money domain** from course enrolments.

A notes order must never:
- write to enrolment, fee-state, entitlement or student identity tables
- affect `isFullyPaid`
- unlock a lecture or a quiz
- silence a fee popup
- appear in course revenue reports, analytics revenue queries or Telegram digests

### Why this is mandatory, not stylistic

`getDashboard()` sums every paid row with no `item_type` filter. The analytics revenue
queries and Telegram digests read the same source. Adding store payments to the shared
`payments` table would pollute academy revenue on day one, in surfaces nobody would
think to check.

Separately, the last three production bugs in this codebase were all the same shape:
*two code paths disagree about who has paid.* This rule exists to prevent a fourth.

### The four enforcement layers

1. **Disjoint tables.** Every store table is `store_*`. No foreign key to `payments`,
   `students`, `buyers`, `course_enrollments`, `leads`. The only link is a `phone_key`
   text column — a join key, not a relationship.
2. **A DB check constraint** on `payments.item_type` restricting it to
   `('course','webinar','plan')`. Postgres refuses a store payment in the course ledger.
3. **An import guardrail test.** `lib/store/**` may not import `dataProvider`,
   `entitlements`, `paymentOutcome`, `installment*` or `enrollment*`. Store code gets
   its own thin data layer so "just reuse createPayment" has no on-ramp.
4. **Separate gateway identity.** A distinct Eazypay sub-merchant / reference namespace
   for store orders, so no store callback can ever be interpreted by course payment code.

Store code never calls `finalizeCoursePaymentByReference`, `runPaidTerminalSideEffects`,
`confirmOnce`, `enrollStudentInCourse`, `ensureStudentForCustomer`, `ensureBuyerRow`, any
fee-state function; never writes an entitlement; never revalidates a course or quiz cache tag.

### Identity

Guest checkout writes to **no identity table, ever**. No student stub, no `login_code`,
no half-formed account. The buyer↔customer link is derived at read time by phone and
never stored, so it cannot drift.

---

## 4. Payments — Eazypay

The academy's live gateway is **ICICI Eazypay** (`lib/eazypay.ts`,
`PAYMENT_GATEWAY = "ICICI_EAZYPAY"`). The store uses Eazypay.

Razorpay in this codebase is legacy: static payment links plus one webhook. That webhook,
on any signature-valid `payment.captured`, extends a student's subscription expiry or
**creates a new student** with a 1-month plan and access code via a `planFromAmount()`
fallback. It must not be modified and the store must not share its account.

### Store payment requirements

- Separate Eazypay reference namespace / sub-merchant for store orders. No store reference
  can be parsed by course payment code, and no course callback by store code.
- Copy the **pattern** of the existing payment-integrity work, not the code:
  DB-conditional writes, unique partial indexes on gateway references, a trigger blocking
  paid-status downgrades. Store gets its own status enum — sharing a helper is how domains leak.
- Server-side verification of every callback. Signature/checksum verified. Idempotent.
- **Quote lock:** at checkout, freeze a priced quote (items, prices, discounts, shipping,
  tax, total) with a short TTL. Capture validates against the quote, not the cart. This
  single mechanism solves price drift, coupon expiry mid-checkout and sold-out-mid-checkout.
- Store: gateway transaction ID, order reference, status, method, amount, response metadata,
  refund ID, refund status, all timestamps.
- Handle: success, failure, abandonment, duplicate callback, webhook retry, pending,
  refund, partial refund.
- Payment methods: UPI, cards, net banking, wallets where supported. All prepaid.
- A payment provider abstraction where reasonable, so a future gateway is pluggable.

### Order numbers

Human-friendly, unique, never exposing a database ID. Format `NIAS-N-2026-001284`.
Generated by a Postgres sequence + `lpad` in a plpgsql function, following the existing
`next_receipt_no()` pattern. Collision-safe under concurrency.

Appears in: confirmation screen, SMS, invoice, shipping label, admin, support, tracking page.

---

## 5. Catalogue

### Product fields

`product_id`, `sku`, `slug`, `name`, `short_name`, `subject`, `category`,
`stage` (Prelims / Mains / Both), `language`, `edition`, `description`,
`short_description`, `page_count`, `weight`, `length`, `width`, `height`,
`binding_type`, `printing_type`, `cover_image`, `gallery_images`, `sample_pages`,
`video_url`, `mrp`, `selling_price`, `cost_price`, `inventory_count`,
`low_stock_threshold`, `allow_backorder`, `max_quantity_per_order`, `is_featured`,
`is_bestseller`, `is_active`, `is_preorder`, `dispatch_days`, `estimated_delivery_days`,
tax fields (HSN, rate — configurable per product), `seo_title`, `seo_description`,
`seo_image`, `created_at`, `updated_at`.

Must support individual subjects, bundles, limited editions, year editions, language
variants, format variants, future optional subjects, future monthly current affairs.

### Initial subjects

Polity · Modern History · Ancient History · Geography · Economy · Environment · Ethics ·
Science & Technology · Internal Security · International Relations · Society ·
Current Affairs compilations.

Future: optional subject notes (PubAd, PSIR, Sociology), essay notes, ethics case studies,
answer-writing workbooks, PYQ compilations, prelims/mains revision books, NCERT revision
notes, monthly and yearly current affairs, maps/atlas, test-series workbooks, strategy books.

### Bundles

2–20 products. Bundle-specific MRP, discount, selling price, inventory behaviour, campaign
period, landing page, coupon compatibility, minimum quantity, marketing badge.
Availability computed from component stock.

Fixed bundles (GS Complete, Polity + Governance, History, Prelims Complete, Mains Complete,
Current Affairs, Optional) and dynamic campaign bundles (UPSC Starter Pack, Prelims Revision
Pack, festival offers, New Aspirant Bundle).

### Inventory

Physical, reserved, available, incoming. Low-stock threshold. States: In Stock, Low Stock,
Out of Stock, Coming Soon, Preorder, Temporarily Unavailable. No overselling unless
backorder/preorder is explicitly enabled.

Order confirmed → reserve. Cancelled → release. Shipped → deduct finalised.
Reservation uses `FOR UPDATE SKIP LOCKED` in the style of the existing claim RPCs.

---

## 6. Sample pages — protecting the asset

The previews are the product. Handled deliberately:

- 4–6 **non-contiguous** pages per product
- watermark **baked into pixels** at upload, never a CSS overlay
- derivatives generated at upload; originals never URL-exposed
- served from a **private R2 prefix** through a store route — never the world-readable
  `media/` prefix
- resolution capped below print usefulness
- hotlink protection; download friction

State plainly what is and is not actually preventable. The goal is persuasion without
sufficiency.

---

## 7. Promotions

Admin-configurable. **No hard-coded discounts.**

Types: percentage, flat, bundle, minimum cart value, maximum discount, free shipping,
first-order, campaign, student-only, course-student, coupon codes, automatic promotions,
limited-time, scheduled.

Campaign properties: start time, end time, usage limit, usage per customer, applicable SKUs,
excluded SKUs, minimum subtotal, customer segment, stackable / non-stackable.

(Prepaid-discount promotions are moot — all orders are prepaid. A blanket prepaid incentive
may simply be reflected in pricing.)

**Evaluation order and stacking resolution must be deterministic and documented.** Ambiguous
stacking is where discount abuse and support tickets originate. All evaluation server-side.
A coupon cannot be applied twice, cannot exceed max discount, cannot survive expiry mid-checkout.

---

## 8. Cart and checkout

### Cart

Product image, name, variant, quantity, price, savings, remove, save for later, recommended
bundles, free-shipping progress, promotion display, coupon application, subtotal, shipping
estimate, total. Persistent: server-side for logged-in users, safe temporary storage for
guests, surviving refresh. Defined merge behaviour when a guest later logs in.

### Checkout

Guest checkout required. No account creation before ordering. Pre-fill from an existing
Naman IAS session where present.

Required: full name, mobile, address line 1, PIN code, city, state.
Optional: email, apartment/landmark, delivery instructions.

PIN code auto-resolves city, state, serviceability and a **concrete delivery date** —
not a vague range. This is the highest-value trust element in the funnel.

---

## 9. Order lifecycle

### Internal states

`PAYMENT_PENDING` · `PAYMENT_CONFIRMED` · `ORDER_CONFIRMED` · `PROCESSING` · `PRINTING` ·
`QUALITY_CHECK` · `READY_TO_PACK` · `PACKED` · `READY_FOR_PICKUP` · `PICKUP_SCHEDULED` ·
`PICKED_UP` · `IN_TRANSIT` · `OUT_FOR_DELIVERY` · `DELIVERED` · `DELIVERY_FAILED` ·
`REATTEMPT_REQUESTED` · `RTO_INITIATED` · `RTO_IN_TRANSIT` · `RTO_DELIVERED` ·
`CANCEL_REQUESTED` · `CANCELLED` · `RETURN_REQUESTED` · `RETURN_APPROVED` ·
`RETURN_PICKUP_SCHEDULED` · `RETURN_IN_TRANSIT` · `RETURN_RECEIVED` · `REFUND_PENDING` ·
`REFUNDED` · `PARTIALLY_REFUNDED`

### Customer-facing projection

Order Confirmed → Preparing Your Notes → Packed → Shipped → Out for Delivery → Delivered

Internal complexity is never exposed. Courier jargon is translated. The mapping is an
explicit table; illegal transitions are enumerated; manual overrides are permissioned
and audited.

---

## 10. Shipping

A `ShippingProvider` interface, with `ShiprocketProvider` as the first implementation.
Never hard-coded to Shiprocket — Delhivery, Blue Dart, XpressBees, DTDC, India Post and
other aggregators must be pluggable without redesign.

Methods: `checkServiceability`, `getRates`, `createShipment`, `assignCourier`,
`generateAWB`, `generateLabel`, `schedulePickup`, `trackShipment`, `cancelShipment`,
`createReturn`, `getManifest`, `handleWebhook`.

Stored per shipment: provider, shipment ID, courier ID and name, AWB, tracking URL,
pickup scheduled/actual, expected delivery, delivery date, shipping charge, weight,
dimensions, zone, status, event history, last synced, provider payload.

### Failure path is designed first

If the provider API fails, the paid order must persist, be retriable with backoff, and
surface in admin as **Shipment Creation Failed** with a **Retry Shipment** action.
A customer must never see a payment vanish because a courier API was down.

Webhook ingestion: signature-verified, idempotent, logged, retry-safe. Reconciliation when
the courier's state disagrees with ours. No manual status updates except a permissioned
admin override.

### Tracking

Without login, via order number + phone, or a secure tracking token. Shows order number,
date, items, address, courier, AWB, expected delivery, timeline, last update, support
contact, invoice.

---

## 11. Notifications

**There is no WhatsApp API in this codebase** — only deep links. Server-initiated WhatsApp
order updates are not currently possible. Proactive updates are **SMS**, which requires new
DLT-approved transactional templates.

Templates needed: order confirmed, shipped + AWB, out for delivery (optional), delivered,
delivery failed / action required.

DLT approval is a multi-week external dependency. **Submit in week 1 of Phase 1**, not at
the end. Transactional templates are not promo-throttled; quiet hours apply to promotional
messages only.

Messages carry customer name, order number, status, tracking CTA, support link.
Do not send on every courier scan.

Internal Telegram alerts: new order, shipment creation failed, oversold, low stock.
New alert keys only — no change to event types or dispatch cadence.

---

## 12. Admin

Integrated into the existing admin shell as a Store group.

**Security note:** `/admin/*` is protected by a client-side shell fetch plus per-route API
guards, not middleware. Store admin pages render customer addresses and phone numbers and
must therefore call `requirePermission()` **server-side in the page itself**.

### Dashboard

Today's orders, revenue, units, AOV, pending fulfilment, ready for pickup, in transit,
delivered, delayed, failed delivery, RTO, returns, refunds, low stock.
(No COD/prepaid split — everything is prepaid.)

### Order list

Columns: order number, customer, phone, date, items, value, payment status, fulfilment
status, shipping status, courier, AWB, ETA, exception, actions.
Filters: date, status, payment, courier, product, subject, PIN, city, delayed, RTO, return.
Search: order number, name, phone, AWB.

### Order detail

Customer, address, products, quantities, value, discounts, payment, invoice, internal and
customer-facing status, inventory, packing, shipping, courier, AWB, tracking timeline,
notifications sent, support history, return and refund history, internal notes.

Actions: mark QC complete, mark packed, create shipment, generate AWB, print label,
schedule pickup, cancel shipment, resend tracking, contact customer, add note, request
reattempt, start return, issue refund.

### Fulfilment queue

Buckets: New Orders · Needs Printing · Ready for QC · Ready to Pack · Packed ·
Ready for Pickup · Picked Up · Exceptions.

Bulk actions: select 20 → generate labels → print packing slips → mark packed →
schedule pickup. Keyboard-driven. Designed for one trained, non-technical operator
working fast on desktop.

### Exception detection

Flag automatically, sorted by urgency: not picked up after X hours, no courier scan after
X hours, ETA missed, multiple failed attempts, address issue, RTO initiated, stuck shipment.
Staff must never have to inspect hundreds of orders manually.

### Audit

Every order cancellation, refund, price change, inventory adjustment, status override,
coupon creation, shipment cancellation and return approval records admin, action,
timestamp, before, after and reason.

---

## 13. Returns and refunds

Configurable policy. Supported cases: wrong item, damaged in shipping, missing item, major
print defect, duplicate order, customer cancellation before shipment. Change-of-mind after
reading is a business policy decision, configurable.

Supports: return request, reason, photo/video evidence, approval or rejection, replacement,
return pickup, refund, partial refund. Store credit is a future option.

---

## 14. Customer account

For logged-in customers: My Orders, Track Order, Invoices, Reorder, saved addresses, saved
cart, review a purchase, support request. Wishlist is a future option.
Digital bonuses linked to product where applicable (Phase 4).

---

## 15. Digital ecosystem — Phase 4 only

QR codes in printed notes linking to chapter quizzes, updated current affairs, errata,
bonus videos, revision checklists, practice questions and portal resources.

**This is the only phase that touches entitlements, and even then it does not modify
`gateQuiz`, `learnerCourseIds` or `quizUnlockCourseIds`.** It must be designed as a
separate, additive entitlement source that the existing gate reads. Proposed and approved
before implementation.

Course upsell happens after delivery, through lifecycle marketing — **never during
checkout**. Protect the initial notes conversion.

---

## 16. Analytics

Events: `notes_store_view`, `category_view`, `product_view`, `sample_preview`, `search`,
`add_to_cart`, `remove_from_cart`, `begin_checkout`, `address_completed`, `coupon_applied`,
`payment_selected`, `purchase`, `payment_failed`, `tracking_view`, `reorder`,
`review_submitted`, `refund`, `return`.

Captured: product ID, SKU, subject, price, discount, cart value, campaign, traffic source,
device, logged-in vs guest. No PII in event payloads.

Attribution reuses the existing first-touch `nsa_attr` cookie and merge logic — already live
and already frozen at first touch. Campaign source must survive to the order record so
Instagram spend can be attributed to revenue.

Metrics: gross and net sales, orders, units, AOV, conversion rate, cart and checkout
abandonment, best-selling subjects and bundles, discount and coupon performance, traffic
source, shipping cost per order, RTO %, return %, refund %, delivery success %, average
dispatch and delivery time, damage %, contribution margin where cost data exists.

**Before writing store events into the shared `analytics_events` table, verify that no
revenue query sums amounts from it.** If any does, the store gets its own events table.

---

## 17. Tax

Printed books carry a specific GST treatment in India. HSN 4901 (printed books, nil-rated)
versus 4820 (registers, notebooks and similar — taxable) is a genuine classification question
for bound photocopied or printed notes, worth up to 12% of pricing.

**Do not hard-code a rate.** Tax is configurable per product (HSN + rate). The invoice format
follows the CA's position. Questions for the CA must be produced as a forwardable list before
any invoice is issued.

---

## 18. Performance, motion, mobile

### Performance

Fast initial load, optimised responsive images, lazy loading, minimal JS, server rendering
where appropriate, no heavy animation libraries, no unnecessary client components, Core Web
Vitals preserved. Animation must never make the store feel slow.

### Caching

Catalogue and product pages ISR with a store cache tag, revalidated on admin catalogue writes.
Cart, checkout, orders, tracking and all admin are `no-store`, always.

**Given the prior stale-shell bug:** a cached product page must never serve a stale cart count
or stale logged-in state. Session- and cart-derived values are fetched client-side after mount
with `cache: "no-store"`, following the existing session-state pattern. Nothing session-derived
is ever server-rendered into a cached shell.

### Motion

Subtle and premium: card lift, image zoom, button feedback, cart animation, page transitions,
filter transitions, modal transitions, progress animation, checkout success, tracking progression.

Not: parallax, WebGL, glow, overdone gradients, slow entrances, interaction-blocking animation.
Think premium product website, not gaming landing page. `prefers-reduced-motion` honoured.

### Mobile

Most traffic is Instagram and YouTube mobile. Mobile-first for browse, product, cart, checkout,
payment and tracking. Sticky bottom Buy Now / Add to Cart on product. Sticky checkout CTA in
cart. Minimal scrolling, large tap targets, numeric keyboards for phone and PIN, address
autofill, UPI-friendly handoff. Admin may remain desktop-oriented.

---

## 19. SEO

Every product page indexable. SEO title, meta description, canonical, OpenGraph, and
structured data: Product, Offer, Breadcrumb, and Review where compliant. Inline JSON-LD
following the existing page pattern. Sitemap inclusion. No keyword stuffing.

Intent: UPSC handwritten notes · UPSC polity notes · UPSC geography notes · UPSC mains notes ·
UPSC prelims notes · Naman Sir notes · UPSC notes Chandigarh · UPSC notes delivery India.

---

## 20. Routes

**Public:** `/notes` · `/notes/all` · `/notes/[subject]` (polity, modern-history,
ancient-history, geography, economy, environment, ethics, current-affairs, optionals) ·
`/notes/bundles` · `/notes/products/[slug]` · `/notes/cart` · `/notes/checkout` ·
`/notes/order/[orderId]` · `/notes/track` · `/notes/faqs`

**Account:** `/account/orders`

**Admin:** `/admin/notes` · `/admin/notes/products` · `/admin/notes/orders` ·
`/admin/notes/inventory` · `/admin/notes/promotions` · `/admin/notes/shipping` ·
`/admin/notes/customers` · `/admin/notes/analytics`

**Nav:** Notes · Bundles · Best Sellers · Current Affairs · Track Order · FAQs

---

## 21. Landing page

Communicates in seconds: what it is, why buy, what's available, how it arrives.

Sections: hero · subject categories · best sellers · Complete GS bundle · why these notes ·
sample page previews · bundle savings · social proof · shipping and packaging reassurance ·
how it works (Choose → Order → We print & pack → Courier pickup → Delivered) · student
reviews · FAQ · final CTA.

Hero: *Naman Sir's Handwritten UPSC Notes — Delivered to Your Doorstep.*
Sub: premium printed hard copies, exam-focused, revision-ready, delivered pan-India from
Chandigarh. Primary CTA **Shop Notes**, secondary **Explore Bundles**.

Product visuals should eventually include real photography: front cover, back cover, spine,
stack thickness, open pages, handwritten pages, diagram example, highlighted page, packaging,
bundle arrangement, desk lifestyle. Mockups alone reduce trust.

---

## 22. Edge cases the system must handle

Payment succeeded but browser closed · delayed webhook · duplicate webhook · duplicate order
submit · out of stock during checkout · coupon expired during checkout · courier unavailable ·
PIN not serviceable · shipment creation failed · AWB generation failed · pickup failed ·
shipping API down · wrong address entered · cancellation before shipping · cancellation after
pickup · delivery failed · RTO · damaged order · lost parcel · partial shipment (future) ·
refund failed · accidental admin update · guest purchase without login.

---

## 23. Feature flags

Via the existing `app_feature_flags` table: store master kill switch, coupons, free shipping,
reviews, Shiprocket integration, SMS updates, QR digital bonuses, preorders.
One flag turns the entire store dark, leaving the portal byte-identical.

---

## 24. Phases and gates

**Phase 1 — Isolation + core commerce.** Guardrails first, then homepage, catalogue, product
pages, cart, guest checkout, Eazypay with server-side verification and quote lock, order
creation, order number, confirmation, inventory, PIN checker with a concrete delivery date,
tracking page, confirmation SMS, minimum admin queue with manual fulfilment, kill switch.
Revenue-generating at the end even with shipping fully manual.

**Phase 2 — Shipping.** Provider interface, Shiprocket, rates, AWB, labels, pickup, tracking
webhooks, customer tracking, failure and retry path, reconciliation.

**Phase 3 — Operations.** Fulfilment queue, returns, refunds, RTO, exception detection, bulk
label printing, admin analytics.

**Phase 4 — Growth.** Promotions engine, campaigns, verified reviews, recommendations, QR
digital entitlements (approval required), lifecycle messaging, advanced analytics.

Each phase is gated: deployed, verified against explicit acceptance evidence, and approved
before the next begins.

---

## 25. Launch-ready definition

**A student can:** browse notes · view a product · preview sample pages · choose a variant ·
add to cart · apply an eligible discount · check out as a guest · pay · receive an order
number · see confirmation · track the order · receive shipping updates · see a delivery ETA ·
download an invoice · contact support.

**Admin can:** create and edit products · update inventory · create bundles · create discounts ·
see orders and payments · prepare and mark packed · create a courier shipment · generate an
AWB · print a label · schedule pickup · see tracking · see delayed shipments · handle
cancellation, replacement, return and refund · search and export orders.

**The system automatically:** verifies payment · generates the order number · reserves
inventory · syncs shipments · processes shipping webhooks · updates customer tracking ·
logs every action.

The customer should never have to wonder: did my payment work, did they receive my order,
when will they ship, which courier has it, where is the package, what if it's damaged, how do
I contact someone. The system answers all of these proactively.

It should not feel like an academy added a shopping page. It should feel like Naman IAS built
a premium UPSC preparation commerce platform.

---

# Phase 0 rulings — 2026-09-16

Decisions taken after the Phase 0 reconciliation. These are final and override any
contrary reading of the sections above.

## Payments — Eazypay on the shared return URL

ICICI will not issue a second return URL or a separate SubMerchantId. The store therefore
uses merchant `343526`, `paymode=9` and the **same return URL as courses**. This is safe
because isolation is structural, not conventional:

- **Reference namespace `NIASN-N-` is primary.** Provably collision-free: the only
  `reference_no` first segments across all 2,429 production payment rows are `NAMAN`,
  `OFF`, `LEGACY` and `SAARTHI`. The store callback route rejects any reference not
  matching `^NIASN-N-`.
- **The callback is advisory only.** `applyCallbackAdvisory()` is UPDATE-only and never
  inserts, so a misrouted store callback arriving at the course endpoint updates zero
  rows. Terminal truth comes from `EazyPGVerify`, polled by cron.
- **Separate Verify polling.** The store runs its own cron over its own references with
  its own status enum and its own copy of the Verify status mapping — copied, not
  imported. The course cron (`reverifyPayments`) selects from `payments` and filters
  `item_type in ('webinar','course')`; it can never see a store reference on two
  independent grounds (wrong table, and an `item_type` the check constraint forbids).
- **No store row ever enters `payments`.** Enforced by the `payments.item_type` check
  constraint restricting values to `('course','webinar','plan')`.
- A store reference reaching the course path is a no-op **and alerts** — logged plus a
  Telegram alert. Silent misrouting is the failure that takes weeks to notice.
- SubMerchantId `21` is attempted as free extra signal (it is a per-request parameter and
  sits inside the signed response payload). If ICICI rejects it, the store falls back to
  `11`. It blocks nothing.
- Reuse from `lib/eazypay.ts` is limited to the pure exported `encrypt()` and
  `verifyResponseSignature()`. The store has its own URL builder at
  `lib/store/payments/eazypay.ts`. `lib/eazypay.ts` is never modified.
- An order is never marked paid from a frontend response or from the callback alone.
- Quote lock: a priced quote (items, prices, discounts, shipping, tax, total) is frozen at
  checkout with a short TTL. Capture validates against the quote, never the cart.
- Order numbers: `NIAS-N-<year>-<6 digits>` from a Postgres sequence + `lpad` function in
  the style of `next_receipt_no()`. **Continuous from 1001; no per-year reset** — a
  per-year counter row serialises writes and makes support ambiguous, while the embedded
  year still says when the order was placed.

## Rulings on §24/§25 and Phase 1 scope

- **§25 "Launch-ready" is the Phase 4 definition**, not Phase 1. Coupons, bundles,
  invoices, returns and refunds remain in their stated phases.
- **Landing page ships without reviews or social proof in Phase 1.** Zero delivered orders
  means nothing legitimate to render and §2.2 forbids inventing it. That slot carries
  faculty credentials, sample-page quality, packaging/shipping reassurance and the
  delivery-date promise.
- **Customer-facing projection drops `Packed`:** Order Confirmed → Preparing Your Notes →
  Shipped (only once an AWB exists) → Out for Delivery → Delivered. All 29 internal states
  are retained.
- **Out of Phase 1:** `/account/orders`, `/notes/all`, search, save-for-later,
  free-shipping progress, cart bundle recommendations, preorder and backorder. The schema
  may carry `allow_backorder` and `is_preorder`, flags off and untested.
- **Photography** trimmed to 3–4 real images per SKU for launch.
- **Store nav label is "CA Compilations."** `/notes/current-affairs` stays canonically
  separate from the existing `/current-affairs`, with deliberate cross-links, so the
  store never cannibalises pages the academy already ranks for.
- **Delivery date carries a +2 day buffer in Phase 1**, computed from our own zone table
  plus `dispatch_days`. Under-promise: a missed date in launch week is a trust event.
- **Print-on-demand semantics confirmed:** reserve on confirm, deduct on ship, `PRINTING`
  is a real queue state.
- `sharp` is approved for the upload path only — resize below print usefulness,
  `composite()` the watermark into pixels, strip EXIF, re-encode. Never on the request path.
- Pre-existing seeded demo students in production are left untouched.
- Razorpay is dead and stays untouched: zero `access_logs` rows from either success path
  all-time, zero `payments` rows carrying `razorpay_payment_id`, the only five students
  with one are `pay_demo000X` seed rows, and no `RAZORPAY_*` variable exists in any
  Vercel environment, so `verifyRazorpaySignature()` returns false and every request 400s
  before reaching a student write.

## Standing boundary

Never modified: `enrollmentFeeStateFromEnrollment` · fee-state / carry-forward ·
`lectureAccessForCourse` · `clearGrantOverrideOnFullyPaid` · `ee7a45f1` · `lib/eazypay.ts` ·
the course payment flow, its Verify cron and the 2s poll · `gateQuiz` / `learnerCourseIds` /
`quizUnlockCourseIds` · the legacy Razorpay webhook · Telegram event types and dispatch `*/2` ·
approved DLT templates and quiet hours · ISR commits and `PublicNav` session hydration ·
`LecturePlayer` and progress saves · `enrollStudentInCourse` · Simran · Kashish.

The single authorised exception is an additive dispatcher shim at the top of the existing
Eazypay callback handler, under the conditions recorded in the build mandate.

Store code never calls `finalizeCoursePaymentByReference`, `runPaidTerminalSideEffects`,
`confirmOnce`, `enrollStudentInCourse`, `ensureStudentForCustomer`, `ensureBuyerRow` or any
fee-state function; never writes an entitlement; never revalidates a course or quiz cache tag.

Guest checkout writes to no identity table, ever. The buyer↔customer link is derived at read
time by phone and never stored.

No COD at any phase — not built, not flagged, not in the schema. Serviceability answers
deliverability and ETA only.
