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

## Orientation / starter videos (upload once, use in many)

An **orientation** (or **starter**) video is the welcome/intro video a student sees in the **After Registration** section after they enrol in a course or register for a webinar. You upload it **once** into the Content library and then **assign** it to as many courses and webinars as you like — there is no re-uploading and no duplicate copies. Editing the video once updates it everywhere it's used.

There are **two ways** to set this up — both create the same shared link:

**A. From the Content tab (assign one video to many places):**
1. `Content / LMS` → `+ Add Content` (or `Edit` an existing `Recording` / `Live Class`).
2. Fill in the video as usual (title + YouTube/Drive link, or upload a hosted video).
3. In the gold **`Use as orientation / starter video`** box, choose the role (`Orientation` or `Starter`) and **tick every course and webinar** it should appear in.
4. Save. The video now shows in the After-Registration section of each ticked course/webinar.

**B. From a Course or Webinar (pick existing library videos):**
1. Open the course (`Academics` → `Courses` → `Edit`) or webinar (`Academics` → `Webinars` → `Edit`) and go to the **`After Registration`** tab.
2. Under **`Orientation & starter videos`**, click **`+ Add from Content library`** and search for the video by title/subject, then click it to link.
3. Set each video's role (`Orientation` / `Starter`) and use the **▲ / ▼** arrows to order them.
4. Changes here **save instantly** (you don't need to press the course/webinar Save button for the video links).

**Ordering:** the ▲ / ▼ arrows in the After-Registration picker control the order students see the videos in.

**⚠️ Removing vs deleting:**
- **Remove** in a course/webinar picker only **unlinks** the video from *that one* course/webinar. The video stays in the library and in every other course/webinar using it.
- **Delete** in the Content tab removes the actual library video. If it's still assigned somewhere you'll get a warning telling you how many courses/webinars will lose it.

**Who sees them:** orientation/starter videos follow the **same access rules** as the rest of After-Registration content — only registered/enrolled (or staff-comp) students see them. They are **not** a free pre-purchase preview.

**Note on "One-off video URLs (legacy)":** the small editor below the library picker is for pasting a single YouTube URL that isn't in the library. Prefer the library picker so the video can be reused. Existing inline orientation videos were automatically migrated into the library, so they now appear in the picker.

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
