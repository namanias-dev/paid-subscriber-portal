# Assessments (Questions, Quizzes, Reports)

**Menu:** `Assessments` (group)  ·  **Permission:** Manage quizzes (all assessment pages).

## Question Bank
**Web address:** `/admin/questions` — heading `Question Bank`.
- **`+ New Question`** to add one; **`⬆ Bulk Import`** to paste many.
- New/edit fields: `Question text`, `Option A`–`Option D`, `Correct answer`, explanation, `Subject`, `Topic`, `Difficulty`, `Tags`, `Mark as PYQ`, `PYQ year`, `Status`, `Approved / reviewed`. Save with `Create Question` / `Update Question`.

## Quizzes / Tests
**Web address:** `/admin/quizzes` — heading `Quizzes / Tests`.
- **`+ New Quiz`**; per row `View`, `Edit`, `Delete`.
- Editor tabs: `Basic Info`, `Questions`, `Scoring & Timer`, `Access Rules`, `Result Settings`, `SEO`. Key fields: `Title`, `Slug`, `Status`, `Type`, `Exam type`, `Subject`, `Topic`, `Quiz date`, `Marks per question`, `Enable time limit`, `Minutes`, access (`Public`, `Requires login`, `Paid — unlock via course enrolment`), `Max attempts`.
- In the `Questions` tab: `Search bank`, `⚡ Auto-generate`, or tick questions from the bank.

## Attempts & Reports
**Web address:** `/admin/quiz-reports` — heading `Attempts & Reports`.
- KPIs: `Attempts`, `Completed`, `Completion`, `Abandoned`, `Avg score`, `Leads captured`.
- Sections: `Most attempted quizzes`, `Hardest questions (most wrong)`, `Top performers`, `Topic-wise averages (weakest first)`, `Per-quiz attempts`.
- Pick a quiz from `Select a quiz…` and download with **`⬇ CSV`**.
- The per-quiz table shows each taker's **Name**, **Mobile** and **Login code**, with a **Registered** (real account) or **Guest** (older, pre-login) tag. Every new attempt is tied to a real student, so you can always see exactly who took which test. The CSV includes the login code and registered flag too.

## How quiz access & first-time login works (important)
A student can **never** take a quiz anonymously — access is checked on the server, not just hidden in the page.
- **Logged-out / new visitor:** when they open a test they must first enter **Name + Mobile** (email optional). This instantly creates their account, generates a **login code**, and **logs them in** — then the test starts. Their lead is captured once in **Leads**. No duplicate accounts are made for a number that already exists.
- **Returning visitor (same mobile):** they get their existing account + the same login code back (shown on the "save your code" screen), then go straight in. They can also log in at `/login` with mobile + code.
- **Already logged in (any student or course buyer):** no form — the test starts immediately and the attempt is tracked to their profile.
- **Logging out** fully clears the session on every device, so a logged-out phone cannot resume a test from a stale/cached login.
- ⚠️ Because of this, the "capture lead before result" quiz toggle no longer changes whether the form appears — the lead/login step is always required for logged-out visitors. The toggle now only affects result-screen behaviour.

## Question Imports
**Web address:** `/admin/quiz-imports` — heading `Question Imports`.
- Tabs: `CSV / XLSX upload` and `Google Sheet`. `Preview` first, then `Import … valid`. Optional `Mark approved` / `Publish immediately`. A `Recent imports` table shows job history.
