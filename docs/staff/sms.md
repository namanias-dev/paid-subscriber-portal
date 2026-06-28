# SMS Mission Control

**Menu:** `Sales` → `SMS Mission Control`  ·  **Web address:** `/admin/communications/sms`
**Who can open it:** staff whose role has **Send SMS (Approved templates) & view SMS logs** (`send_sms`).
**Super Admin only** for editing templates, settings, automations, and bulk/"everyone" sends.

Heading: `SMS Mission Control`, subtitle `Send, automate and audit every SMS across the student lifecycle — in-house, DLT-compliant.`

## The 7 tabs

1. `Overview` — today's activity at a glance.
2. `Send SMS` — send manually to one person or a group.
3. `Automations` — automatic SMS rules.
4. `Templates` — the message templates.
5. `Logs` — every SMS attempt.
6. `Analytics` — trends and delivery.
7. `Settings` — caps, window, kill switch (Super Admin).

---

### 1) Overview
Shows whether sending is on or off (`SMS sending is ON.` / `SMS sending is OFF…`), plus cards: `Sent today`, `Failed`, `Queued`, `Auto / Manual`, `Daily cap`; a `Last 24 hours` chart; `Sends by template (today)`; and `Recent failures` (with a `Retry` button per failure). `Refresh` reloads it.

### 2) Send SMS (manual)
Send to one person or to a group ("audience").

**Step by step:**
1. Pick **`Template (Approved / Active only)`**. Only templates that are Approved/Active **and** have a DLT ID appear. (If none: `No Approved/Active templates yet — set a DLT ID and activate one in the Templates tab.`)
2. Pick the **`Audience`**:
   - **Direct:** `A specific person` (then enter `Mobile` + optional `Name`).
   - **Payments:** `Pending`, `Failed`, `Paid`, `Abandoned`, `All payments`.
   - **Webinar:** `Registered`, `NOT registered`, `Attended`, `No-show` (then pick the `Webinar`).
   - **People:** `Leads`, `All users with mobile`, `Everyone (guarded)`.
3. (Optional) tick **`Override 30-min re-send guard`** only if you truly need to re-send the same message.
4. Click **`Preview`**. The right panel shows the recipient count, the filled-in message, characters/segments, and cap impact.
5. Click **`Send to {count}`** and confirm `Send "{template}" to {N} recipient(s)?`.

**Safety rules you'll run into:**
- ⚠️ **Bulk** (more than one person) and the **`Everyone (guarded)`** audience are **Super Admin only**. Others get `Bulk / all-audience sends require Super Admin.`
- **Promotional** templates can't be sent to `Everyone` — they're warm-audiences only (no promo route). The `Everyone` option disappears for them.
- A person won't get the **same template twice within 30 minutes** unless you tick the override.
- Daily caps and per-mobile caps are enforced (see Settings).

### 3) Automations
A table of automatic rules: `Trigger`, `Template`, `Schedule`, `Audience`, `Last run`, `Enabled`.
- ⚠️ **All automations are OFF by default.** Turning one **`ON`** lets the system auto-send that template when the event happens (e.g. payment success, webinar reminder).
- Only a **Super Admin** can toggle them (`Only a Super Admin can toggle or edit automations.`).
- A rule can't be enabled until its template is Approved/Active with a DLT ID (shows `no DLT/active`).

The 15 default rules cover: payment success/pending/failed/abandoned, proof received, access approved, webinar registered, day-before reminder (6 PM IST), same-day 10 AM reminder, starting-soon, Zoom ready, same-day invite (10 AM), post-webinar thank-you (4 h after end), first login welcome, and course enrolled.

### 4) Templates
List with `Template`, `Use`, `Status`, `DLT ID`, `Worst-case`, `Edit`.
- **Statuses:** `draft` (not sendable), `pending` (not sendable), `approved` (sendable with a DLT ID), `active` (sendable, the live one), `inactive` (retired).
- ⚠️ Sending only works for **Approved/Active** templates that have a **DLT ID**.
- Click **`Open`** to edit (Super Admin only): the message `Body`, the `DLT Template ID`, and `Status`. ⚠️ Editing the body or DLT id of an Approved/Active template **drops it back to Draft** (so it must be re-approved).
- **`Export DLT (Markdown)`** / **`Export DLT (CSV)`** — download the approval sheet to register templates with the DLT provider.

### 5) Logs
Every send attempt. Filter by status (`QUEUED`, `SENT`, `DELIVERED`, `FAILED`, `UNKNOWN`) and by `mobile…`, then `Apply`. Columns: `When`, `Mobile`, `Template`, `Status`, `By`, `Actions`. Click `View` to see the message, any error, and the gateway response. Download with `CSV`. Retry failed ones with the retry icon.

### 6) Analytics
`Sends over time (30 days)`, `Delivery rate by template`, and `Conversion-adjacent (correlation, not attribution)` views (e.g. `Invites sent → later paid`), plus an estimated cost line. Read-only.

### 7) Settings (Super Admin)
- **Gateway (read-only):** shows whether sending is enabled, whether keys are present, sender ID, route, etc. Secrets are never shown.
- **Controls:** `Master kill switch (soft)` (`ON`/`OFF`), `Daily cap (0=∞)`, `Per-mobile/day (0=∞)`, `Window start (IST)`, `Window end (IST)`, `T19 offset (min)`, `T19 fallback all-registered` (`Yes`/`No`). Save with `Save settings`.

## Safety summary
- ⚠️ Sending is **OFF by default** until switched on (env `SMS_ENABLED=true` **and** the soft kill switch). If Overview says it's off, nothing goes out.
- Hard daily cap and per-mobile daily cap.
- 30-minute same-template guard.
- Promotional templates → warm audiences only.
- Bulk / everyone → Super Admin only.
- Automatic send window (e.g. 10:00–21:00 IST) applies to **automations**, not manual sends.

## Sending one SMS from elsewhere
On Leads, Payments, Student profiles, and Webinar registrants you'll see a **`SMS`** button. It opens a small window: pick a template, preview, `Send`. Same rules apply.
