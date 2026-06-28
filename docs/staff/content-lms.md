# Content / LMS & Courses

These pages manage the learning material students see in their **Class Hub**, and the public course pages.

## Content / LMS Manager
**Menu:** `Academics` → `Content / LMS`  ·  **Web address:** `/admin/content`  ·  **Permission:** Manage courses.

Heading: `Content / LMS Manager`, subtitle `Assign recordings, notes, tests & CA to batches — they appear in students' Class Hub.`

Manages content items of these types: `Current Affairs`, `Prelims MCQs`, `Booklet`, `Recording`, `Live Class`, `PYQ Bank`, `Test Series`, `Answer Writing`, `Notes`, `Maps`.

- Filters: `Search title / subject…`, `All batches`, `All types`, `All subjects`, `All statuses`.
- **`+ Add Content`** opens a form. Key fields: type, `Subject`, `Title`, `Description`, `Assign to course(s) / batch(es)`, `Class / Session #`, `Paper (e.g. GS2)`, `Duration`, `Recording source` (`🔗 External link` or `⬆️ Upload video (hosted)`), `YouTube link` / `Google Drive link` / `Telegram link`, `Drip release date`, and `Publish now`.
- Each row has a `Live` / `Draft` toggle, `Edit`, and `Delete`.

**Recipe — add a recording to a batch:**
1. `+ Add Content` → pick type `Recording`.
2. Set `Subject`, `Title`, choose `Assign to course(s) / batch(es)`.
3. Choose `Recording source` and paste the link (or upload).
4. (Optional) set a `Drip release date`. Tick `Publish now` when ready.
5. Save (`Add Content`). It appears in those students' Class Hub.

## Course Manager
**Menu:** `Academics` → `Courses`  ·  **Web address:** `/admin/courses`  ·  **Permission:** Manage courses.

Heading: `Course Manager`, subtitle `Drag to reorder — this controls the order on the public Courses page`. Each course auto-creates a public page at `/courses/<slug>`.

- **`+ New Course`** to create. Per row: `View ↗`, `Edit`, `Enable`/`Disable`, `Delete`. Drag rows to reorder; status auto-saves (`Saving…` / `Saved`).
- The create/edit form tabs: `Basic Details`, `Pricing & Seats`, `Media`, `Rich Content`, `Reviews`, `After Registration`, `Access & Entitlements`, `SEO`, `Contact / WhatsApp`.
- Key fields: `Title`, `Category`, `Status` (`Draft (hidden)` / `Published (live)` / `Closed`), `Modes`, `Price — standard / total fee (₹)`, `Pay-in-Full price (₹)`, `Original price (₹)`, `Primary cover image`, `About (rich text)`, `Zoom / live-class link`, `Validity` (`Lifetime` / `Limited`).
- Save with `Create Course` / `Save Changes`.

## Brochure / Resources Library
**Menu:** `Academics` → `Brochure Library`  ·  **Web address:** `/admin/library`  ·  **Permission:** Manage PDFs & media.

Upload a PDF once and attach it to many courses/webinars. Fields: `Title`, `Category (optional)`, `Upload PDF` (or `Or paste PDF URL`). `Add to library`; per row `Open` / `Delete`.

## Subscription Plans
**Menu:** `Academics` → `Subscription Plans`  ·  **Web address:** `/admin/plans`  ·  **Permission:** Manage pricing.

Read-only view of membership plan cards. Status pills: `Razorpay linked` / `Link via env var`. Plans are configured in code/settings, not edited here.
