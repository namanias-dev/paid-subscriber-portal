# Lead CRM

**Menu:** `Sales` → `Lead CRM`  ·  **Web address:** `/admin/leads`
**Who can open it:** staff whose role has **Manage students, leads & enrollments**. (If you don't see `Lead CRM` in the menu, your role doesn't have this permission.)

## What this page is for

A **lead** is a potential student who showed interest — by filling a form, registering for a webinar, starting a quiz, or being added by staff. The Lead CRM is your **sales pipeline**: it helps you follow up with each person and move them from a new enquiry towards admission.

The page heading is `Lead CRM` and just under it you'll see a count like `24 sales-pipeline leads`.

## Where the leads come from (sources)

Leads are created automatically when people interact with the website, and you can also add them by hand. The **Source** tells you where the lead came from. The source choices on this page are:

- `Instagram`
- `Meta Form`
- `Webinar` — registered for a webinar
- `Demo` — booked a free demo
- `Website` — contact / counselling / enquiry forms
- `WhatsApp`
- `Referral`
- `home_popup` — the pop-up on the home page

> Note: `Instagram`, `Meta Form`, `WhatsApp`, and `Referral` are mainly used when **you add a lead by hand**. The website automatically tags `Website`, `Demo`, `home_popup`, and `Webinar`. Quiz sign-ups may appear with a source the dropdown can't filter — you can still find them by searching the name/phone.

There is also a separate collapsible section at the very top called **`Portal login-code leads`** — these are quiz/marketing sign-ups who already have a portal login code. That list is **read-only** here (you can WhatsApp them but not edit them).

> Current Affairs leads are stored separately and do **not** appear on this page.

## The two views

At the top you can switch between:

- **`Kanban`** — columns by pipeline stage; each lead is a card you can click.
- **`Stacked`** — leads grouped by person (good when one person has several touchpoints). Only in this view do you get the `Sort` control.

## Pipeline stages (statuses) and what they mean

A lead moves through these stages, in order:

1. `New` — just arrived, not contacted yet.
2. `Contacted` — you have reached out.
3. `Demo Booked` — a demo class is scheduled.
4. `Demo Attended` — they attended the demo.
5. `Negotiation` — discussing fees / deciding.
6. `Admitted` — they joined (became a student).
7. `Lost` — not converting.

There is also a **temperature** badge shown on cards (set automatically, not editable here):
- `Interested` (green) — warmest
- `Warm` (amber) — medium
- `Cold` (grey) — low interest
- `Junk` (red) — not a real lead

⚠️ When you move a lead to `Admitted`, the system also marks them as admitted. After that, the lead card shows their `Fee` and `Pending` balance.

## Search, filter and sort

- **Search box:** `Search name / phone / city` — type any part of a name, phone, or city.
- **Source filter:** defaults to `All sources`; pick one source to narrow the list.
- **Sort** (Stacked view only): `Most recent activity`, `Most activity`, or `Name (A → Z)`.

## "How do I…" recipes

### Add a new lead by hand
1. Click **`+ Add Lead`** (top right).
2. Fill in `Name` and `Phone (10-digit)` (both required), and optionally `City`, source, and `Course interest`.
3. Click **`Add Lead`**.
4. You'll see `Lead added`. If you get `Name and 10-digit phone required`, check the name and that the phone is exactly 10 digits.

### Open a lead and see the details
1. In `Kanban`, click the lead's card. In `Stacked`, click the touchpoint line.
2. A panel opens showing `Phone`, `Email`, `City`, `Source`, `Counsellor`, `Interest`, `Target`, and (if admitted) `Fee` and `Pending`.

### Change a lead's stage (follow-up progress)
1. Open the lead.
2. Use the **`Pipeline stage`** dropdown and pick the new stage.
3. It saves immediately (you'll see `Note added`/the card updates). Moving to `Admitted` also records the admission.

### Contact a lead
Open the lead, then use:
- **`💬 WhatsApp`** — opens WhatsApp with a friendly greeting pre-filled.
- **`📞 Call`** — opens your phone dialer.
- **`📱 SMS`** — opens the Send SMS box (needs the **send SMS** permission). Pick an Approved/Active template and click `Send`. If you see `No Approved/Active templates…`, a Super Admin must activate a template first in SMS Mission Control.

### Add a note about a call or conversation
1. Open the lead.
2. In **`Add activity / note`**, type what happened (e.g. "Called, sent brochure").
3. Click **`Log`**. You'll see `Note added`.

### See a lead's full journey
1. Open the lead.
2. Click **`View customer journey`** to see their activity timeline (pages viewed, registrations, payments, logins, Zoom clicks). Click again (`Hide customer journey`) to close.

### Export leads to a spreadsheet
1. Set any search/source filters you want.
2. Click **`⬇ Export CSV`**. A file `leads.csv` downloads with columns: Name, Phone, Email, City, State, Source, Status, Course Interest, Counsellor, Follow-up, Created.
3. ⚠️ This file contains personal contact details — keep it private.

### WhatsApp a "Portal login-code lead"
1. Expand the top **`Portal login-code leads`** section.
2. Click **`WhatsApp`** next to the person.

## What you can't do here (by design)
- There is **no edit button** for a lead's name/phone/city or counsellor on this page.
- There is **no delete button** for leads in this screen.
- You can't change a lead's temperature here.

## Where the data lives
- Sales-pipeline leads → the `leads` table; your notes → `lead_activities`.
- Portal login-code leads → the `buyers` table (people who can log in).
