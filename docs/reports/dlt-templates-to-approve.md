# DLT SMS Templates to Approve — Journey Automation

**Status: DRAFTS to submit for DLT approval. NOT approved. NOT sendable.**

These are the SMS templates the new automation journeys need that do **not** already
exist as DLT-approved templates. Submit each to the DLT provider using the exact body
below (byte-for-byte), then paste the approved DLT template id into **SMS Mission
Control** (`/admin/communications/sms`). The moment a template is approved + active,
it appears automatically in the journey SMS-node selector and staff can bind it.

Until then, each journey step that references one of these keys shows a clear
**"Pending DLT approval"** state in the studio (never a silent-empty dropdown), and
validation flags it as *"needs an approved DLT template (pending DLT approval: <key>)"*.

## Conventions (match the existing approved templates)

- **Placeholder syntax:** single-brace lowercase tokens — `{first_name}`, `{login_url}`, `{login_code}`, `{item_short}`. (Same as `lib/sms/templates.ts`.)
- **Brand line:** every body contains `Naman Sharma IAS Academy`.
- **Length:** `<= 150` chars **including placeholders** (verified programmatically below via `scripts/verify-dlt-drafts.ts`).
- **GSM-7 only:** no emoji, no `₹` (use "Rs").
- **URLs:** never short/VM links in the body — `{login_url}` is a variable that resolves at send time to a **real whitelisted destination**.

## Whitelisted destination URLs (all confirmed in code)

| Destination | Real URL | Source |
|---|---|---|
| Portal login / dashboard | `https://www.namanias.com/portal/login` | `portalLoginUrl()` default in `lib/sms/config.ts`; route `app/(site)/portal/login/page.tsx` |
| Webinars list | `https://www.namanias.com/webinars` | `webinarsListUrl()`; route `app/(site)/webinars/page.tsx` |
| Courses / admissions | `https://www.namanias.com/courses` | `courseAdmissionsUrl()`; route `app/(site)/courses/page.tsx` |

> **Third whitelisted URL: CONFIRMED = `https://www.namanias.com/portal/login`.**
> `{login_url}` in all templates below resolves to the **portal login** destination
> (none of these ids are in the webinar/course special-case list in
> `loginUrlForTemplate()`). In production `SMS_LOGIN_URL` may point `{login_url}` at a
> rotating provider short link; for DLT submission use the real
> `https://www.namanias.com/portal/login`.

## Verification (programmatic — `npx tsx scripts/verify-dlt-drafts.ts`)

All 6 drafts pass: `chars <= 150`, brand present, variable map matches body. Character
counts count the **body as authored** (placeholders as `{...}` tokens).

| template_key | purpose | chars | brand | category | {login_url} resolves to |
|---|---|---|---|---|---|
| `beginner_resources` | Activation nudge for a logged-in new lead | 116 | yes | transactional | portal login |
| `portal_login_reminder` | Remind a lead/student who hasn't logged in | 124 | yes | transactional | portal login |
| `installment_overdue_reminder` | First overdue-installment reminder (auto-stops if paid) | 123 | yes | payment_reminder | portal login |
| `installment_final_reminder` | Stronger second overdue reminder (auto-stops if paid) | 125 | yes | payment_reminder | portal login |
| `webinar_join_tutorial` | How to join the webinar from the portal | 118 | yes | transactional | portal login |
| `webinar_day_of_reminder` | Day-of nudge to join early | 111 | yes | transactional | portal login |

## Templates

### 1. `beginner_resources`
- **Purpose:** Nudge a logged-in new lead into their starter UPSC plan + notes.
- **Category:** transactional · **Chars:** 116 · **URLs:** `https://www.namanias.com/portal/login`
- **Variable map:** `{first_name}` → lead first name, `{login_url}` → portal login.
- **Body:**
```
Hi {first_name}, log in {login_url} > Class Hub for your UPSC beginner plan and free notes. Naman Sharma IAS Academy
```

### 2. `portal_login_reminder`
- **Purpose:** Remind a lead/student who has not logged in to open their portal.
- **Category:** transactional · **Chars:** 124 · **URLs:** `https://www.namanias.com/portal/login`
- **Variable map:** `{first_name}`, `{login_url}` → portal login, `{login_code}` → one-time login code (resolved live at send time, never stored).
- **Body:**
```
Hi {first_name}, your portal is ready. Log in {login_url} Code {login_code} to open your dashboard. Naman Sharma IAS Academy
```

### 3. `installment_overdue_reminder`
- **Purpose:** First reminder when a fee installment is overdue. Auto-suppressed once paid (category `payment_reminder`).
- **Category:** payment_reminder · **Chars:** 123 · **URLs:** `https://www.namanias.com/portal/login`
- **Variable map:** `{first_name}`, `{item_short}` → course/plan, `{login_url}` → portal login.
- **Body:**
```
Hi {first_name}, installment for {item_short} is overdue. Log in {login_url} > Installments > Pay. Naman Sharma IAS Academy
```

### 4. `installment_final_reminder`
- **Purpose:** Stronger second reminder to clear an overdue installment. Auto-suppressed once paid.
- **Category:** payment_reminder · **Chars:** 125 · **URLs:** `https://www.namanias.com/portal/login`
- **Variable map:** `{first_name}`, `{item_short}`, `{login_url}` → portal login.
- **Body:**
```
Hi {first_name}, please clear the {item_short} installment to keep access. Log in {login_url} > Pay. Naman Sharma IAS Academy
```

### 5. `webinar_join_tutorial`
- **Purpose:** Tell a registrant exactly how to join their webinar from the portal.
- **Category:** transactional · **Chars:** 118 · **URLs:** `https://www.namanias.com/portal/login`
- **Variable map:** `{first_name}`, `{item_short}` → webinar title, `{login_url}` → portal login, `{login_code}` → login code (live at send time).
- **Body:**
```
Hi {first_name}, for {item_short}: log in {login_url} Code {login_code} > My Webinars > Join. Naman Sharma IAS Academy
```

### 6. `webinar_day_of_reminder`
- **Purpose:** Day-of nudge to join the webinar a few minutes early.
- **Category:** transactional · **Chars:** 111 · **URLs:** `https://www.namanias.com/portal/login`
- **Variable map:** `{first_name}`, `{item_short}`, `{login_url}` → portal login.
- **Body:**
```
Hi {first_name}, {item_short} is today. Log in {login_url} > My Webinars > Join early. Naman Sharma IAS Academy
```

## Approved templates the journeys reuse (already DLT-approved — no action needed)

| Step | Template id (Mission Control) | DLT id | {login_url} → |
|---|---|---|---|
| Welcome + login (new lead / payment) | `welcome_first_login` | `1707178280799637109` | portal login |
| Payment success thank-you | `payment_successful` | `1707178280720029430` | portal login |
| Webinar registration confirmed | `webinar_registered` | `1707178280743194991` | portal login |
| Invite to best active webinar | `general_webinar_invite` | `1707178272502168903` | webinars |

## Next step for the team

1. Submit the **6 drafts** above to the DLT provider (exact body).
2. On approval, paste each DLT id into **SMS Mission Control** and mark active.
3. Open each seeded journey → the pending SMS node now offers the approved template → select it → re-validate to **"Ready to publish"**.
