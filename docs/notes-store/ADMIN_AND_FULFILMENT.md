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

Exact permission keys live in `lib/permissions.ts` / `requirePermission` call sites — verify before changing RBAC.

## Operator workflow (Phase 1)

1. Paid order appears in queue with **customer, address, line items, amount, payment status**.  
2. Advance through internal statuses (printing/QC/packing as implemented).  
3. Enter courier + AWB → ship endpoint creates/updates `store_shipments`.  
4. Customer sees shipped only once AWB exists.

## Limitations

- Manual shipping only — no Shiprocket.  
- No automated DLT on ship until templates approved + `notes_store_sms` on.  
- Do not build ERP complexity; keep queue scannable on laptop + phone.
