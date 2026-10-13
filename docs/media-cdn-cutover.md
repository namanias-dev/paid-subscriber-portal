# Public media CDN cutover — media.namanias.com

> **Interim production path (2026-10):** Until Wrangler has a `CLOUDFLARE_API_TOKEN`
> (Cloudflare MCP can list R2/Workers but cannot deploy scripts), the app
> `/media/*` route **302-redirects public keys to R2 signed GET URLs** so MP4
> bytes leave Vercel immediately (Browser → R2). HTML still uses stable
> `/media/…` (or CDN) srcs. When the Worker is live, set
> `CLOUDFLARE_R2_PUBLIC_BASE_URL` + `NEXT_PUBLIC_MEDIA_CDN_BASE` and redirects
> become 308 → CDN instead.

## Why this exists

Notes Store MP4/PDF/images were streaming through Vercel `/media/*` from private R2, driving Fast Origin Transfer. This Worker serves **only** `media/*` at the edge.

## Architecture

```
Browser → https://media.namanias.com/media/store/... 
       → Cloudflare Worker (allowlist media/*)
       → R2 binding (ranged get)
       → Browser
```

Private prefixes (`processed/`, `payment-proofs/`, `store-private/`, …) return **404**.

## Current DNS constraint

As of 2026-10-13:

- Apex NS: `ns1.vercel-dns.com` / `ns2.vercel-dns.com` (Vercel DNS)
- `media.namanias.com` already has Vercel A records → `DEPLOYMENT_NOT_FOUND`

Cloudflare **Custom Domains** require an **active Cloudflare zone** for `namanias.com`. You cannot attach `media.namanias.com` to a Worker while the hostname stays only on Vercel DNS.

---

## Manual actions (exact)

### A. Deploy the Worker (required)

1. Open a terminal in this repo.
2. Set the bucket name in `workers/public-media/wrangler.jsonc`:
   - Field: `r2_buckets[0].bucket_name`
   - Value: **exactly** the same string as Vercel Production env `CLOUDFLARE_R2_BUCKET_NAME`
   - Why: Worker must read the existing private bucket; do **not** enable bucket-wide public access.
3. Authenticate:
   - Command: `npx wrangler login`
   - Or set `CLOUDFLARE_API_TOKEN` with Account → Workers Scripts Edit + Account → Workers R2 Storage Edit.
4. Deploy:
   - Command: `npm run media:deploy`
   - Why: publishes `naman-public-media` and prints a `*.workers.dev` URL.
5. Smoke-test the workers.dev host (replace HOST):
   ```bash
   curl -sI "https://HOST/media/store/videos/naman-sir-teaches-01/poster.webp"
   curl -sI -H "Range: bytes=0-1048575" "https://HOST/media/store/videos/naman-sir-teaches-01/full.mp4"
   curl -sI "https://HOST/processed/anything"   # must be 404
   curl -sI "https://HOST/store-private/anything" # must be 404
   ```

### B. Attach media.namanias.com (required for branded CDN)

**B1 — Add zone to Cloudflare (one-time)**

1. Page: [Cloudflare Dashboard → Add a site](https://dash.cloudflare.com/?to=/:account/add-site)
2. Field: site name → `namanias.com`
3. Plan: Free is enough for this Worker hostname.
4. Cloudflare will show **replacement nameservers**.
5. Page: Vercel → Project `naman-ias` → Settings → Domains → DNS for `namanias.com`  
   **OR** your domain registrar NS settings if not using Vercel nameservers long-term.
6. Action: Point NS to the Cloudflare nameservers shown in step 4.
7. Why: Custom Domain `media.namanias.com` only works on a Cloudflare zone.

**While nameservers switch:** keep `www` / apex working by recreating DNS records Cloudflare imported (A/CNAME to Vercel). Use **DNS only** (grey cloud) for `www` and apex so HTML stays on Vercel. Orange-cloud only what you intend Cloudflare to proxy.

**B2 — Remove conflicting media records**

1. Page: Cloudflare → **DNS** → **Records** for `namanias.com`
2. Delete any existing `media` A/CNAME that still points at Vercel.
3. Why: Custom Domain creation fails if a conflicting CNAME/A exists.

**B3 — Bind Custom Domain to the Worker**

1. Page: Cloudflare → **Workers & Pages** → worker **`naman-public-media`**
2. Tab: **Settings** → **Domains & Routes** → **Add** → **Custom Domain**
3. Field: domain → `media.namanias.com`
4. Click **Add Custom Domain**
5. Why: issues cert + DNS so the Worker is the origin for that hostname.

(Alternatively uncomment the `routes` block in `wrangler.jsonc` and redeploy.)

### C. Set Vercel env + redeploy Next.js (required)

1. Page: Vercel → Project **naman-ias** → Settings → Environment Variables
2. Add / update:

| Key | Value | Environments | Why |
|-----|-------|--------------|-----|
| `CLOUDFLARE_R2_PUBLIC_BASE_URL` | `https://media.namanias.com` | Production (Preview optional) | Server `publicCdnUrl()` + `/media` 308 |
| `NEXT_PUBLIC_MEDIA_CDN_BASE` | `https://media.namanias.com` | Production (Preview optional) | Client teaching/PDF/image URLs (bake-time) |

3. Do **not** set Development to production CDN unless you intend local to hit prod media.
4. Preview: either omit CDN (falls back to preview `/media` proxy) **or** set the same CDN if preview may read prod R2 public media keys (keys are public-by-design under `media/`).
5. **Redeploy Production** after `NEXT_PUBLIC_*` change (Required — client bundle).

### D. Verify production

```bash
# Must be Cloudflare, not Vercel
curl -sI "https://media.namanias.com/media/store/videos/naman-sir-teaches-01/full.mp4" | egrep -i 'HTTP/|server:|cf-ray|content-type|accept-ranges|cache-control|content-length'

curl -sI -H "Range: bytes=0-1048575" \
  "https://media.namanias.com/media/store/videos/naman-sir-teaches-01/full.mp4" \
  | egrep -i 'HTTP/|content-range|accept-ranges|content-length|cf-cache-status'

# App should emit CDN URLs
curl -sL "https://www.namanias.com/notes" | grep -o 'https://media.namanias.com/media/store/videos/[^"]*' | head

# Legacy path should 308 off Vercel when env is set
curl -sI "https://www.namanias.com/media/store/videos/naman-sir-teaches-01/poster.webp" | egrep -i 'HTTP/|location:|x-matched'
```

Pass criteria:

- `server` / `cf-ray` show Cloudflare for media host
- Range → **206** + `Content-Range: bytes 0-1048575/…`
- `Accept-Ranges: bytes`
- HTML on `/notes` references `https://media.namanias.com/...`
- `/media/...` on www → **308** to media host
- `https://media.namanias.com/processed/...` → **404**

---

## Rollback

1. Remove / empty `NEXT_PUBLIC_MEDIA_CDN_BASE` and `CLOUDFLARE_R2_PUBLIC_BASE_URL` in Vercel → redeploy.  
2. App falls back to `/media` Vercel stream (previous behavior).  
3. Optionally disable Worker custom domain.

## Security checklist

- [ ] Bucket-wide R2 “Public bucket” / r2.dev public access is **OFF**
- [ ] Worker allowlists only `media/`
- [ ] Probe `processed/`, `store-private/`, `payment-proofs/` → 404 on media host
- [ ] Invoices still use signed URLs (unchanged)
