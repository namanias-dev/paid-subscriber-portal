# Meta Pixel + Conversions API — Handover Guide (Plain English)

*Written for a non-technical owner. Save this. If you're reading it a week later, start at Section 5 for what to do next.*

---

## 1. WHAT WAS BUILT — and why it matters

**The problem it solves:** When you run ads on Facebook/Instagram (Meta), you're paying to send people to your site. Today you can't reliably tell Meta *"this person you sent me actually paid for a webinar/course."* Without that, Meta can't learn which ads bring paying students, you can't see your true return on ad spend, and you can't retarget the people who almost bought.

**What was built:** A two-way tracking system that tells Meta what happens on your site, using **two channels at once** for accuracy:

- **The Pixel (browser side):** a small piece of Meta code that runs in the visitor's browser and reports what they did (viewed a page, registered, started a payment, paid).
- **The Conversions API / "CAPI" (server side):** your own server *also* reports the same events directly to Meta. This is more reliable because it isn't blocked by ad-blockers, browser privacy settings, or someone closing the tab too early.

**The clever bit — no double counting:** Both channels stamp each event with the **same ID number**. Meta sees the two reports, matches the IDs, and counts it as **one** event ("deduplication"). So you get the reliability of two channels without inflating your numbers.

**What it does for your business, in one line:** it lets Meta connect *"I paid to show this ad"* -> *"this person registered and paid you Rs.X"*, so you can measure and improve which ads actually make money.

**Privacy stance (important):** The system is built to send **no student personal information** (no names, phone numbers, or emails) to Meta right now. It only uses Meta's own anonymous browser cookies to match people. Sending hashed personal info is built but **switched OFF** (this is the "G1" switch, covered later). Nothing tracks a visitor until they click **"Accept all"** on your cookie consent banner.

---

## 2. WHAT'S IMPLEMENTED & WORKING RIGHT NOW

Four events are wired up. Here's each one in plain terms:

| Event | Triggered when a real visitor... | What it sends to Meta | Server-verified? | Browser-verified? |
|---|---|---|---|---|
| **PageView** | Opens any page (after accepting cookies) | "someone viewed a page" + anonymous Meta cookies | N/A (browser-only by design) | YES - Confirmed firing |
| **Lead** | Registers for a **free** webinar | "a lead happened", webinar name, value Rs.0 | YES - Confirmed (real code path fired) | NOT yet seen in a real browser |
| **InitiateCheckout** | Starts a **paid** webinar/course checkout | "checkout started", the amount, currency INR | YES - Confirmed (real code path fired, Rs.50 test) | NOT yet seen in a real browser |
| **Purchase** | **Completes payment** (the confirmed "PAID" moment) | "a purchase happened", the **real rupee amount**, INR | YES - Confirmed (fired from the trusted payment-verified point, correct Rs.50) | NOT yet seen in a real browser |

**Key strengths already proven:**
- **No student PII is sent.** Advanced matching (the "G1" switch) is **OFF**. Only Meta's anonymous cookies go across. Verified.
- **Purchase uses your real, reconciled money number** — it fires from the exact same trusted point in your code that marks a payment "PAID", so the amount Meta sees will always match your Finance number. It cannot invent or guess a value.
- **The dedup design is structurally guaranteed** — browser and server compute the identical event ID from the same code, so when both fire they *will* merge into one.

**The honest gap — this is NOT fully live-verified yet:**
- The **server side is proven** for all four events (they reached Meta's Test Events with correct values and no warnings).
- The **browser side is only proven for PageView.** For Lead, InitiateCheckout, and Purchase, the browser part has **never fired a real event yet**, because the automated test browser used is deliberately blocked by Meta's anti-bot protection from sending those events. This isn't a bug in your setup — a normal human browser will send them fine — but it means **the "one merged event" has never actually been watched happening even once.** That single check (a human clicking through once while watching Meta's Test Events screen) is the main thing standing between "built" and "trusted in production."
- **Nothing is deployed.** All of this lives on a code branch (`feat/meta-capi-attribution`) that has **not** been pushed to your live site. On your live site today, no Meta tracking is running.

---

## 3. WHAT YOU CAN DO FROM NOW ON

**Unlocked immediately once you deploy + do the one browser check:**
- **Run Meta ads with real conversion tracking** — Meta will know which clicks turned into registrations and payments.
- **Optimize ads for purchases, not just clicks** — you can tell Meta "find me more people like the ones who paid," which typically lowers your cost per enrollment over time.
- **Retargeting** — show ads to people who visited, registered, or started checkout but didn't pay ("you left something behind").
- **See which campaigns drive paid enrollments** — in your own admin portal's Attribution tab and in Meta's Ads Manager.
- **Measure revenue per campaign** — because Purchase carries the real rupee value.

**Needs a bit more setup (optional, later):**
- **ROAS (Return On Ad Spend) inside YOUR admin portal** — this needs you to connect your Meta **Ad Account ID** and an ads access token (two extra settings). Without it, your portal still shows registrations/payments/revenue per campaign; it just can't show the *cost* and *ROAS* columns until spend data is connected. (Meta's own Ads Manager will show ROAS regardless, since it already knows your spend.)
- **Higher match rates via "advanced matching" (G1)** — sending *hashed* (scrambled) phone/email improves how many conversions Meta can match to ad clicks. This is built but **OFF pending your explicit go-ahead** on data policy. More on this in Section 5.

---

## 4. WHAT CAN BE TRACKED, HOW, AND WHERE TO FIND IT

> Meta occasionally renames menus. If a name doesn't match exactly, look for the closest equivalent — the structure below is current as of now.

### A) "Are my events even arriving?" — Meta **Events Manager**
1. Go to **business.facebook.com** -> left menu **Events Manager**.
2. Click **Data Sources** -> select your **Pixel/Dataset** (the one whose ID is in your settings).
3. **Overview** tab = your home base. You'll see each event (PageView, Lead, InitiateCheckout, Purchase) with a count and a live activity graph.
   - **Healthy:** counts rising during the day, all four events present.
   - **Broken:** an event stuck at zero after you know it happened, or a sudden drop to flat-line.

### B) "Is the Browser+Server merge working (no double counting)?" — dedup check
1. Events Manager -> your dataset -> **Overview** -> click into a specific event (e.g. **Purchase**).
2. Look for **Connection Method** / **"Received from"**. Healthy = it shows **both "Browser" and "Server"**, with a note that events are being **deduplicated**.
   - **Healthy:** "Browser and Server", deduplicated — one purchase = one counted purchase.
   - **Broken:** Purchase count is exactly **double** your real number, or it says received from both but **not** deduplicated -> the IDs aren't matching.

### C) "Live testing while I click through myself" — **Test Events**
1. Events Manager -> your dataset -> **Test Events** tab.
2. It shows events **in real time** as you (or a tester) use the site. This is where you'll do the one outstanding browser check.
   - **Healthy:** as you register / checkout / pay, you see Lead, then InitiateCheckout, then Purchase appear, each as a **single row marked from both Browser and Server**.
   - **Broken:** an event doesn't appear at all, or appears **twice** (two separate rows for one action).

### D) "How well is Meta matching my events to people?" — **Event Match Quality**
1. Events Manager -> dataset -> click an event (e.g. **Purchase**) -> **Event Match Quality** score.
   - With advanced matching **OFF** (today's setting), expect a **lower "Good/Okay" score** — that's **expected and fine**; it's the privacy trade-off. It does **not** mean anything is broken.
   - Turning on G1 later is what raises this score.

### E) "Which ads actually made money?" — **Ads Manager**
1. Go to **adsmanager.facebook.com**.
2. Open the **Campaigns** view -> click **Columns: Performance** -> **Customize Columns**.
3. Tick the conversion events you care about (**Purchase**, **Lead**) plus **Purchase ROAS** and **Cost per result**.
   - **Healthy:** campaigns show results attributed to Purchase/Lead, a cost per result, and a ROAS number once purchases with value flow in.
   - **Broken:** all conversion columns blank days after events are confirmed arriving in Events Manager -> usually means the ad account and pixel aren't linked, or attribution window needs adjusting.

### F) In YOUR OWN admin portal — and how it reconciles with Meta
- **Registrations & payments:** your existing admin **Analytics** and **Finance** areas (at `/admin/analytics`) — the real source of truth for who registered and who paid.
- **Attribution (Meta) tab:** in `/admin/analytics` there is an **"Attribution (Meta)"** tab. Per campaign it shows leads, paid webinars, paid admissions, **total revenue**, and (if the Ad Account is connected) cost-per-conversion and ROAS.
- **How to reconcile the two:**
  - The **rupee value** on Meta's **Purchase** should match the **PAID amount in your Finance/Payments** for the same period, because both come from the *same* reconciled payment record. If Meta's Purchase revenue and your Finance revenue for a day roughly match, tracking is trustworthy.
  - Expect **Meta's counts to be slightly lower** than your portal's, because Meta can only attribute conversions it can match to an ad click (especially with advanced matching off). Your portal is always the complete, authoritative record; Meta is the "how much of this came from ads" lens.
  - **Red flag:** Meta shows **more** purchases/revenue than your Finance record -> that points to double-counting (see the dedup check in B).

---

## 5. STEPS LEFT FOR YOU (ordered checklist)

### MUST DO before going live

**Step 1 — Fix the "localhost writes to the live database" safety issue.**
- *Why:* Today, testing on a developer's own computer wrote real rows into your **live production database** (that's exactly the fake test data that had to be cleaned up). This must be prevented before more testing happens.
- *What to do:* Ask your developer to point local testing at a **separate test/staging database**, not production. You don't click anything here — this is a developer task — but **you should require confirmation it's done** before any further local testing. Until then, treat every local test as touching real data.

**Step 2 — Watch the Browser+Server merge happen once, with your own eyes.**
- *Why:* This is the one thing never yet verified. It confirms you won't double-count in production.
- *What to do:*
  1. Open **Events Manager -> your dataset -> Test Events** (Section 4C). Keep it open.
  2. In a normal browser, open your site, click **"Accept all"** on the cookie banner -> confirm **PageView** shows up.
  3. Register for a **free** webinar -> confirm **Lead** appears as **one** row (Browser + Server).
  4. Start a **paid** checkout and complete a test payment -> confirm **InitiateCheckout** then **Purchase** each appear as **one** row, and Purchase shows the **correct rupee amount**.
  - *Pass = each event appears once, from both sources, correct value.* If any appears twice, stop and tell your developer (the IDs aren't matching).

**Step 3 — Confirm the region move is healthy (from your earlier infra work).**
- *Why:* You deliberately avoided stacking changes on top of an unvalidated move. Two scheduled jobs need to run cleanly first.
- *What to do:* Tomorrow morning IST, confirm the **verify-payments job (08:30 IST)** and the **sms-dispatch job (10:00 IST)** both ran and reconciled without errors (your developer or your logs/monitoring will show this). Once both are clean, **un-stage the rollback** (i.e. stand down the emergency revert you had prepared). Only after this should the Meta deploy go out.

**Step 4 — Deploy to production (Vercel).**
- *Why:* The code is currently on a branch and live on nothing.
- *What to do (with your developer):*
  1. In **Vercel -> your project -> Settings -> Environment Variables -> Production**, add: the **Pixel ID**, the **CAPI access token**, and the setting **advanced matching = 0 (off)**.
  2. **Do NOT add the "Test Event Code" in Production.** That code forces events into "test only" mode. Leaving it out is what makes real events count. (It's fine to keep it in a staging environment.)
  3. Merge/deploy the `feat/meta-capi-attribution` branch to production.
  4. After deploy, repeat the **Overview** and **dedup** checks (Sections 4A-4B) on **real** traffic for a day.

### OPTIONAL / LATER

**Step 5 — Decide on "G1" advanced matching (student PII -> Meta).**
- *What it is:* Sending **scrambled (hashed)** phone/email so Meta matches more conversions -> better attribution and lower ad costs.
- *The trade-off:* It means personal data (even though scrambled) is shared with Meta, so it needs to be **allowed under your privacy policy / DPDP obligations**. Until you explicitly approve, it stays **OFF**, and attribution still works — just with a lower match rate.
- *What to do when ready:* Confirm to your developer it's permitted, then flip the one setting **advanced matching = 1** in Vercel Production. Nothing else changes.

**Step 6 — Connect ad spend for ROAS inside your own portal (optional).**
- *What it is:* Adds your **Meta Ad Account ID** + an ads token so your portal's Attribution tab can show **cost per conversion and ROAS**, not just revenue.
- *What to do:* Give your developer the Ad Account ID from Ads Manager; they add two settings. (Meta's Ads Manager already shows ROAS without this — this step is only to see it inside *your* portal too.)

---

### One-glance status
- DONE: Built, server-verified, privacy-safe (no PII), test data cleaned up, nothing deployed.
- GAP: Never watched the browser merge happen once (Step 2) — the key trust check.
- BLOCKERS before live: localhost->prod DB fix, browser merge check, region cron confirmation, then deploy.
- YOUR CALL, later: G1 advanced matching, ROAS spend connection.

---

## Technical appendix (for your developer)

- **Branch:** `feat/meta-capi-attribution` (additive, inert without env keys; not deployed).
- **Env vars:** `NEXT_PUBLIC_META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `META_ADVANCED_MATCHING` (0 = off / G1), `META_TEST_EVENT_CODE` (staging/test only — omit in Production), optional `META_AD_ACCOUNT_ID` + `META_ADS_ACCESS_TOKEN` for spend/ROAS, `META_GRAPH_VERSION` (v21.0).
- **Deterministic event IDs (dedup):** `paid_<ref>` (Purchase), `ic_<ref>` (InitiateCheckout), `lead_<webinarId:phone>` (Lead). Browser and server derive these from the same module (`lib/analytics/metaEvents.ts`).
- **Server chokepoints:** `recordPaymentPaid` -> Purchase, `recordPaymentInitiated` -> InitiateCheckout, `recordRegistrationCreated` -> Lead (`lib/analytics/server.ts`). Purchase value comes from the reconciled PAID amount — never recomputed.
- **Browser helpers:** `lib/analytics/metaPixel.ts` (consent-gated). Pixel loader in `lib/analytics/thirdParty.ts`; consent = `marketing` flag in `nsa_consent` cookie.
- **Attribution capture:** `fbclid`/`fbp`/`fbc` + UTMs captured at landing, persisted on `buyers.first_touch/last_touch` (JSONB, no schema migration).
- **Admin:** Attribution (Meta) tab at `/admin/analytics`; API `app/api/admin/analytics/attribution/route.ts`; query `getMetaAttribution` in `lib/analytics/queries.ts`; spend via `lib/analytics/metaInsights.ts`.
- **Verification done this session:** all 4 CAPI events returned HTTP 200 / `events_received:1`, no PII, no warnings, routed to Test Events; real demo payments hit `recordPaymentPaid` with correct Rs.50; browser PageView beacon captured on the wire. Browser Lead/IC/Purchase beacons could not be captured under headless automation (Meta anti-bot gate) — needs one real-browser confirmation (Step 2).
