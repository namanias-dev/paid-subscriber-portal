# Business Analytics

**Menu:** `Overview` → `Business Analytics`  ·  **Web address:** `/admin/analytics`
**Who can open it:** staff whose role has **View revenue dashboards**.

## What this page is for
Marketing funnel analytics — how many people visit, register, and pay — reconciled to the Payments tab. Heading: `Business Analytics`, subtitle `Acquisition, conversion & revenue — every number defined, reconciled to Payments.`

## What you'll see
- **Date range:** `Today`, `Yesterday`, `7 days`, `30 days`, `This month`, or `Custom` (two dates). Everything on the page follows this range, shown in IST.
- **Exclude admin traffic** toggle — hides visits/payments from internal staff phone numbers so test activity doesn't skew the numbers.
- **KPI cards:** Unique visitors, New registrations, Payment initiated, Logins, Paid students, Paid transactions, Revenue, Amount in verifying.
- **Conversion cards:** Visitor→Paid %, Registration→Paid %, Payment→Paid %, Avg revenue/student.
- **By source** table with `Export CSV`.
- **About these numbers** panel (tap to expand) explaining the rules.

> Every card and column has an ⓘ icon — hover, tap, or focus it to see exactly what the number means and how it is calculated.

## Metric glossary (the single source of truth)

These definitions match exactly how the numbers are computed in code (the ⓘ tooltips read from the same file, `lib/analytics/metrics.ts`).

| Metric | Plain meaning | Exact formula / denominator |
|---|---|---|
| **Unique visitors** | Unique people who opened the site | Distinct visitor IDs in range (10 refreshes by one person = 1) |
| **Sessions** | Separate browsing visits | Distinct session IDs in range |
| **Page views** | Total pages opened | Count of page-view events (events, not people) |
| **Logins** | Times students logged in | Count of login events; hint shows unique users |
| **New registrations** | New webinar/lead registrations | Distinct registrations in range (per person+webinar) |
| **Payment initiated** | Attempts started | Count of payment rows created in range (any status) |
| **Paid students** | Unique students who paid | Distinct phones with ≥1 verified/approved payment (one person = 1, even if they paid twice) |
| **Paid transactions** | Successful payments received | Verified/approved payments in range, retry-duplicates collapsed |
| **Revenue** | Money actually received | Sum of verified/approved payments only (PAID/captured) — never pending/verifying/failed/abandoned |
| **Payment abandoned** | Attempts walked away from | Payments marked ABANDONED in range |
| **Proofs pending** | Proofs awaiting a decision | Current proofs with status “submitted” (backlog) |
| **Amount in verifying** | Money awaiting verification | Sum of VERIFYING payment amounts in range |
| **Visitor → Paid %** | Visitors who became payers | Paid students ÷ unique visitors (source level); **N/A** with no tracked visitors |
| **Registration → Paid %** | Registrations that paid | Paid students ÷ registrations; N/A when 0 |
| **Payment → Paid %** | Attempts that succeeded | Paid transactions ÷ payment initiated; N/A when 0 |
| **Avg revenue / student** | Average spend per payer | Revenue ÷ paid students; N/A when 0 |

### Reading the "By source" table
- **Untracked** = no source was captured. **Pre-tracking** = the payment was made before visitor tracking began, so there are no visitors to compare against. **Admin (manual)** = offline/admin-recorded payments. These three rows show **N/A** for Visitor→Paid % on purpose — comparing their revenue to visitors would be meaningless (this was the cause of the old “35 paid out of 23 visitors” anomaly).
- Real ad/channel sources (Instagram, Facebook, Google, etc.) show full conversion rates.

## Re-engagement segments (very useful for follow-up)
Click **`Re-engagement segments`** (opens `/admin/analytics/segments`). This gives ready-to-action contact lists:
- `Paid · not logged in`
- `Payment pending / abandoned`
- `Clicked pay · not paid`
- `Paid webinar · no Zoom click` (the practical way to find webinar no-shows)

For each segment you can **`Export CSV`** or use the per-row WhatsApp/call icons under `Reach out`.

> ⚠️ Exported lists contain personal data — keep them private.

## Where the data comes from
Website activity events, buyer records, and payments.
