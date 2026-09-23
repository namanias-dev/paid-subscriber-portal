# Notes Store — admin and fulfilment

## Routes

| Path | File |
|------|------|
| `/admin/notes` | `app/admin/notes/page.tsx` — order queue |
| `/admin/notes/products` | `app/admin/notes/products/page.tsx` |
| `/admin/notes/pick-list` | `app/admin/notes/pick-list/page.tsx` |

All `force-dynamic` / no-store.

## APIs

| Method | Path | Permission (concept) |
|--------|------|----------------------|
| GET | `/api/admin/notes/orders` | store fulfilment |
| POST | `/api/admin/notes/orders/[id]/advance` | advance one step |
| POST | `/api/admin/notes/orders/[id]/ship` | courier + AWB already in hand. Does not buy a label. |
| POST | `/api/admin/notes/orders/[id]/rates` | live Shiprocket and Delhivery quotes. Read-only. |
| POST | `/api/notes/courier/events` | courier tracking webhook. Requires `x-api-key`. |
| GET/POST/PATCH | `/api/admin/notes/products` | `store_manage_catalogue` |
| GET/POST/PATCH/DELETE | `/api/admin/notes/media` | `store_manage_catalogue` |

Exact permission keys live in `lib/permissions.ts` / `requirePermission` call sites — verify before changing RBAC.

## Notes product management (subject-oriented)

`/admin/notes/products` is a **catalogue of cards** (subject, title, status LIVE/DRAFT/ARCHIVED,
price, availability + stock/demand, sample-page count, order count, cover warning) — no raw
table, SKU hidden under Advanced. "Manage notes" opens a dedicated editor at
`/admin/notes/products/[id]` (`ProductEditor`) with sections: Basic info · Full description
(markdown: description / how-to-use / prelims / mains / revision) · What's included · Who it's
for · Topics covered (repeatable lists) · Physical product · Pricing (₹, live discount) ·
Availability (mode cards; stock only for Ready Stock; on-demand shows live paid demand) ·
Media & sample preview · Bundle contents (bundles) · Publishing. Sticky save bar with
Saved / Unsaved / Saving / Save failed and an unsaved-changes guard; "View as student" opens
the real PDP. Create via `POST /api/admin/notes/products` (auto SKU/slug), edit/lifecycle via
`PATCH /api/admin/notes/products/[id]`, safe delete via `DELETE` (blocked with a clear message
when order history exists → archive instead).

## Sample preview: images + PDF (Cloudflare R2)

Sample pages can be uploaded as images (JPG/PNG/WebP) or generated from a **PDF**: the original
PDF is stored under the private `store-private/sample-pdf/` prefix (never served), its page count
is read (mupdf, WASM — serverless-safe), the admin selects up to `MAX_SAMPLE_PAGES` (10), and the
selected pages are rasterized → watermarked/downscaled/EXIF-stripped → stored as WebP derivatives
reachable only via `/api/notes/sample/[id]`. Deleting a PDF-derived page keeps the shared source
until the last page referencing it is removed.

## Product media management (Cloudflare R2)

`components/notes/admin/MediaManager.tsx` (embedded per product row in the
catalogue admin) lets staff upload **product photos** and **sample pages**,
set the cover, and delete — no code or SQL. Backed by `lib/store/media/upload.ts`
+ `/api/admin/notes/media`, reusing the existing `lib/r2` client:

- **Sample pages** → `renderSamplePageDerivative` watermarks + downscales + strips
  EXIF; the untouched original is stored under the private `store-private/sample-originals/`
  prefix (never served/URL'd) and only the derivative (`store-private/sample-pages/`)
  is reachable, via `/api/notes/sample/[id]`. The DB constraint keeps sample media private.
- **Photos** → `renderProductPhoto` (no watermark) under the public `media/store/products/`
  prefix, served by the CDN; first photo auto-becomes the cover.
- Uploads are permission-gated (`store_manage_catalogue`), size-capped (12 MB) and
  type-checked (JPG/PNG/WebP). PDF sample ingestion is a documented follow-up (needs a rasteriser).

## Availability & preparation

Each product's `availability_mode` (Ready Stock / On Demand / Coming Soon / Unavailable)
is set in the catalogue admin. Ready Stock exposes the stock field; the other modes
disable it (no fake numbers). The **Preparation Queue** (`/admin/notes/preparation`)
shows, per subject, paid-unfulfilled demand vs ready stock and the additional copies to
prepare — bundles counted as their components.

## Operator workflow (Phase 1)

1. Paid order appears in queue with **customer, address, line items, amount, payment status**.  
2. Advance through internal statuses (printing/QC/packing as implemented).  
3. Enter courier + AWB → ship endpoint creates/updates `store_shipments`.  
4. Compare rates from the order card when pickup PIN and provider credentials are set. That button does not create a shipment.  
5. Customer sees Packed while the parcel is still at the academy. Shipped starts at pickup, then In Transit.

## Order management

`/admin/notes` supports status buckets (New / Preparing / Packed / Shipped /
Delivered / Problem / Cancelled), free-text search (order no, name, phone, email,
AWB), one-tap **Copy address / Copy phone / Copy full shipping block** for the
courier portal, inline advance + courier/AWB ship, and an internal-note /
**exception** recorder (damaged, wrong item, missing item, lost in transit,
duplicate order) that appends to `internal_notes` and the order audit trail — no
DB edits. No general returns are offered to customers; these are ops-only records.

## Limitations

- Staff still mark shipped by typing the courier and AWB.  
- The order card can compare live Delhivery and Shiprocket rates. Quotes do not create a label, AWB, or pickup.  
- `POST /api/notes/courier/events` applies tracking scans when `NOTES_STORE_COURIER_WEBHOOK_KEY` is set. Delivered does not move backwards.  
- No automated DLT on ship until templates approved + `notes_store_sms` on.  
- Do not build ERP complexity; keep queue scannable on laptop + phone.
