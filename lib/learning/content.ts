/**
 * In-portal "Learning" help center — content data.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The Learning page (`app/admin/learning/page.tsx`) renders everything from the
 * plain data below. Keeping the words here — instead of buried inside JSX — means
 * non-developers can update a step, fix a label, or add a new question by editing
 * simple text, without touching the page layout.
 *
 * HOW TO EDIT (safe for anyone)
 * -----------------------------
 * - Each topic lives inside a SECTION. Each "How to…" is a PROCEDURE.
 * - Inside any text you can use light markdown:
 *     **bold**  for on-screen labels and buttons
 *     `code`    for routes/fields like `/admin/courses`
 *     [text](/admin/...) for a clickable link
 * - `steps` is a numbered list (one action per line).
 * - `check`  = the green "✅ How to check it worked" line.
 * - `mistakes` = the amber "⚠️ Common mistakes to avoid" bullets.
 * - `who` = who is allowed to do it (based on the real permission checks).
 * - `example` = a 📋 Real example pulled from the live database (already masked).
 * - `quickLink` = the 🔗 link shown at the top of the card / section.
 *
 * PRIVACY: every example here is masked. We show real course/batch/webinar names,
 * amounts and statuses, but never full names, phone numbers or emails.
 */

export interface LearnLink {
  label: string;
  /** A real admin route. Use the [ID] placeholder pattern where a record id is needed. */
  href: string;
}

/** A 📋 Real example callout. `lines` render as bullet points. */
export interface LearnExample {
  title: string;
  lines: string[];
}

export interface LearnProcedure {
  id: string;
  title: string;
  /** WHO is allowed to do this (plain English, based on real permission checks). */
  who?: string;
  /** 🔗 Quick link to the screen this procedure happens on. */
  quickLink?: LearnLink;
  /** Short plain-language intro / what this is. */
  intro?: string;
  /** Numbered steps — one action per line. */
  steps?: string[];
  /** ✅ How to check it worked. */
  check?: string;
  /** ⚠️ Common mistakes to avoid. */
  mistakes?: string[];
  /** 📋 Real, masked example from the live database. */
  example?: LearnExample;
  /** Extra words to help search find this card. */
  keywords?: string[];
}

export interface LearnSection {
  id: string;
  icon: string;
  title: string;
  summary?: string;
  quickLink?: LearnLink;
  procedures: LearnProcedure[];
}

/** A scenario answers a real staff question in their own words. */
export interface LearnScenario extends LearnProcedure {
  /** The question exactly as a staff member might ask it. */
  question: string;
  /** Section id this scenario maps to, for "read the full topic". */
  relatedSection?: string;
}

/* ------------------------------------------------------------------ */
/* Master portal links (kept in step with components/admin/adminNav.ts) */
/* ------------------------------------------------------------------ */

export const PORTAL_LINKS: { label: string; href: string; whoNeeds: string }[] = [
  { label: "Dashboard", href: "/admin", whoNeeds: "Everyone (any logged-in staff)" },
  { label: "Business Analytics", href: "/admin/analytics", whoNeeds: "Revenue access" },
  { label: "Courses", href: "/admin/courses", whoNeeds: "Course content access" },
  { label: "Content / LMS", href: "/admin/content", whoNeeds: "Course content access" },
  { label: "Lecture Q&A", href: "/admin/lecture-comments", whoNeeds: "Course content access" },
  { label: "Webinars & Events", href: "/admin/webinars", whoNeeds: "Webinar access" },
  { label: "Brochure Library", href: "/admin/library", whoNeeds: "PDFs & media access" },
  { label: "Subscription Plans", href: "/admin/plans", whoNeeds: "Pricing access" },
  { label: "Students & Enrollments", href: "/admin/students", whoNeeds: "Students/leads access" },
  { label: "Payments & Finance", href: "/admin/payments", whoNeeds: "Revenue / payments access" },
  { label: "Course EMI & Seats", href: "/admin/course-payments", whoNeeds: "Revenue access" },
  { label: "Access at Risk", href: "/admin/access-risk", whoNeeds: "Revenue access" },
  { label: "Duplicate Enrollments", href: "/admin/enrollments/duplicates", whoNeeds: "Revenue access" },
  { label: "Staff & Roles", href: "/admin/staff", whoNeeds: "Staff management" },
  { label: "Settings", href: "/admin/settings", whoNeeds: "Settings management" },
  { label: "Learning (this page)", href: "/admin/learning", whoNeeds: "Everyone (any logged-in staff)" },
];

/* ------------------------------------------------------------------ */
/* Roles → what they can do (from lib/permissions.ts DEFAULT_ROLES)    */
/* ------------------------------------------------------------------ */

export const ROLE_MATRIX: { role: string; can: string; cannot: string }[] = [
  { role: "Super Admin", can: "Everything — content, revenue, payments, staff, roles, settings", cannot: "Nothing (cannot be deleted)" },
  { role: "Admin", can: "All content, revenue & payments, manage staff", cannot: "Manage Super Admins; edit the roles matrix" },
  { role: "Content Admin", can: "All content, students & leads, settings", cannot: "See revenue / payments; edit pricing; manage staff" },
  { role: "Content Editor", can: "Create/edit/publish content (courses, webinars, etc.)", cannot: "Revenue, students, settings, staff" },
  { role: "Current Affairs Editor", can: "Current Affairs articles & PDFs only", cannot: "Other content, revenue, settings, staff" },
  { role: "Support / Operations", can: "Students, leads & enrollments; send SMS", cannot: "Publish content; revenue; staff" },
  { role: "Finance / Revenue", can: "Revenue dashboards, payments, pricing/plans", cannot: "Edit content; manage staff or settings" },
  { role: "Viewer / Analyst", can: "Read-only, non-revenue analytics", cannot: "Any edits; revenue; staff" },
];

/* ------------------------------------------------------------------ */
/* SCENARIOS — the "in your own words" layer (shown first)             */
/* ------------------------------------------------------------------ */

export const SCENARIOS: LearnScenario[] = [
  {
    id: "sc-paid-not-showing",
    question: "A student paid (money left their account) but the portal still shows payment not done. How do I give them access manually?",
    title: "Money deducted, but portal shows ‘not paid’",
    relatedSection: "payments",
    who: "Checking the payment: anyone with **revenue/payments access** (Finance, Admin, Super Admin). Approving the proof and fixing the record: **Manage payments** (Finance, Admin, Super Admin). Manually enrolling instead: **Students & leads** access (Support/Ops, Content Admin, Admin, Super Admin).",
    quickLink: { label: "Open Payments & Finance", href: "/admin/payments" },
    intro:
      "Money leaving a bank account does **not** always mean the payment reached us. First confirm what really happened, then choose the right fix. Never invent a paid record — either verify the real payment or manually grant access on instruction.",
    steps: [
      "Open [Payments & Finance](/admin/payments) and search the student by **name** or **phone**.",
      "Read the **Status** on their most recent attempt: **PAID** (we got it), **VERIFYING** (waiting on confirmation/proof), **FAILED** (bank declined), **ABANDONED** (they closed the page).",
      "If a **PAID** row already exists for that exact course/webinar, they are fine — a later **FAILED** attempt does **not** cancel an earlier **PAID** one. Tell them to log in again and hard-refresh.",
      "If it shows **VERIFYING**: ask the student for a payment screenshot (proof). On the payment row, use **Upload proof**, attach it, then **Approve** it. (Approving needs **Manage payments**.)",
      "If the bank truly deducted money but it shows **FAILED/ABANDONED** and no real money reached us, that is a bank/gateway timing issue — the bank auto-refunds. Do not fake a paid record.",
      "If you have been instructed to grant access anyway (e.g. paid by other means): open [Students & Enrollments](/admin/students), find the student (or **Add student**), and enroll them into the **correct course and batch** with the matching plan.",
    ],
    check:
      "Ask the student to log in to the portal — the course/webinar now appears under **My Courses** / their dashboard. In [Payments & Finance](/admin/payments) the row reads **PAID** (or the manual enrollment shows active access).",
    mistakes: [
      "Approving a proof that does not clearly show the **amount, date and our reference** — verify first.",
      "Manually enrolling into the **wrong batch** (e.g. Online instead of Offline) — the fee and access differ.",
      "Panicking over a **FAILED** row when an earlier **PAID** row exists — access is per exact event; the old PAID still counts.",
    ],
    example: {
      title: "Real (masked) — a genuine retry that ended in success",
      lines: [
        "Student **Sweackchha P.** tried the Safalta seat booking (₹2,000) three times on 29 Jun 2026:",
        "06:14 → **FAILED**, then 06:18 → **ABANDONED**, then 06:21 → **PAID** ✅ (ref `NAMAN-COURSE-…-TPR2`).",
        "The two earlier rows are normal retries. The final **PAID** is what grants access — no manual fix was needed.",
        "Lesson: always look for a later **PAID** row before assuming the payment failed.",
      ],
    },
    keywords: ["deducted", "money", "not showing", "manual access", "proof", "approve", "verify", "stuck"],
  },
  {
    id: "sc-online-offline-fees",
    question: "I want ONE course available in both Online and Offline modes, with different fees for each. How do I set that up?",
    title: "One course, Online + Offline, different fees each",
    relatedSection: "courses",
    who: "**Course content** access — Content Editor, Content Admin, Admin, Super Admin.",
    quickLink: { label: "Open Courses", href: "/admin/courses" },
    intro:
      "Use **one course** with **multiple batches** — one batch per combination. Each batch carries its own fee, so students simply pick their mode and pay the right price. You do **not** create two separate courses for this.",
    steps: [
      "Open [Courses](/admin/courses) and either open the course or click **+ New course**.",
      "Fill the shared details (title, category, description) on the **Basic Details** tab — these are the same for everyone.",
      "Go to the **Batches** tab.",
      "Use **Quick add combinations**: tick the **Modes** (Online, Offline) and **Timings** you offer — it creates one batch per combination automatically.",
      "Open each batch and set its own **Price** (and discount / pay-in-full / EMI if used). Online and Offline can have completely different fees.",
      "Set each batch **Start date** and **Seats** if you limit them, then **Save**.",
    ],
    check:
      "On the public course page, switching between **Online** and **Offline** shows the correct, different price for each. In the admin **Batches** tab you can see both batches listed with their own fees.",
    mistakes: [
      "Creating two separate courses for the same programme — keep it one course, two batches.",
      "Forgetting to set a price on a batch (it then shows ₹0 / wrong fee).",
      "Editing the shared title expecting it to change only one mode — title is shared across batches.",
    ],
    example: {
      title: "Real (masked) — Safalta Online Foundation 2027/28/29 (Aug 2026)",
      lines: [
        "One course (`/admin/courses` → slug `safalta-online-foundation-aug-2026`) with **4 batches**:",
        "**Online · Morning** — ₹45,000 (was ₹50,000; pay-in-full ₹40,000)",
        "**Online · Evening** — ₹45,000 (was ₹50,000; pay-in-full ₹40,000)",
        "**Offline · Morning** — ₹75,000 (was ₹1,00,000; pay-in-full ₹67,000)",
        "**Offline · Evening** — ₹75,000 (was ₹1,00,000; pay-in-full ₹67,000)",
        "Same course, students pick mode + timing and pay that batch's fee.",
      ],
    },
    keywords: ["online offline", "two prices", "different fees", "modes", "combination", "batches"],
  },
  {
    id: "sc-aug-batches",
    question: "How do I create the 5th August 2026 batch with separate Morning and Evening batches?",
    title: "Create the 5 Aug 2026 batch (Morning + Evening)",
    relatedSection: "courses",
    who: "**Course content** access — Content Editor, Content Admin, Admin, Super Admin.",
    quickLink: { label: "Open Courses", href: "/admin/courses" },
    intro:
      "Morning and Evening are **timings of the same course**, so make them **batches** — not separate courses. Rule of thumb: same syllabus & teachers, only the slot/mode/fee differs → use **batches**. A genuinely different programme → a separate course.",
    steps: [
      "Open [Courses](/admin/courses) → open the course (or **+ New course**).",
      "Go to the **Batches** tab and click **Quick add combinations**.",
      "Tick the **Timings** you need (**Morning**, **Evening**) and the **Modes** (e.g. Online and/or Offline).",
      "For each created batch set the **Start date** to **5 Aug 2026**, plus its **Price** and **Seats**.",
      "Set a sensible **default batch** (the one selected first on the public page) and **Save**.",
    ],
    check:
      "The public course page lets a student choose **Morning** or **Evening** (and mode), each with its own start date of 5 Aug 2026 and correct fee.",
    mistakes: [
      "Making four separate courses when one course with four batches is cleaner and easier to manage.",
      "Setting the start date in the wrong timezone — dates are handled in **IST**; double-check the displayed date.",
    ],
    example: {
      title: "Real (masked) — Safalta Aug 2026 batches",
      lines: [
        "All four Safalta Aug 2026 batches share **Start date 5 Aug 2026** (stored as 4 Aug 18:30 UTC = 5 Aug 00:00 IST).",
        "Morning & Evening exist for **both** Online (₹45,000) and Offline (₹75,000).",
        "Each batch has EMI enabled: **₹2,000 seat**, then **3 installments** every 2 months.",
      ],
    },
    keywords: ["5 august", "morning evening", "batch", "timing", "start date", "safalta"],
  },
  {
    id: "sc-enrolled-cant-see",
    question: "The student is enrolled / paid but says they can't see the course in their portal. What do I check?",
    title: "Enrolled/paid but can't see the course",
    relatedSection: "students",
    who: "**Students & leads** access to check enrollment; **revenue/payments** to read the payment.",
    quickLink: { label: "Open Students & Enrollments", href: "/admin/students" },
    intro: "Almost always it is one of: logged into the wrong account/number, enrolled in a different batch, or access validity expired.",
    steps: [
      "In [Students & Enrollments](/admin/students), search by **phone** — confirm they are logging in with the **same number** they paid with.",
      "Open the student and check their **enrollments**: is the course there, and is the **batch** the one they expect?",
      "Check **access validity** — if the plan window expired, access is hidden. Extend it if appropriate.",
      "Cross-check [Payments & Finance](/admin/payments): is there a **PAID** row for that exact course/batch?",
      "Ask them to fully log out and back in, then hard-refresh the page.",
    ],
    check: "After fixing, the student sees the course under **My Courses** when logged in with the correct number.",
    mistakes: [
      "Two accounts with different phone numbers — they paid on one and log in on another.",
      "Access validity expired — the enrollment exists but is time-limited.",
    ],
    keywords: ["enrolled", "can't see", "missing course", "access", "validity", "wrong number"],
  },
  {
    id: "sc-login-code",
    question: "The student's login code / OTP isn't working. How do I help them log in?",
    title: "Login code / OTP not working",
    relatedSection: "students",
    who: "**Students & leads** access — Support/Ops, Content Admin, Admin, Super Admin.",
    quickLink: { label: "Open Students & Enrollments", href: "/admin/students" },
    intro: "Students log in with their phone number and a code. Most issues are wrong number, old code, or typing spaces.",
    steps: [
      "Confirm the **exact phone number** on the student's record in [Students & Enrollments](/admin/students).",
      "Ask them to request a **fresh** code and use the newest one (older codes expire).",
      "Check they are entering digits only — no spaces, no country-code confusion.",
      "If still stuck, resend/reset their access from the student's record and have them try once more.",
    ],
    check: "The student logs in and lands on their portal dashboard.",
    mistakes: ["Using an expired code", "Logging in with a different number than the one on file"],
    keywords: ["login", "otp", "code", "can't log in", "sign in"],
  },
  {
    id: "sc-recording-processing",
    question: "A webinar recording still says ‘processing’. How do I publish it so paid students can watch?",
    title: "Recording stuck on ‘processing’",
    relatedSection: "content",
    who: "**Course content** or **webinar** access — Content Editor, Content Admin, Admin, Super Admin.",
    quickLink: { label: "Open Content / LMS", href: "/admin/content" },
    intro:
      "Recordings are managed in **Content / LMS → Webinars**, NOT on the webinar edit form. ‘Processing’ usually means no playable recording is attached yet, or an upload didn't finish.",
    steps: [
      "Open [Content / LMS](/admin/content) and go to the **Webinars** section.",
      "Find the webinar and check its recording **status**.",
      "Attach a recording one of three ways: **Upload** a video file, **paste a link**, or **Choose from library** (reuse an already-uploaded video).",
      "If an upload stalled, retry it; large files take time and must finish uploading before they play.",
      "Once status shows **Hosted ✓** (or a valid link is saved), it is ready.",
    ],
    check: "A paid student (after the webinar date) opens the webinar in their portal and can play the video — it no longer says processing.",
    mistakes: [
      "Looking on the **webinar edit form** for the recording — it lives in **Content / LMS → Webinars**.",
      "Closing the tab before a big upload finishes.",
    ],
    example: {
      title: "Real (masked) — UPSC Full Masterclass (28 Jun 2026)",
      lines: [
        "The completed Masterclass recording was attached using **Choose from library** (reusing an existing uploaded video).",
        "Status shows **Hosted ✓ (library)**; paid registrants can play it. No re-upload was needed.",
      ],
    },
    keywords: ["recording", "processing", "webinar video", "upload", "library", "playback"],
  },
  {
    id: "sc-regcount-wrong",
    question: "The registration count on a webinar looks wrong / too low. Is something broken?",
    title: "Registration count looks wrong",
    relatedSection: "webinars",
    who: "**Webinar** access — Content Editor, Content Admin, Admin, Super Admin.",
    quickLink: { label: "Open Webinars & Events", href: "/admin/webinars" },
    intro:
      "The public count is **honest** — it reflects real paid/registered people, never a made-up number. There is also a toggle that controls whether the count shows publicly at all.",
    steps: [
      "Open [Webinars & Events](/admin/webinars) and open the webinar.",
      "Check the **Show registration count on public page** toggle. If off, the public page shows encouraging copy instead of a number.",
      "Remember: for a **paid** webinar the count means **paid** registrations; small early numbers are normal.",
      "If you suspect missing registrations, cross-check [Payments & Finance](/admin/payments) for PAID rows on that webinar.",
    ],
    check: "The public webinar page shows either the honest count or the encouraging message, matching the toggle.",
    mistakes: ["Expecting a marketing/seeded number — the system only shows real registrations."],
    example: {
      title: "Real (masked) — two UPSC Masterclass events",
      lines: [
        "Completed **28 Jun 2026** event: **412** registrations recorded.",
        "Upcoming **4 Jul 2026** re-run: count starts low and grows with real paid registrations.",
      ],
    },
    keywords: ["registration count", "wrong", "too low", "toggle", "show count"],
  },
  {
    id: "sc-change-price",
    question: "How do I change a course price after students have already enrolled?",
    title: "Change a price after students enrolled",
    relatedSection: "courses",
    who: "**Course content** access to edit the batch price; pricing/plans changes need **pricing** access.",
    quickLink: { label: "Open Courses", href: "/admin/courses" },
    intro:
      "Editing a batch price only changes what **new** buyers pay. It does **not** retroactively charge or refund students who already paid — their records stay as they were.",
    steps: [
      "Open [Courses](/admin/courses) → the course → **Batches** tab.",
      "Open the batch and update its **Price** (and discount / pay-in-full as needed).",
      "**Save**. The new price applies to future enrollments only.",
      "If existing students need a different amount, handle that individually in [Payments & Finance](/admin/payments) — never bulk-edit paid records.",
    ],
    check: "The public page shows the new price; existing PAID rows in Payments are unchanged.",
    mistakes: [
      "Assuming a price change refunds or re-bills past students — it does not.",
      "Editing paid payment records directly to ‘adjust’ — never do this; handle case by case.",
    ],
    keywords: ["change price", "after enrolled", "increase fee", "edit price", "batch price"],
  },
];

/* ------------------------------------------------------------------ */
/* SECTIONS — full topic-by-topic guide                                */
/* ------------------------------------------------------------------ */

export const SECTIONS: LearnSection[] = [
  {
    id: "access",
    icon: "🔑",
    title: "Access & Accounts",
    summary: "Logging in, fixing login problems, a tour of the menu, and who is allowed to do what.",
    quickLink: { label: "Open Admin", href: "/admin" },
    procedures: [
      {
        id: "login",
        title: "Log in to the admin portal",
        who: "Any staff member who has been given an admin **Username** and **Password**.",
        quickLink: { label: "Open Admin login", href: "/admin" },
        steps: [
          "Go to `https://namanias.com/admin`.",
          "On the **Admin Panel** sign-in card, type your **Username** (all lowercase).",
          "Type your **Password**.",
          "Click **Sign in**.",
        ],
        check: "You see the left-hand menu and, top-right, your username with a coloured **role badge** (e.g. Admin).",
        mistakes: [
          "Usernames are lowercase; extra spaces fail.",
          "If you see an orange ‘change your temporary password’ banner, change it via the **Password** button.",
        ],
      },
      {
        id: "cant-login",
        title: "Can't log in / forgot password / got logged out",
        who: "Any staff member. A password reset is done by someone with **Manage staff** (Admin, Super Admin).",
        quickLink: { label: "Open Admin login", href: "/admin" },
        intro: "There is no self-service ‘Forgot password’ link — an Admin resets it for you.",
        steps: [
          "Double-check your **Username** (lowercase) and **Password**.",
          "If you were logged out, just sign in again — sessions expire for security.",
          "If your password truly doesn't work, ask an **Admin/Super Admin** to reset it in [Staff & Roles](/admin/staff).",
          "After a reset you get a temporary password — log in and change it immediately via the **Password** button (top-right).",
        ],
        check: "You can sign in and the temporary-password banner is gone after you set a new one.",
        mistakes: ["Waiting for a reset email — there isn't one; an Admin resets it directly."],
      },
      {
        id: "tour",
        title: "Tour of the menu (what each tab is for)",
        who: "Everyone — but you only see the tabs your role allows.",
        intro: "The left menu is grouped. You may not see every item below — that's normal and based on your role.",
        steps: [
          "**Overview** — Dashboard and Business Analytics.",
          "**Academics** — Courses, Content / LMS, Webinars & Events, Brochure Library, Subscription Plans.",
          "**People** — Students & Enrollments, Payments & Finance, Course EMI & Seats, Access at Risk, Staff & Roles, Settings.",
          "Click any item to open it; the active item is highlighted.",
        ],
        check: "Clicking a menu item opens its page and highlights it.",
      },
      {
        id: "roles",
        title: "Who can do what (roles & permissions)",
        who: "Everyone can read this. Changing roles needs **Manage roles** (Super Admin).",
        quickLink: { label: "Open Staff & Roles", href: "/admin/staff" },
        intro: "Each staff account has a role. The role decides which menu items and actions they get. See the role table on this page (top) for the full breakdown.",
        steps: [
          "Open [Staff & Roles](/admin/staff) and use the **Roles** tab to see each role's permissions.",
          "Match a person to the **smallest** role that lets them do their job.",
          "Finance-sensitive abilities (revenue, payments, pricing) are only in finance-type roles.",
        ],
        check: "Each staffer sees only the menu items their role allows.",
      },
      {
        id: "staff",
        title: "Add, edit or remove a staff member",
        who: "**Manage staff** — Admin, Super Admin. (Only Super Admin can manage other Super Admins.)",
        quickLink: { label: "Open Staff & Roles", href: "/admin/staff" },
        steps: [
          "Open [Staff & Roles](/admin/staff).",
          "Click **Add staff**, enter their details and choose a **Role**.",
          "Save — they receive a username and a temporary password to change on first login.",
          "To edit, open the staff row, change role/details and save. To remove, use the staff row's remove/disable action.",
        ],
        check: "The new staffer appears in the list and can log in (then must change the temporary password).",
        mistakes: [
          "Giving a bigger role than needed — start small and add later.",
          "You can't grant a permission you don't hold yourself.",
        ],
      },
    ],
  },
  {
    id: "courses",
    icon: "🎓",
    title: "Courses",
    summary: "The one-batch-per-combination idea, creating single & multi-batch courses, pricing/EMI/seats, media, editing safely, duplicating, reordering and publishing.",
    quickLink: { label: "Open Courses", href: "/admin/courses" },
    procedures: [
      {
        id: "concept",
        title: "The big idea: one batch = one combination",
        who: "Good to know for everyone managing courses.",
        intro:
          "A **course** is the programme. A **batch** is one sellable variation of it — a specific **mode** (Online/Offline) and **timing** (Morning/Evening), each with its own **fee**, **start date** and **seats**. Students pick a batch and pay that batch's price.",
        steps: [
          "Same programme, only slot/mode/fee differs → make **batches** inside one course.",
          "Genuinely different programme/syllabus → make a **separate course**.",
        ],
        example: {
          title: "Real (masked) — Safalta Aug 2026 = 1 course, 4 batches",
          lines: [
            "Online · Morning ₹45,000 · Online · Evening ₹45,000",
            "Offline · Morning ₹75,000 · Offline · Evening ₹75,000",
            "All start 5 Aug 2026; one course page, four choices.",
          ],
        },
        keywords: ["batch", "combination", "concept", "mode", "timing"],
      },
      {
        id: "create-course",
        title: "Create a course (every field explained)",
        who: "**Course content** — Content Editor, Content Admin, Admin, Super Admin.",
        quickLink: { label: "Open Courses", href: "/admin/courses" },
        steps: [
          "Open [Courses](/admin/courses) → **+ New course**.",
          "**Basic Details**: **Title**, **Category**, **Status** (Draft/Published), short description, language, target years, duration, faculty.",
          "**Pricing & Seats**: base price, original price (for the strike-through), pay-in-full price, total seats.",
          "**Batches**: add at least one batch (mode + timing + price + start date) — see the multi-batch guide.",
          "**Media**: thumbnail/banner image; **Rich Content**: the long description shown on the page.",
          "Set **Status** to **Published** when ready, then **Save**.",
        ],
        check: "The course appears in [Courses](/admin/courses); when Published it shows on the public site.",
        mistakes: ["Leaving Status on Draft (won't show publicly)", "No batch added (nothing to buy)"],
      },
      {
        id: "multi-batch",
        title: "Create a multi-batch course (Quick add combinations)",
        who: "**Course content** — Content Editor, Content Admin, Admin, Super Admin.",
        quickLink: { label: "Open Courses", href: "/admin/courses" },
        steps: [
          "Open the course → **Batches** tab.",
          "Click **Quick add combinations**, tick the **Modes** and **Timings** you offer — one batch per combination is created.",
          "Open each batch: set its **Price**, **Start date**, **Seats**, and **EMI** if used.",
          "Choose a **default batch** (selected first publicly) and **Save**.",
        ],
        check: "Each combination shows on the public page with its own fee; admin **Batches** lists them all.",
        example: {
          title: "Real (masked) — Safalta Aug 2026",
          lines: [
            "4 batches via Quick add: Online M/E ₹45,000; Offline M/E ₹75,000.",
            "Pay-in-full ₹40,000 (Online) / ₹67,000 (Offline). EMI: ₹2,000 seat + 3 installments.",
          ],
        },
        keywords: ["multi batch", "quick add", "combinations", "online offline morning evening"],
      },
      {
        id: "pricing",
        title: "Set price, discount, pay-in-full, EMI and seats (per batch)",
        who: "**Course content** to edit a batch; org-wide pricing/plans need **pricing** access.",
        quickLink: { label: "Open Course EMI & Seats", href: "/admin/course-payments" },
        steps: [
          "In the batch: set **Price** (what shows), **Original price** (struck through), **Pay-in-full price** (discounted lump sum).",
          "Enable **EMI** to allow installments: set the **seat/booking amount**, number of **installments** and the interval.",
          "Set **Seats** to limit capacity (leave blank for unlimited).",
          "Save. Track seats/EMI live in [Course EMI & Seats](/admin/course-payments).",
        ],
        check: "Public page shows the right price and EMI option; seat counter decreases as people book.",
        example: {
          title: "Real (masked) — Safalta Aug 2026 EMI",
          lines: ["Seat ₹2,000, then 3 installments every 2 months (e.g. ₹15,000 each on the Online plan)."],
        },
      },
      {
        id: "edit-live",
        title: "Edit a live course safely",
        who: "**Course content** — Content Editor, Content Admin, Admin, Super Admin.",
        quickLink: { label: "Open Courses", href: "/admin/courses" },
        intro: "Editing text/media is safe anytime. Be careful with batch prices and deleting batches that students already bought.",
        steps: [
          "Open the course, make your change, **Save**.",
          "Price changes apply to **new** buyers only (see the ‘change price after enrolled’ scenario).",
          "Don't delete a batch that has enrolled students — hide/close it instead if you must.",
        ],
        check: "Public page reflects your edit; existing enrollments are untouched.",
        mistakes: ["Deleting a batch with paid students", "Assuming price edits re-bill past buyers"],
      },
      {
        id: "duplicate-reorder",
        title: "Duplicate, reorder, publish/unpublish, archive/delete",
        who: "**Course content** — Content Editor, Content Admin, Admin, Super Admin.",
        quickLink: { label: "Open Courses", href: "/admin/courses" },
        steps: [
          "**Duplicate/clone**: use the course's duplicate action to copy it as a starting point, then edit.",
          "**Reorder**: drag or use the order controls to change how courses are listed.",
          "**Publish/unpublish**: switch **Status** between Draft and Published.",
          "**Archive/delete**: only for courses with **no** active enrolled students — otherwise unpublish instead.",
        ],
        check: "Listing order, visibility and status reflect your change on the public site.",
        mistakes: ["Deleting a course that has live, enrolled students"],
      },
    ],
  },
  {
    id: "content",
    icon: "📚",
    title: "Content / LMS",
    summary: "Upload lecture videos, organise modules, study material, and manage webinar recordings (upload / link / choose from library).",
    quickLink: { label: "Open Content / LMS", href: "/admin/content" },
    procedures: [
      {
        id: "upload-lecture",
        title: "Upload a lecture video",
        who: "**Course content** — Content Editor, Content Admin, Admin, Super Admin.",
        quickLink: { label: "Open Content / LMS", href: "/admin/content" },
        intro: "Videos upload directly to our secure storage with a progress bar. Large files take time — keep the tab open until it finishes.",
        steps: [
          "Open [Content / LMS](/admin/content) and pick the course/module.",
          "Add a lecture and choose the video **file** to upload.",
          "Watch the **progress bar**; if it fails, retry — uploads can resume.",
          "When status shows complete, the lecture is playable. You can **replace** or **remove** the file later.",
        ],
        check: "The lecture shows a ready/complete status and plays back in preview.",
        mistakes: ["Closing the tab mid-upload", "Uploading an unsupported/oversized file"],
      },
      {
        id: "organize",
        title: "Organise & reorder modules and lectures; free preview",
        who: "**Course content** — Content Editor, Content Admin, Admin, Super Admin.",
        quickLink: { label: "Open Content / LMS", href: "/admin/content" },
        steps: [
          "In [Content / LMS](/admin/content), drag modules/lectures to reorder them.",
          "Mark a lecture as **free preview** if you want non-buyers to sample it.",
          "Save changes; the student view updates accordingly.",
        ],
        check: "Students see the new order; any free-preview lectures are openable without buying.",
      },
      {
        id: "study-material",
        title: "Add study material / PDFs / notes",
        who: "**Course content** / **PDFs & media** — Content roles, Admin, Super Admin.",
        quickLink: { label: "Open Brochure Library", href: "/admin/library" },
        steps: [
          "Use [Content / LMS](/admin/content) to attach notes/PDFs to a course or lecture.",
          "Use [Brochure Library](/admin/library) for downloadable brochures/resources.",
          "Save and verify the file opens from the student side.",
        ],
        check: "The material appears for enrolled students and downloads correctly.",
      },
      {
        id: "webinar-recordings",
        title: "Manage webinar recordings (upload / link / choose from library)",
        who: "**Course content** or **webinar** access — Content roles, Admin, Super Admin.",
        quickLink: { label: "Open Content / LMS", href: "/admin/content" },
        intro:
          "Important: webinar recordings live in **Content / LMS → Webinars**, NOT on the webinar edit form. You have three ways to attach one.",
        steps: [
          "Open [Content / LMS](/admin/content) → **Webinars** section and find the webinar.",
          "**Option 1 — Upload a file**: choose a video file; watch it upload to completion.",
          "**Option 2 — Paste a link**: paste an existing recording URL.",
          "**Option 3 — Choose from library**: reuse a video already uploaded for another course/webinar (no re-upload, no duplicate storage).",
          "Confirm the status pill shows **Hosted ✓** (or **Hosted ✓ (library)**), or that the link is saved.",
        ],
        check: "A paid student (after the webinar date) can play the recording in their portal; it no longer says ‘processing’.",
        mistakes: ["Searching the webinar edit form for recordings", "Leaving the tab before an upload completes"],
        example: {
          title: "Real (masked) — UPSC Masterclass (28 Jun 2026)",
          lines: ["Recording attached via **Choose from library** → status **Hosted ✓ (library)**; paid registrants can watch."],
        },
      },
    ],
  },
  {
    id: "webinars",
    icon: "🎥",
    title: "Webinars",
    summary: "Create/edit events, the registration-count toggle, renaming, re-runs as separate paid events, and the registration link & post-webinar access.",
    quickLink: { label: "Open Webinars & Events", href: "/admin/webinars" },
    procedures: [
      {
        id: "create-webinar",
        title: "Create or edit a webinar",
        who: "**Webinar** access — Content Editor, Content Admin, Admin, Super Admin.",
        quickLink: { label: "Open Webinars & Events", href: "/admin/webinars" },
        steps: [
          "Open [Webinars & Events](/admin/webinars) → **+ New** (or open an existing one).",
          "Set **Title**, **Date & time** (IST), **Price** (₹0 for free), **Capacity**, and the join/Zoom link.",
          "Set **Registration status** (Open/Closed) and whether it **auto-closes**.",
          "Save and **Publish** when ready.",
        ],
        check: "The webinar shows on the public site with the correct date/time and price.",
        example: {
          title: "Real (masked) — UPSC Full Masterclass (4 Jul 2026)",
          lines: ["Price ₹50, capacity 1,000, registration **OPEN**, auto-close on, live session. A re-run of the 28 Jun event."],
        },
      },
      {
        id: "regcount-toggle",
        title: "Show or hide the public registration count",
        who: "**Webinar** access — Content roles, Admin, Super Admin.",
        quickLink: { label: "Open Webinars & Events", href: "/admin/webinars" },
        intro: "The count is always **honest** (real registrations only). The toggle decides whether the number is shown publicly.",
        steps: [
          "Open the webinar and find **Show registration count on public page**.",
          "Turn **on** to show the real number; turn **off** to show encouraging copy instead of a low number.",
          "Save.",
        ],
        check: "The public page shows the real count (on) or the encouraging message (off).",
        mistakes: ["Expecting a fake/seeded number — only real registrations are ever shown."],
      },
      {
        id: "rename-reruns",
        title: "Rename a webinar; run it again (re-runs)",
        who: "**Webinar** access — Content roles, Admin, Super Admin.",
        quickLink: { label: "Open Webinars & Events", href: "/admin/webinars" },
        intro: "Renaming updates the name everywhere automatically (payments, portal, banners). A re-run is a **separate paid event** — paying for one date does not unlock another.",
        steps: [
          "To rename: open the webinar, change the **Title**, **Save** — it propagates everywhere.",
          "To re-run: use **Duplicate** to create a new date/time as a fresh event (optionally copy the link).",
          "Each event sells and grants access on its own.",
        ],
        check: "The new name shows across Payments and the portal; the re-run appears as its own event.",
        example: {
          title: "Real (masked) — two Masterclass events",
          lines: ["28 Jun 2026 (completed, 412 regs) and 4 Jul 2026 (re-run) are separate paid events with separate access."],
        },
      },
      {
        id: "webinar-access",
        title: "Registration link & post-webinar access (recording)",
        who: "**Webinar** access to manage; recordings via Content / LMS.",
        quickLink: { label: "Open Webinars & Events", href: "/admin/webinars" },
        steps: [
          "Share the public webinar page link for registration.",
          "Before/at the time: registered (paid) users see the **join link** in their portal.",
          "After the event: attach a recording in [Content / LMS](/admin/content) → Webinars; paid users then see the **recording**.",
        ],
        check: "A paid user sees the join link before, and the recording after, the event.",
      },
    ],
  },
  {
    id: "payments",
    icon: "💰",
    title: "Payments",
    summary: "Manual enrollment, login codes, proof-of-payment, the approval workflow, EMI, reading a payment timeline, and the ‘paid but shows failed’ playbook.",
    quickLink: { label: "Open Payments & Finance", href: "/admin/payments" },
    procedures: [
      {
        id: "manual-enroll",
        title: "Manually enroll a student",
        who: "**Students & leads** access — Support/Ops, Content Admin, Admin, Super Admin.",
        quickLink: { label: "Open Students & Enrollments", href: "/admin/students" },
        steps: [
          "Open [Students & Enrollments](/admin/students). Search for the student, or click **Add student**.",
          "Enter their profile (name, phone, email, target year) and access validity.",
          "Add a **course enrollment**: pick the **course** and **batch**, then the plan (full / EMI / complimentary).",
          "Optionally record an **initial payment** (course, method, date, note). Save.",
        ],
        check: "The student's record shows the enrollment; they can see the course after logging in with that phone number.",
        mistakes: ["Wrong batch (Online vs Offline)", "Mismatched phone number vs the one they log in with"],
        example: {
          title: "Real (masked) — Safalta installment in action",
          lines: ["Student **Suvakar S.** has a Safalta **Installment 1 of 3 = ₹15,000** marked **PAID** (ref `NAMAN-COURSE-…-9YPD`)."],
        },
      },
      {
        id: "login-code",
        title: "Generate & share a login code",
        who: "**Students & leads** access — Support/Ops, Content Admin, Admin, Super Admin.",
        quickLink: { label: "Open Students & Enrollments", href: "/admin/students" },
        steps: [
          "Find the student in [Students & Enrollments](/admin/students).",
          "Use their record to resend/reset access; share the code via the student's registered number.",
          "Ask them to use the **newest** code (older ones expire).",
        ],
        check: "The student logs in successfully with the shared code.",
        mistakes: ["Sharing an old code", "Sending to a number different from the one on file"],
      },
      {
        id: "proof-approval",
        title: "Upload proof of payment & the approval workflow",
        who: "Upload & approve/reject: **Manage payments** (Finance, Admin, Super Admin). Viewing: **revenue/payments** access.",
        quickLink: { label: "Open Payments & Finance", href: "/admin/payments" },
        intro: "When a payment is **VERIFYING**, a proof screenshot lets you confirm and approve it.",
        steps: [
          "Open [Payments & Finance](/admin/payments) and find the payment row.",
          "Click **Upload proof** and attach the student's screenshot (must show amount, date and our reference).",
          "Review it, then **Approve** (turns the row **PAID**) or **Reject** if it doesn't match.",
        ],
        check: "The row changes to **PAID** and the student gains access; a rejected proof leaves it as-is for follow-up.",
        mistakes: ["Approving a blurry/unmatched screenshot", "Approving without checking the amount/reference"],
      },
      {
        id: "emi",
        title: "EMI / installments",
        who: "Viewing **revenue**; recording/approving installment payments needs **Manage payments**.",
        quickLink: { label: "Open Course EMI & Seats", href: "/admin/course-payments" },
        steps: [
          "Track installment plans in [Course EMI & Seats](/admin/course-payments).",
          "Each installment is its own payment row (e.g. **Installment 1 of 3**) with its own status.",
          "Approve/record each installment as it comes in.",
        ],
        check: "Each paid installment shows **PAID**; the plan's remaining balance updates.",
        example: {
          title: "Real (masked) — Safalta plan",
          lines: ["₹2,000 seat, then 3 × ₹15,000 installments every 2 months (Online plan)."],
        },
      },
      {
        id: "find-timeline",
        title: "Find a payment & read its timeline",
        who: "**Revenue/payments** access — Finance, Admin, Super Admin.",
        quickLink: { label: "Open Payments & Finance", href: "/admin/payments" },
        steps: [
          "In [Payments & Finance](/admin/payments), search by **name**, **phone** or **reference**.",
          "Read the row's **Status**, **amount**, **item** (course/webinar) and **date**.",
          "Multiple rows for one person are the **history** of attempts — read newest to oldest.",
        ],
        check: "You can state exactly what was paid, for what, when, and the final status.",
        example: {
          title: "Real (masked) — a clean retry timeline",
          lines: ["Seat ₹2,000: 06:14 FAILED → 06:18 ABANDONED → 06:21 **PAID** ✅ — the last PAID is the truth."],
        },
      },
      {
        id: "paid-failed",
        title: "‘Paid but shows failed’ playbook",
        who: "**Revenue/payments** to read; **Manage payments** to fix the record.",
        quickLink: { label: "Open Payments & Finance", href: "/admin/payments" },
        intro: "Access is **per exact event**. A later FAILED attempt never cancels an earlier PAID one — and paying for one webinar date doesn't unlock a different date.",
        steps: [
          "Search the student and look for a **PAID** row for the **exact** course/batch or webinar date.",
          "If a matching PAID exists, they have access — a FAILED row elsewhere is just a separate attempt.",
          "If only VERIFYING/FAILED exist and money truly arrived, get a proof and **Approve** it.",
          "Never edit paid records to ‘fix’ this — confirm the real PAID row instead.",
        ],
        check: "The student has a PAID row for the exact item and can see it after logging in.",
        mistakes: ["Treating a sibling re-run's payment as access for another date", "Editing paid records directly"],
      },
    ],
  },
  {
    id: "finance",
    icon: "📊",
    title: "Finance",
    summary: "Reading the dashboard, the full status glossary, abandoned/failed/recovery, CSV export & filters, and basic reconciliation.",
    quickLink: { label: "Open Payments & Finance", href: "/admin/payments" },
    procedures: [
      {
        id: "dashboard",
        title: "Read the Payments & Finance dashboard",
        who: "**Revenue** access — Finance, Admin, Super Admin.",
        quickLink: { label: "Open Payments & Finance", href: "/admin/payments" },
        steps: [
          "Open [Payments & Finance](/admin/payments).",
          "Read the top KPI cards (totals by status) and the searchable/filterable table below.",
          "Filter by status, item or date to focus on what you need.",
        ],
        check: "The KPI totals match the filtered table you're viewing.",
        example: {
          title: "Real (masked) — current spread",
          lines: ["VERIFYING 74 (₹1,11,198) · PAID 47 (₹42,000) · FAILED 17 (₹2,800) · ABANDONED 6 (₹12,000)."],
        },
      },
      {
        id: "statuses",
        title: "Status glossary",
        who: "Everyone with revenue access.",
        intro: "What each payment status means:",
        steps: [
          "**PAID** — money received and confirmed; access granted.",
          "**VERIFYING** — awaiting confirmation/proof; not yet access-granting.",
          "**FAILED** — the bank/gateway declined the attempt.",
          "**ABANDONED** — the student left before completing payment.",
        ],
        check: "You can correctly explain any row's status to a colleague or student.",
      },
      {
        id: "recovery",
        title: "Abandoned / failed / recovery & CSV export",
        who: "**Revenue** access; reaching out may use **Send SMS**.",
        quickLink: { label: "Open Payments & Finance", href: "/admin/payments" },
        steps: [
          "Filter the table to **ABANDONED**/**FAILED** to find people to follow up.",
          "Use search/filters to narrow by item or date.",
          "Export the filtered view to **CSV** for reporting or reconciliation.",
        ],
        check: "The CSV matches your on-screen filter; follow-ups can be actioned.",
      },
    ],
  },
  {
    id: "students",
    icon: "👨‍🎓",
    title: "Students / Users",
    summary: "Find a student, view their access, resend/reset a login code, and fix or revoke access.",
    quickLink: { label: "Open Students & Enrollments", href: "/admin/students" },
    procedures: [
      {
        id: "find-student",
        title: "Find a student & view their access",
        who: "**Students & leads** access — Support/Ops, Content Admin, Admin, Super Admin.",
        quickLink: { label: "Open Students & Enrollments", href: "/admin/students" },
        steps: [
          "Open [Students & Enrollments](/admin/students) and search by **name** or **phone**.",
          "Open the student to see enrollments, batches and access validity.",
          "Cross-check payments via [Payments & Finance](/admin/payments) if needed.",
        ],
        check: "You can see exactly what the student is enrolled in and until when.",
      },
      {
        id: "fix-access",
        title: "Resend/reset login code; fix or revoke access",
        who: "**Students & leads** access.",
        quickLink: { label: "Open Students & Enrollments", href: "/admin/students" },
        steps: [
          "Open the student's record.",
          "Resend/reset their login code if they can't sign in.",
          "Adjust their **access validity** or enrollment to grant, extend or remove access.",
        ],
        check: "The student can log in and sees exactly the access you set.",
        mistakes: ["Revoking the wrong student's access — double-check the phone number"],
      },
    ],
  },
  {
    id: "operations",
    icon: "🛡️",
    title: "Daily Operations & Safety",
    summary: "Simple daily checklists, who to escalate to, and the golden data-safety rules everyone must follow.",
    procedures: [
      {
        id: "checklists",
        title: "Daily checklists",
        who: "Each team, for their own area.",
        intro: "Quick routines to catch problems early.",
        steps: [
          "**Support/Ops**: scan new students & VERIFYING payments; follow up pending proofs.",
          "**Finance**: review VERIFYING/FAILED; approve valid proofs; export CSV for the day.",
          "**Content**: confirm recordings attached for finished webinars; check uploads completed.",
        ],
        check: "No item sits VERIFYING/processing longer than necessary.",
      },
      {
        id: "escalation",
        title: "Escalation — who to contact",
        who: "Everyone.",
        intro: "If you're unsure, escalate rather than guess.",
        steps: [
          "Payment/refund disputes → **Finance** (Manage payments).",
          "Access/login problems you can't fix → **Support/Ops lead**.",
          "Course/content/recording issues → **Content Admin**.",
          "Staff, roles, or anything risky → **Admin / Super Admin**.",
        ],
        check: "The right person is looped in with the student's phone/reference.",
      },
      {
        id: "golden-rules",
        title: "Golden data-safety rules",
        who: "Everyone.",
        steps: [
          "**Never** manually edit paid payment records to ‘adjust’ amounts.",
          "**Never** delete a live course/batch/webinar that has enrolled students — unpublish/close instead.",
          "**Never** fake a PAID status — verify the real payment or enroll on proper instruction.",
          "Always double-check the **phone number** and **exact batch/event** before acting.",
        ],
        check: "Your action is reversible and matches a real, verified record.",
      },
    ],
  },
  {
    id: "troubleshooting",
    icon: "🆘",
    title: "Quick Help / Troubleshooting",
    summary: "Fast answers to the most common ‘why isn't this working?’ moments.",
    procedures: [
      {
        id: "qa",
        title: "Common problems → quick fix",
        who: "Everyone (use the linked screen for the full steps).",
        intro: "Each line is a quick fix; open the matching topic above for full steps.",
        steps: [
          "**Can't see Offline option** → that batch isn't created/published; add it in **Courses → Batches**.",
          "**Recording stuck on processing** → attach it in **Content / LMS → Webinars** (upload/link/library).",
          "**Count looks wrong** → it's honest; check the **Show registration count** toggle on the webinar.",
          "**Paid but shows failed** → look for a **PAID** row for the exact item; a later FAILED doesn't cancel it.",
          "**Login code not working** → confirm the number; send a fresh code.",
          "**Upload failed midway** → retry; keep the tab open until it completes.",
          "**Renamed webinar shows old name** → renaming propagates; refresh the page/portal.",
          "**Enrolled but can't see course** → wrong login number, wrong batch, or expired validity.",
        ],
        check: "The student's specific issue matches one of these and the linked topic resolves it.",
      },
    ],
  },
  {
    id: "glossary",
    icon: "📖",
    title: "Glossary",
    summary: "Plain one-line meanings for terms you'll see in the portal.",
    procedures: [
      {
        id: "terms",
        title: "Terms in plain English",
        who: "Everyone.",
        steps: [
          "**Course** — a programme students enroll in.",
          "**Batch** — one sellable variation of a course (mode + timing + fee + start date).",
          "**Mode** — Online or Offline.",
          "**EMI / installment** — paying in parts instead of one lump sum.",
          "**Pay-in-full** — a discounted single payment for the whole course.",
          "**Seat amount** — small booking amount to reserve a seat before installments.",
          "**Webinar** — a live online event; each date is a separate paid event.",
          "**Recording** — the saved video of a finished webinar (managed in Content / LMS → Webinars).",
          "**PAID / VERIFYING / FAILED / ABANDONED** — payment statuses (see the Finance glossary).",
          "**Proof of payment** — a screenshot a student sends to confirm a VERIFYING payment.",
          "**Role / permission** — what a staff account is allowed to see and do.",
        ],
        check: "You can explain any of these terms in one sentence.",
      },
    ],
  },
];
