# Anti-patterns

## Design

- Undefined CSS variables (`--ca-navy` without alias) — colors silently break
- Cream/#terracotta “AI default” marketing skins unrelated to Academy navy/gold
- Purple-on-white SaaS gradients as brand
- Fake urgency (“14 viewing”, invented stock) — forbidden by Notes spec §2.2
- Nested cards with competing shadows
- Giant glassmorphism / glow on every surface

## Engineering

- Reading `cookies()` or Postgres in `app/(site)/layout.tsx` (breaks ISR — SEV1)
- Client-trusted prices/totals/coupons
- Writing Notes money into `payments` / creating `students`/`buyers` on guest checkout
- Importing `dataProvider` / `paymentOutcome` / entitlements from `lib/store/**`
- Marking orders paid from callback alone (Verify is sole terminal for store)
- Second payment gateway or second Eazypay return URL
- COD paths

## Process

- Redesigning before reading gold standards
- Claiming “done” without mobile + error-path checks
- Expanding into Phase 4 Notes features (coupons, reviews, Shiprocket) when Phase 1 isolation/commerce is unfinished
