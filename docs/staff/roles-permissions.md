# Roles & Permissions (Who Can Do What)

The Admin Panel hides menu items and buttons based on your **role**. If something is missing for you, your role probably doesn't have that permission. This page explains the system so you know **why**.

## How it works
- Each staff member is assigned a **role** (for example `Support / Operations`).
- Each role grants a set of **permissions** (for example "View revenue").
- The sidebar only shows items your permissions allow. Buttons and pages are also protected behind the scenes.
- A **Super Admin** has every permission and sees everything.

## The 8 built-in roles

1. **Super Admin** — everything, including staff, roles, revenue and settings. Cannot be deleted.
2. **Admin** — everything except managing roles.
3. **Content Admin** — all content + settings + students/leads + SMS; **no** revenue/finance/staff/roles.
4. **Content Editor** — create/edit/publish content only.
5. **Current Affairs Editor** — only Current Affairs articles, PDFs, and publishing.
6. **Support / Operations** — students & leads, non-revenue analytics, and SMS.
7. **Finance / Revenue** — revenue dashboards, payments, pricing.
8. **Viewer / Analyst** — read-only non-revenue analytics.

## What each role can do (key permissions)

| Permission | Super Admin | Admin | Content Admin | Content Editor | CA Editor | Support / Ops | Finance | Viewer |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Send SMS | ✓ | ✓ | ✓ | – | – | ✓ | – | – |
| View revenue | ✓ | ✓ | – | – | – | – | ✓ | – |
| Manage payments | ✓ | ✓ | – | – | – | – | ✓ | – |
| Manage students & leads | ✓ | ✓ | ✓ | – | – | ✓ | – | – |
| Manage courses | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| Manage webinars | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| Manage quizzes | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| Manage Current Affairs | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Manage PDFs & media | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Publish content | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Manage settings | ✓ | ✓ | ✓ | – | – | – | – | – |
| Manage staff | ✓ | ✓ | – | – | – | – | – | – |
| Manage roles | ✓ | – | – | – | – | – | – | – |

## Which menu items need which permission

| Menu item | Permission needed |
|---|---|
| Dashboard | none (any admin) |
| Business Analytics | View revenue |
| Home Page, Toppers, Navigation, About, Settings | Manage settings |
| Lead CRM, Marketing, Landing Pages, Lead Forms, Referrals | Manage students & leads |
| SMS Mission Control | Send SMS |
| Courses, Content / LMS | Manage courses |
| Brochure Library | Manage PDFs & media |
| Subscription Plans | Manage pricing |
| Current Affairs (all pages) | Manage Current Affairs |
| Question Bank, Quizzes, Attempts & Reports, Question Imports | Manage quizzes |
| Students & Enrollments | Manage students & leads |
| Payments & Finance, Course EMI & Seats, Access at Risk | View revenue |
| Staff & Roles | Manage staff |

## Inside SMS Mission Control: Super-Admin-only actions
Anyone with **Send SMS** can view the tabs, send to one person, view logs/analytics, retry, and export. But only a **Super Admin** can:
- Edit/save templates and DLT IDs
- Turn automations on/off
- Change Settings (caps, window, kill switch)
- Send in **bulk** or to **`Everyone (guarded)`**

## "I need access to something"
Ask a **Super Admin** to change your role or create a custom role on the **Staff & Roles** page. Permissions can be tailored.
