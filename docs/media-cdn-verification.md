# Media CDN verification log

## Status as of agent run (2026-10-13)

| Check | Result |
|-------|--------|
| Worker code + wrangler config in repo | READY |
| Wrangler authenticated in agent VM | NO — needs `npx wrangler login` |
| `media.namanias.com` DNS | Points at **Vercel** A records (`DEPLOYMENT_NOT_FOUND`) — not Cloudflare yet |
| Apex NS | `ns1/ns2.vercel-dns.com` — Custom Domain requires Cloudflare zone |
| Vercel `NEXT_PUBLIC_MEDIA_CDN_BASE` | UNSET in production |
| Live teaching MP4 host today | `www.namanias.com/media/...` via Vercel |

**ROOT CAUSE FIXED:** PARTIAL (engineering complete; production cutover blocked on Cloudflare auth + DNS + env)

**PRIVATE R2 DATA EXPOSED:** NO (Worker allowlists `media/` only; bucket not made public)

Follow `docs/media-cdn-cutover.md` then paste curl results below.

## After cutover — paste results

```
# full GET
curl -sI "https://media.namanias.com/media/store/videos/naman-sir-teaches-01/full.mp4"

# Range
curl -sI -H "Range: bytes=0-1048575" \
  "https://media.namanias.com/media/store/videos/naman-sir-teaches-01/full.mp4"

# private must 404
curl -sI "https://media.namanias.com/processed/probe"
curl -sI "https://media.namanias.com/store-private/probe"

# app emits CDN URLs
curl -sL "https://www.namanias.com/notes" | grep -o 'https://media.namanias.com[^"]*' | head
```

| Signal | Pass criteria |
|--------|----------------|
| Hostname | `media.namanias.com` |
| Edge | `cf-ray` present; not `x-matched-path: /media/[...path]` for video bytes |
| Range | HTTP 206 + `Content-Range` + `Accept-Ranges: bytes` |
| Type | `video/mp4` / `application/pdf` / `image/webp` as appropriate |
| Cache | `Cache-Control: public, max-age=31536000, immutable` (or object metadata) |
| Private | 404 for non-`media/` paths |
| App HTML | Teaching `src` uses `https://media.namanias.com/...` |
| Legacy | `www.../media/...` → 308 → media host |
| FOT | Daily Fast Origin Transfer collapses within 24–48h |
