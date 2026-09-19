# Notes Store — decision log

Dated accepted decisions. Do not silently reverse.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09 | Same Next.js app/domain/deploy | One brand, one ops surface |
| 2026-09 | ICICI Eazypay only; same merchant + registered return URL | ICICI constraint; proven Academy path |
| 2026-09 | No COD ever | Trust + ops + payment truth |
| 2026-09 | No Razorpay for store | Avoid dual money domains |
| 2026-09 | Separate `store_*` money domain | Protect Academy revenue/dashboard |
| 2026-09 | Payment refs `NIASN-N-`; orders `NIAS-N-` | Collision-free vs production prefixes |
| 2026-09 | Guest checkout creates no Academy identity | Spec isolation |
| 2026-09 | Import/table CI guardrail | Structural isolation |
| 2026-09 | Feature flag off by default | Safe dark launch |
| 2026-09 | Manual shipping Phase 1 | No fake Shiprocket |
| 2026-09 | Reviews deferred until verified buyers | No fake social proof |
| 2026-09 | CA Compilations naming per brand | Spec content |
| 2026-09 | Packed internal-only until AWB | Honest customer tracking |
| 2026-09 | +2 day delivery buffer Phase 1 | Conservative promise |
| 2026-09 | Print-on-demand inventory semantics | Reserve on checkout; hold on capture |
| 2026-09 | Private watermarked sample derivatives | Protect content |
| 2026-09 | Callback advisory; Verify terminal | Replay-safe money |
| 2026-09 | Hash-only tracking tokens + cookie capability | Enumeration / leak resistance |
| 2026-09-19 | **Real Eazypay transaction deferred by owner** | Explicit; do not re-ask routinely |
| 2026-09-19 | Handoff docs under `docs/notes-store/` | Durable continuity across machines |

Canonical product requirements remain in `docs/notes-store-spec.md`.
