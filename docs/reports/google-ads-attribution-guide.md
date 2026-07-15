# Google Ads Attribution — Setup Guide (for staff)

This portal now captures **first-party marketing attribution** on every lead and
shows a **Campaign Performance** report. This guide covers (E) what YOU do in
Google Ads, and (D) what an engineer needs to later add live cost/ROAS.

Nothing here sends SMS or changes any live behaviour.

---

## PART E — What to do in Google Ads (no code needed)

### 1. Turn on auto-tagging (gives us `gclid`)
Google Ads → **Admin → Account settings → Auto-tagging → ON**.
Auto-tagging appends `?gclid=...` to every ad click. We read it automatically and
tag those leads **"Google Ads"** — even if you forget UTM params.

### 2. Add UTM params to your landing-page URLs (gives us the campaign name)
`gclid` proves it's Google Ads; **UTM params tell us WHICH campaign**. Always set
at least `utm_source`, `utm_medium`, `utm_campaign`.

Template:
```
https://www.namanias.com/<page>?utm_source=google&utm_medium=cpc&utm_campaign=<campaign-name>
```

Real examples:
- Webinar campaign (point ads HERE — the registration page):
```
https://www.namanias.com/webinars?utm_source=google&utm_medium=cpc&utm_campaign=upsc_webinar_july
```
- A specific webinar:
```
https://www.namanias.com/webinars/<webinar-slug>?utm_source=google&utm_medium=cpc&utm_campaign=upsc_webinar_july
```
- Courses:
```
https://www.namanias.com/courses?utm_source=google&utm_medium=cpc&utm_campaign=gs_foundation_2027
```

Rules of thumb:
- Keep `utm_source=google` and `utm_medium=cpc` for Google **paid** ads.
- Make `utm_campaign` match the Google Ads campaign **name** exactly — that's how
  a future cost pull lines up spend with leads.
- Use lowercase, no spaces (use `_` or `-`). Keep names stable week to week.

Tip: use Google's **Campaign URL Builder** to generate these, then paste the URL
as your ad's Final URL. With auto-tagging ON, Google adds `gclid` on top.

### 3. Where to point the ads
For lead/registration campaigns, point ads at the **webinar registration page**
(`/webinars` or a specific `/webinars/<slug>`). A registration flips the lead's
"Webinar registered" flag, which the Campaign Performance report counts.

### 4. See the results
Admin → **Analytics → Lead campaigns** tab. Pick This week / month / quarter and
compare campaigns on **leads → webinar regs → sign-ups** (counts + rates).
Individual leads show a gold **Google Ads** pill + the campaign in **Lead CRM**
(filter by Channel = Google Ads or by Campaign).

### 5. (Later) Closing the loop back to Google
Once cost import is built (Part D), you could also **import conversions** into
Google Ads (offline conversion import keyed by `gclid`) so Google optimises toward
real sign-ups. That is described only — not built yet.

---

## PART D — What an engineer needs to add live cost / ROAS (NOT built)

The first-party report works today with **no** Google Ads API. To add
cost-per-lead + ROAS, wire up `lib/marketing/googleAdsStub.ts` (currently throws):

Prerequisites:
1. **Google Ads Manager (MCC)** account + an approved **Developer Token**.
2. An **OAuth2 client** (client_id + client_secret) and a long-lived **refresh
   token** for an account that can read the campaigns.
3. The **login customer id** (MCC) and the **account customer id**.

Server-only env vars (NEVER commit; set in Vercel Production):
```
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
GOOGLE_ADS_CUSTOMER_ID=
```

Implementation sketch:
- `fetchGoogleAdsSpend({from,to})`: run a GAQL query over `campaign` + `metrics`
  (`metrics.cost_micros`, `metrics.clicks`, `metrics.impressions`) for the range.
- Join spend to our per-campaign lead counts (`lib/marketing/campaignReport.ts`)
  by matching Google's campaign name to our `utm_campaign`.
- Compute `cost_per_lead = costInr / leads` and, with revenue, `roas`.
- Surface as extra columns in the **Lead campaigns** tab.

No external calls, secrets, or third-party scripts are added by the current
shipment — this section is a plan only.
