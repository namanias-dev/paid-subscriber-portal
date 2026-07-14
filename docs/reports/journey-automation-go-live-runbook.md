# Journey Automation — Go-Live Runbook (plain-English, click-by-click)

**Who this is for:** a non-technical admin. No coding or DevOps knowledge needed.
**What it does:** takes Journey Automation from "designed but sends nothing" to "sending
real SMS for ONE workflow to a few staff phones (canary)", safely, one reversible step
at a time.

> **The golden rule:** *Nothing sends until you complete Step 4.* Steps 1–3 only turn on
> the "brain" that thinks about what it *would* send. You can stop after any step and the
> system is safe.

Our setup: production site **www.namanias.com**, hosted on **Vercel**
(project *naman-ias*). The database is **Supabase**. You will do everything from the
Vercel dashboard and the admin site — no terminal.

---

## Vocabulary (read once)

- **Environment Variable (env var):** a setting stored in Vercel (like a labelled switch).
  We flip these to enable parts of the system. Every journey switch defaults to OFF and
  only counts as ON when its value is exactly the word `true` (lowercase).
- **Cron:** an automatic timer that "pokes" the system on a schedule so it does its work.
- **Simulate vs Live:** *Simulate* = the engine decides what it would send and records it,
  but sends nothing. *Live* = it may actually send (only if the master send switches are
  also ON).
- **Canary:** a tiny, safe test — restrict sending to a couple of staff phone numbers and
  a small cap before opening to real students.
- **Kill switch:** a big red "stop everything" button in the admin.

---

## Step 1 — Set `CRON_SECRET` in Vercel (the cron's password)

This is a private password so only Vercel's timer (not the public internet) can run the
engine.

1. Go to **https://vercel.com** and sign in.
2. Top-left, make sure the team **naman-ias-academy** is selected.
3. Click the **naman-ias** project.
4. Click **Settings** (top tab) → **Environment Variables** (left menu).
5. Click **Add New** (or **Add Another**). Fill in:
   - **Key:** `CRON_SECRET`
   - **Value:** a long random string. Make one up that's hard to guess, e.g.
     `naman-cron-7f3k9Qz2Lp8xR4mV` (20+ mixed letters/numbers; no spaces). Keep a copy
     somewhere safe.
   - **Environments:** tick **Production** (you can also tick Preview/Development, but
     Production is the one that matters).
6. Click **Save**.
7. **Important:** env-var changes only take effect after a redeploy. Go to the
   **Deployments** tab → find the most recent Production deployment (top of the list) →
   click the **⋯** menu on the right → **Redeploy** → confirm **Redeploy**.
   - **You'll see:** a new deployment start "Building", then turn to a green **Ready**
     after a few minutes.

✅ **When to move on:** the redeploy shows **Ready**.

---

## Step 2 — Confirm the cron is authenticating (and that nothing runs yet)

We'll gently test the engine's front door. This sends nothing.

1. **Test the password is required.** In your browser, open:
   `https://www.namanias.com/api/cron/journey-engine`
   - **You'll see:** `{"ok":false,"error":"Unauthorized"}` (this is CORRECT — the door is
     locked without the password).
2. **Test with the correct password.** Open (replace `YOUR_SECRET` with the value from
   Step 1):
   `https://www.namanias.com/api/cron/journey-engine?secret=YOUR_SECRET`
   - **You'll see** one of these — both are healthy:
     - `{"ok":true,"skipped":"feature_disabled"}` — the engine is authenticated but the
       master engine switch (Step 3) is still OFF. **This is expected right now.** Nothing
       runs, nothing sends.
     - `{"ok":true,"matcher":{...},"worker":{...},"ts":...}` — you'll only see this *after*
       Step 3.
   - **If you see** `Unauthorized`, the secret in the URL doesn't match Step 1 — re-check
     the value.

### Does Vercel's built-in timer suffice, or do we need an external one?

**Vercel's built-in cron is enough — no external scheduler is needed.** Our project is on
a Vercel **Pro** plan (it already runs 6 scheduled crons), and the journey engine is
already registered in `vercel.json`:

```
/api/cron/journey-engine   →   runs daily at 04:15 UTC (09:45 IST)
```

Vercel automatically attaches the `CRON_SECRET` you set (as an `Authorization: Bearer`
header), so once Step 1 is done the built-in timer authenticates on its own — you don't
paste the secret anywhere for the scheduled runs.

- **Recommended cadence:** for payment reminders, **hourly** is plenty and responsive.
  Daily is fine to start. To change it, ask your developer to update the one line in
  `vercel.json` (e.g. `"schedule": "0 * * * *"` for hourly) and deploy — a 1-line change.
- **Only if you ever leave Vercel Pro** would you need an external scheduler like
  **cron-job.org**. In that case: create a job pointing at
  `https://www.namanias.com/api/cron/journey-engine`, and add the secret **either** by
  using the URL `...?secret=YOUR_SECRET` **or** by adding a request header
  `Authorization: Bearer YOUR_SECRET`. Recommended interval: every 15–60 minutes. (You do
  **not** need this today.)

✅ **When to move on:** the locked-door test returns `Unauthorized`, and the
with-password test returns `{"ok":true,"skipped":"feature_disabled"}`.

---

## Step 3 — Turn on the engine "brain" in SIMULATE (still sends nothing)

This lets the engine start *thinking* about real events and recording what it *would*
send. It still sends **nothing**, because sending needs the switches in Step 4 and a
workflow set to *Live*.

1. In Vercel → **naman-ias** → **Settings** → **Environment Variables**, add:
   - **Key:** `JOURNEY_AUTOMATION_ENABLED`
   - **Value:** `true`
   - **Environments:** **Production**
   - **Save**, then **Redeploy** (Deployments tab → ⋯ → Redeploy), wait for **Ready**.
2. Re-run the with-password cron test from Step 2:
   `https://www.namanias.com/api/cron/journey-engine?secret=YOUR_SECRET`
   - **You'll see:** `{"ok":true,"matcher":{...},"worker":{...},"ts":...}` — the engine is
     now running. Because every workflow defaults to **execution mode = off**, the matcher
     still enrolls nobody until you opt a specific workflow in.

> **Safe here?** Yes. The engine is on but idle. Even if you set a workflow to *Simulate*,
> it records "would-send" rows and **sends nothing** (the master send switches in Step 4
> are still OFF).

### Design + soak a workflow (all in the admin, no Vercel)

3. Open **www.namanias.com/admin** → left menu **Communications → Journey Automation**.
4. Click **New journey**, give it a name → you land in the visual **builder**. Design your
   journey, then **Publish** (this freezes a version; it still won't run on its own).
5. From the dashboard, click **Operate & analytics** on that workflow (or the **Operate**
   button in the builder).
6. On the **Execution & canary** tab, set **Execution mode = Simulate**.
   - **You'll see** the mode pill change to "simulate". Over the next cron runs, the
     **Runs & queue** tab fills with enrollments and the **Dry-run** tab shows the exact
     messages that *would* send — **0 actually sent**.
7. Click **Run dry-run** and review the "Messages that WOULD send" table carefully. This is
   your human review artifact.

✅ **When to move on:** the dry-run looks correct and simulate has soaked with sensible
"would-send" numbers and no surprises.

---

## Step 4 — Go LIVE for ONE workflow, to STAFF phones only (canary)

**This is the only step that can actually send SMS.** Do it during working hours with a
colleague watching.

**Do the admin settings first (4a–4c), then the Vercel switches (4d).**

### 4a. Lock the blast radius to staff (admin → Operate → Execution & canary)
- **Staff-test phones:** enter 1–3 staff 10-digit numbers (comma-separated). While this is
  set, **only these numbers can enroll** — real students are excluded.
- **Max enrollments:** set a small number, e.g. `5`.
- Click **Save canary settings**.
  - **You'll see** a "Canary settings saved" confirmation.

### 4b. Set the workflow to Live
- Still on **Execution & canary**, set **Execution mode = Live**.
  - **You'll see** a confirmation dialog reminding you that Live still needs the server
    switches (Step 4d) to actually send. Confirm.
  - **You'll see** the mode pill change to "live". *(Nothing sends yet — the master send
    switches are still OFF.)*

### 4c. Confirm the safety state
- Go to the Journey Automation **dashboard**: the **Global kill switch** must read
  **Standby** (not Engaged).
- On **Operate → Execution & canary → Category pause**, the category you're using
  (e.g. *payment reminder*) must read **Active** (not Paused).

### 4d. Flip the master send switches in Vercel (this enables sending)
In Vercel → **naman-ias** → **Settings** → **Environment Variables**, add each of these
with value `true`, **Production**, then **Save**:

1. `JOURNEY_AUTOMATION_EXECUTION_ENABLED` = `true`  *(lets the engine take real actions)*
2. `JOURNEY_AUTOMATION_SMS_ENABLED` = `true`  *(lets it hand messages to the SMS system)*
3. The **category switch** for your journey type — set **only the one you need**:
   - Payment-reminder journeys → `JOURNEY_AUTOMATION_PAYMENT_REMINDERS` = `true`
   - Promotional journeys → `JOURNEY_AUTOMATION_PROMOTIONAL` = `true`

Then **Redeploy** (Deployments → ⋯ → Redeploy) and wait for **Ready**.

- **What just happened:** on the next cron run, your Live workflow may now send real SMS —
  but only to your canary staff phones, capped at your max. Every send still goes through
  the existing DLT-compliant SMS system (the same one Mission Control uses).
- **You'll see:** in **Operate → Analytics**, "Sent" starts counting (was 0 in simulate);
  in **Runs & queue**, node runs show "sent". Check that your staff phones receive the
  message.

✅ **Canary success:** staff phones received the correct message, analytics show the sends,
and nothing unexpected appears in the Dead-letter queue.

### 4e. Widen carefully (optional, later)
Once the canary looks good: in **Operate → Execution & canary**, clear the **staff-test
phones** box and raise/clear **max enrollments**, **Save**. Real students matching the
trigger will now enroll on the next cron run. Increase gradually.

---

## Step 5 — Where to watch, and the instant STOP

**Watch (admin → Communications → Journey Automation → Operate & analytics on a workflow):**
- **Runs & queue tab:** live enrollments, each contact's path, the job queue, and the
  **Dead-letter queue** (failed jobs). A safe **Retry** re-queues a failed job — it still
  passes every safety check and can't bypass compliance.
- **Analytics tab:** contacts entered/converted, **would-send vs sent**, goal conversions,
  and revenue attributed (read from the real payment ledger).

**Stop instantly (two levels):**
- **Whole system:** Journey Automation **dashboard → Global kill switch → Engage**
  (give a reason). This halts ALL journeys immediately. Reversible (Disengage).
- **One category:** **Operate → Execution & canary → Category pause → Pause**
  (e.g. pause all payment reminders) without touching anything else.
- **One workflow:** **Operate → Execution & canary → set Execution mode = Off**. This also
  cancels that workflow's pending jobs.
- **Nuclear/immediate, no admin needed:** in Vercel set
  `JOURNEY_AUTOMATION_SMS_ENABLED` back to `false` (or delete it) and Redeploy — sending
  stops on the next run regardless of any workflow setting.

---

## Step 6 — What is safe at each step (summary)

| After you finish | Engine thinking? | Can it SEND? | Notes |
|---|---|---|---|
| Step 1 (CRON_SECRET) | No | **No** | Just sets the cron password. |
| Step 2 (verify cron) | No | **No** | You only tested the locked door. |
| Step 3 (`JOURNEY_AUTOMATION_ENABLED=true`) | Yes | **No** | Simulate records "would-send"; sends nothing. |
| Step 4a–4c (canary + Live mode) | Yes | **No** | Live is armed but master send switches are OFF. |
| **Step 4d (EXECUTION + SMS + category = true)** | Yes | **YES** | **This is the moment sending begins** — limited to canary phones/cap. |
| Step 4e (widen canary) | Yes | Yes | Real students begin enrolling. Increase slowly. |

**Only Step 4d turns on real sending.** Everything before it is reversible and sends
nothing. Keep the kill switch one click away whenever the send switches are ON.

---

## Final pre-live checklist (tick all before Step 4d)

- [ ] `CRON_SECRET` set in Vercel Production; locked-door test returns `Unauthorized`.
- [ ] `JOURNEY_AUTOMATION_ENABLED=true`; with-secret cron returns `{"ok":true,"matcher":…}`.
- [ ] Workflow **published**, dry-run reviewed, soaked in **Simulate** with sensible numbers.
- [ ] **Canary staff phones** set + small **max enrollments** saved.
- [ ] Workflow **Execution mode = Live**.
- [ ] Global **kill switch = Standby**; your **category = Active** (not paused).
- [ ] A colleague is watching **Operate → Runs & Analytics** during the flip.
- [ ] You know how to hit the kill switch and how to set `JOURNEY_AUTOMATION_SMS_ENABLED=false`.
