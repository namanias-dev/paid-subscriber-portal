# Notes Store — frontend implementation

## Routes

| Path | File | Cache | Notes |
|------|------|-------|-------|
| `/notes` | `app/(site)/notes/page.tsx` | ISR via catalogue | Home |
| `/notes/[subject]` | `app/(site)/notes/[subject]/page.tsx` | ISR | Category |
| `/notes/products/[slug]` | `app/(site)/notes/products/[slug]/page.tsx` | ISR | PDP; sticky CTA patterns |
| `/notes/cart` | `app/(site)/notes/cart/page.tsx` | no-store | |
| `/notes/checkout` | `app/(site)/notes/checkout/page.tsx` | no-store | Guest |
| `/notes/order/[orderNumber]` | `app/(site)/notes/order/[orderNumber]/page.tsx` | no-store | Cookie or `?t=`; noindex |
| `/notes/track` | `app/(site)/notes/track/page.tsx` | no-store | Phone proof; noindex |
| Layout | `app/(site)/notes/layout.tsx` | — | Kill switch + `StoreSubnav` |

## Components

| File | Role | Client? |
|------|------|---------|
| `ProductCard.tsx` | Card: name, price, image, CTA | mostly server-friendly |
| `ProductDescription.tsx` | PDP long description (`description_md`) markdown render | server (no client JS; react-markdown, no raw HTML) |
| `AddToCartButton.tsx` | Add / Buy now | client |
| `CartClient.tsx` | Qty / remove / empty | client |
| `CheckoutForm.tsx` | Address + pay | client |
| `OrderStatus.tsx` | Stages + Verify poll ~90s | client |
| `TrackForm.tsx` | Lookup | client |
| `PinChecker.tsx` | PIN widget | client |
| `StoreSubnav.tsx` | Sticky subnav | client bits |
| `CartBadge.tsx` | Count hydrate | client |
| `admin/OrderQueue.tsx` | Fulfilment UI | client |
| `admin/ProductAdmin.tsx` | Catalogue CRUD | client |
| `admin/PrintButton.tsx` | Print | client |

## States to preserve

- Empty cart, sold-out CTA disabled, max qty clamp, PIN unserviceable, checkout errors, confirming payment, calm pending after ~90s, track miss (non-enumerable).

## Product detail content (PDP)

The PDP answers the product-critic checklist from catalogue data: name, physical
copy, **subject** + **stage** chips (`stageLabel()` maps Prelims/Mains/Both to a
phrase), edition · pages · language · binding meta line, price, sample pages, and
the full **`description_md`** rendered via `ProductDescription` ("About these
notes"). Structured data: `Product` + `Offer` (with page URL) **and**
`BreadcrumbList` JSON-LD (Notes → category → product), matching the sibling
public pages (quizzes/resources/current-affairs). SITE_URL comes from
`@/lib/config` (not a guard-forbidden module).

## Design reuse

Compose toward Academy gold standards (`CourseCard`, `CaPageHeader`, navy/gold tokens). See `DESIGN_AND_MOTION.md`.

## Known limitations

- Test product may lack cover/sample media.  
- Bundles/coupons UI not Phase 1 complete.  
- No Playwright; visual QA needs authenticated preview or local.
