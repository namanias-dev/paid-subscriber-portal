# Page patterns

## Public marketing page

1. Optional dark hero (`CaPageHeader` or custom `ca-dark` band): eyebrow → H1 → one supporting line → 1–2 CTAs.
2. Light body on slate/surface; sections with one purpose each.
3. `container-wide` horizontal rhythm; generous `mt-12`–`mt-16` between sections.
4. FAQ as `<details>` or equivalent — no fake review widgets without verified data.

## Catalogue / listing

- Filter chips (`.ca-filter`) when taxonomy matters.
- Responsive grid: `grid-cols-1 sm:2 lg:3|4`.
- Cards must answer: what, for whom, price, availability.

## Product detail (Notes / courses)

- Media left / buy box right on `lg`; sticky/fixed buy bar on mobile.
- Server-rendered price; never trust client totals.
- Samples/previews via approved media routes only.

## Checkout

- Short form, India address (PIN → city/state assist).
- Clear total, shipping promise, prepaid-only messaging.
- Full-page gateway redirect; never mark paid in the browser.

## Admin queue

- Dense table OK; include identity + destination + money + status + next action.
- Destructive actions need confirmation; shipping needs AWB before customer sees "Shipped".

## ISR vs dynamic

- Product/listing: ISR (`revalidate`) with **no** session-derived HTML.
- Cart/checkout/order/track/admin: `force-dynamic` + `Cache-Control: no-store`.
- Cart badge hydrates client-side (`CartBadge`) so ISR pages stay clean.
