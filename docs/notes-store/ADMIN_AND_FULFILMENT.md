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
| POST | `/api/admin/notes/orders/[id]/ship` | courier + AWB |
| GET/POST/PATCH | `/api/admin/notes/products` | `store_manage_catalogue` |
| GET/POST/PATCH/DELETE | `/api/admin/notes/media` | `store_manage_catalogue` |

Exact permission keys live in `lib/permissions.ts` / `requirePermission` call sites — verify before changing RBAC.

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
4. Customer sees shipped only once AWB exists.

## Order management

`/admin/notes` supports status buckets (New / Preparing / Packed / Shipped /
Delivered / Problem / Cancelled), free-text search (order no, name, phone, email,
AWB), one-tap **Copy address / Copy phone / Copy full shipping block** for the
courier portal, inline advance + courier/AWB ship, and an internal-note /
**exception** recorder (damaged, wrong item, missing item, lost in transit,
duplicate order) that appends to `internal_notes` and the order audit trail — no
DB edits. No general returns are offered to customers; these are ops-only records.

## Limitations

- Manual shipping only — no Shiprocket.  
- No automated DLT on ship until templates approved + `notes_store_sms` on.  
- Do not build ERP complexity; keep queue scannable on laptop + phone.
