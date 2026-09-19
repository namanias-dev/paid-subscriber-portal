# July 2026 Meta Ads → Revenue Attribution

Read-only analysis. **No production writes.** All portal fee figures via `enrollmentFeeStateFromEnrollment` / fee state (never `amount_paid`).

**Inputs:** `383932662226135-Campaigns-Jul-1-2026-Jul-31-2026.csv` · portal payments / enrollments / webinars · generated `2026-08-07T04:52:56.399121Z`

---

## Definitions (exact)

| Term | Definition |
|------|------------|
| **Spend** | Amount spent (INR), July — Meta CSV, summed from hourly rows |
| **Collected revenue** | Cash actually received in July: webinar PAID + ₹2,000-class seat PAID + other course PAID from **new students** (first-ever PAID payment in July IST). Unique payment IDs — seat later upgraded is not double-counted |
| **Contracted revenue** | `feeState.totalFee` of each new July student's course enrollment (₹2,000 seat on ₹45,000 course → ₹45,000 contracted / ₹2,000 collected) |
| **ROAS (collected)** | collected ÷ spend |
| **ROAS (contracted)** | contracted ÷ spend — **never blended** with collected |
| **CAC** | spend ÷ new paying students (reported for all first-payers and for course students separately) |
| **New student** | Phone whose first-ever cleaned PAID payment falls in July IST. Excludes failed/expired/deleted/fixture. Legacy July-batch flagged; totals with and without |

---

## 1. Meta CSV parse checks

- Rows are **hourly** (`Time of day` buckets). Aggregated to campaign×day → campaign → July total.
- Rates **recomputed from sums** (never averaged): CPM = spend/impressions×1000 · CPC = spend/link_clicks · CTR = link_clicks/impressions.
- **Reach / Frequency** are 0 at hourly granularity → **dropped**. Re-export campaign×day from Ads Manager if needed.
- **Result indicator** distinct values: `['', 'actions:leadgen.other', 'actions:link_click', 'actions:omni_landing_page_view']` · Objectives: `['Leads', 'Traffic']`. Indicators **differ across campaigns** → Results are **not** comparable and **must not** be summed as “leads”. Use per-campaign only.
- **Results ROAS / Results value** are empty → Meta reports **no revenue**. **All revenue in this report comes from the portal.**
- Date format in file: `YYYY-MM-DD` (not M/D/YY). Coverage 1–31 Jul with **10 days having zero hourly rows** (treated as zero-activity omissions): **2026-07-06, 2026-07-11, 2026-07-12, 2026-07-13, 2026-07-14, 2026-07-15, 2026-07-23, 2026-07-24, 2026-07-25, 2026-07-26**.
- Timezone: CSV dates are calendar days in ad-account timezone. Portal cash uses Asia/Kolkata (IST). No offset applied: treating Meta account as IST (standard for this INR account). If the ad account were not IST, spend would shift across day boundaries by the offset.
- Campaign short labels: see workbook `campaign_name_lookup`.
- **Spend reconcile:** raw column sum ₹204,195.159994 vs aggregated ₹204,195.159994 → **PASS (within paisa)**.

---

## 2. Reconcile (before analysis)

### Excluded legacy/bulk set (eyeball first)

| Course | n | July cash | Contracted |
|--------|--:|----------:|-----------:|
| Saarthi (Old) | 161 | Rs 9,021,700 | Rs 9,799,800 |
| Safalta June 2026 (Old) | 78 | Rs 1,991,166 | Rs 3,410,000 |
| Public Administration Optional 2026 | 2 | Rs 105,000 | Rs 75,000 |

| Day (IST) | n | July cash | Contracted |
|-----------|--:|----------:|-----------:|
| 2026-07-02 | 78 | Rs 1,991,166 | Rs 3,410,000 |
| 2026-07-09 | 82 | Rs 3,687,700 | Rs 4,465,800 |
| 2026-07-24 | 79 | Rs 5,334,000 | Rs 5,334,000 |
| 2026-08-05 | 2 | Rs 105,000 | Rs 75,000 |

**Excluded total:** 241 students · July cash ₹11,117,866 (was wrongly in prior ₹1.17 Cr).

| Check | Result |
|-------|--------|
| July payment candidates | 1156 |
| Included PAID | 830 |
| Excluded payments (failed/expired) | 326 — {"non_paid_status:FAILED": 294, "non_paid_status:EXPIRED": 32} |
| Seat booking definition | PAID course payment of **exactly ₹2,000** → 30 bookings / ₹60,000 |
| Fee figures | via fee state (`totalFee` / `netPaid`) — never `amount_paid` |

Spend reconciles. Clean cohort collected ₹631,048 vs prior contaminated ₹1.17 Cr. Proceeding.

---

## 3. July topline

| Metric | Value |
|--------|------:|
| Spend | ₹204,195.16 |
| Collected | ₹631,048 |
| Contracted | ₹2,475,000 |
| Contracted (ex-legacy) | ₹2,475,000 |
| ROAS collected | **3.09x** |
| ROAS contracted | **12.12x** |
| ROAS contracted ex-legacy | **12.12x** |
| New course students (clean) | 55 (ex-legacy 55) |
| Seat bookings (₹2,000 exact) | 30 (₹60,000) |
| Webinar payments | 501 (₹25,050) |
| CAC course students | ₹3,713 |
| Avg course fee (new) | ₹45,000 |
| Seat→full | 10 converted / 20 stalled (33% conversion) |
| Impressions | 21,896,632 |
| Link clicks | 224,414 |
| Blended CPC / CPM / CTR | ₹0.910 / ₹9.325 / 1.025% |

**vs expected magnitude:** ~53 students / ~Rs 6.6L collected / ~Rs 25L contracted / ~3.2x / ~12.4x. This run: **55** / **₹631,048** / **₹2,475,000** / **3.09x** / **12.12x**.

Chart: `spend_vs_revenue.png`

---

## 4. Per-webinar attribution (core)

Spend window = day after previous webinar → webinar date inclusive. Revenue = webinar date +7d / +14d on **clean cohort only** (Jul 4 no longer inflated by 9 Jul Saarthi import).

No overlapping spend windows among July webinars.

**CSV coverage caveat for webinar windows:** Meta export is **1–31 July only**. July 4 spend window starts **2026-06-29** → pre-July spend is **missing** (undercount). Days with **no hourly rows** inside July (treated as Rs 0): 2026-07-06, 2026-07-11, 2026-07-12, 2026-07-13, 2026-07-14, 2026-07-15, 2026-07-23, 2026-07-24, 2026-07-25, 2026-07-26. Webinar dates **2026-07-11** and **2026-07-25** themselves have no Meta rows.

| Webinar | Date | Spend window spend | Regs | Paid seats | Attend* | Coll +7d | Cont +7d | ROAS coll +7d | ROAS cont +7d | CPR | Coll +14d | ROAS coll +14d |
|---------|------|-------------------:|-----:|-----------:|--------:|---------:|---------:|--------------:|--------------:|----:|----------:|---------------:|
| UPSC Full Masterclass By Naman Sir - July 4 | 2026-07-04 | ₹56,660 | 246 | 192 | 0 | ₹158,900 | ₹485,000 | 2.8 | 8.56 | 230.32 | ₹394,049 | 6.95 |
| UPSC Full Masterclass By Naman Sir - July 11 | 2026-07-11 | ₹45,502 | 87 | 68 | 0 | ₹240,099 | ₹1,077,500 | 5.28 | 23.68 | 523.01 | ₹270,132 | 5.94 |
| UPSC Full Masterclass By Naman Sir - July 25 | 2026-07-25 | ₹42,373 | 124 | 97 | 0 | ₹189,566 | ₹785,000 | 4.47 | 18.53 | 341.72 | ₹189,566 | 4.47 |

\*Attendance = `webinar_registrations.attended` flag (often under-filled; Zoom-click proxy elsewhere in product).

---

## 5. Campaign view

Portal has `attribution_source` on most payments (instagram/direct/…) but **`attribution_campaign` on only 16/830** July PAID rows and **0** `attribution_campaign_id` matches to Meta. Leads have UTM fields, but they do not reliably join to Meta campaign names in this export.

**Campaign-level ROAS is not computable without inventing attribution.** Below: spend + traffic efficiency only, ranked by CPC.

| Rank | Label | Spend | Clicks | CPC | CPM | CTR | Objective | Result indicator |
|-----:|-------|------:|-------:|----:|----:|----:|-----------|------------------|
| 1 | IG-Officer-Short | ₹13,381 | 36,328 | 0.3683 | 4.3289 | 0.011753 | Traffic | actions:link_click |
| 2 | IG-Officer-Direct | ₹51,300 | 128,706 | 0.3986 | 4.1566 | 0.010429 | Traffic | actions:link_click |
| 3 | IG-WantIAS | ₹11,344 | 25,823 | 0.4393 | 4.0982 | 0.009329 | Traffic | actions:link_click |
| 4 | Traffic-HowToCrack | ₹1,755 | 2,470 | 0.7107 | 5.6695 | 0.007977 | Traffic | actions:omni_landing_page_view |
| 5 | Himachal-Manu | ₹18,975 | 8,811 | 2.1536 | 29.0629 | 0.013495 | Leads | actions:leadgen.other |
| 6 | Offline-Workshop | ₹24,252 | 5,568 | 4.3557 | 45.9378 | 0.010547 | Leads | actions:leadgen.other |
| 7 | BestIAS-Chandigarh | ₹57,571 | 11,838 | 4.8632 | 39.9388 | 0.008212 | Leads | actions:leadgen.other |
| 8 | Parents-BestIAS | ₹23,512 | 4,565 | 5.1505 | 33.9529 | 0.006592 | Leads | actions:leadgen.other |
| 9 | Local-IPS-Vineet | ₹2,105 | 305 | 6.9024 | 29.3835 | 0.004257 | Leads | actions:leadgen.other |

---

## 6. Timing insight (from hourly data)

**Cheapest hours by CPC** (min 100 link clicks): 18:00 (₹0.7032), 19:00 (₹0.7224), 17:00 (₹0.809)

**Most expensive hours by CPC:** 00:00 (₹1.3548), 03:00 (₹1.3547), 02:00 (₹1.3222)

**Day-of-week spend:** Mon ₹7,157, Tue ₹16,926, Wed ₹45,451, Thu ₹46,946, Fri ₹45,603, Sat ₹28,876, Sun ₹13,236

**Spend→booking lag (corr of daily spend vs collected at lag k):** lag0=0.116, lag1=0.156, lag2=-0.066, lag3=-0.412, lag4=-0.159, lag5=0.171, lag6=0.081, lag7=-0.06

---

## 7. Plain English

1. **Did July make or lose money?** On a **cash basis vs ads spend**, July **made money**: collected ₹631,048 against spend ₹204,195 (profit ≈ ₹426,853, ROAS collected 3.1x). That cash includes organic/direct/referral (instagram 313, direct 164, null 318) — **not** Meta-only. Contracted book is ₹2,475,000 (12.1x) but instalments can still default.
2. **Most efficient webinar (ROAS collected +7d):** UPSC Full Masterclass By Naman Sir - July 11 (5.28x). **Least:** UPSC Full Masterclass By Naman Sir - July 4 (2.8x). July 11’s **+14d** ROAS spikes because the window overlaps mid-month cash — treat as sensitivity, not proof the webinar caused it. July 4 spend is **understated** (window begins before the July CSV).
3. **What a ₹2,000 seat booking is worth:** face value ₹2,000; **expected realised** ≈ ₹16,333 given 10 converted / 20 stalled and avg course fee ₹45,000. Conversion rate **33%** — most seat bookings **stalled**.
4. **Biggest leak:** (a) **Seat stall** — 20 of 30 seats never progressed; (b) **467 webinar-only first payers** never became course students; (c) **no campaign-level attribution** so budget can't be steered by ROAS inside Meta; (d) **10 zero-row days** in the Meta export (incl. two webinar dates) — confirm in Ads Manager before trusting window spend.
5. **Where to move next month's budget:** Double down on **lowest-CPC Traffic campaigns** that still deliver volume (IG-Officer-Short CPC ₹0.3683); shift spend into **cheapest hours** listed above; fix post-webinar and post-seat follow-up before buying more traffic; re-export Meta at campaign×day for reach **and** pull June 28–30 if analysing July 4; instrument UTM→`attribution_campaign` end-to-end so next month can do true campaign ROAS.

---

## 8. Caveats (mandatory)

- Time-window webinar attribution is **correlation, not causation**.
- Organic / referral / direct are **not separated** from paid without reliable campaign UTMs.
- Meta’s own conversion data is **unused and empty** here; post-iOS 14 under-reporting applies even when filled.
- **Contracted revenue is not guaranteed cash** — instalments default.
- **Reach/frequency unavailable** at hourly granularity.
- 10 calendar days have no CSV rows (assumed zero spend). If Ads Manager shows spend on those days, **re-export and rerun**.

---

## Artifacts

- `july-2026-meta-attribution.xlsx` — topline · per_webinar · per_campaign · daily_spend · hourly_profile · student_level · excluded_rows · campaign_name_lookup
- `spend_vs_revenue.png` — daily spend vs collected
- `portal.json` — portal reconcile export
