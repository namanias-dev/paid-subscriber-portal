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

## Video protection (downloads disabled + per-student watermark)

For **uploaded (hosted) lecture and orientation videos**, the student player is hardened against casual piracy:

- **No download button.** The player's download control is removed and right-click "Save video as" is blocked. Picture-in-Picture and "cast to device" are disabled too.
- **No shareable link.** Videos stream from a **short-lived signed URL** that is created only after we re-check the student is enrolled. The raw file address never appears in the page and a copied link **stops working within ~30 minutes**, so it can't be passed around.
- **Per-student moving watermark.** A faint label showing the **student's name + phone** and a **live clock** floats over the video and moves every few seconds. If anyone screen-records and leaks a lecture, the watermark identifies exactly which account did it.

⚠️ These are strong deterrents, **not** unbreakable DRM — a determined person can still point a phone camera at the screen. True "black screen on screen-record" protection needs a dedicated DRM video platform (e.g. VdoCipher); see the engineering notes if we ever want to evaluate that.

**Note:** orientation/welcome videos added as plain **YouTube/Drive links** are hosted by YouTube/Google, so their own download rules apply — only videos you **upload** into our library get the protections above.

## Storage cleanup (deleting recordings & reclaiming space)

Uploaded videos are stored in our Cloudflare R2 bucket. To avoid paying for files nobody can see:

- **Deleting a recording removes the video file too.** When you delete a hosted recording in **Content / LMS**, we delete the database record **and** its underlying R2 video (plus thumbnail/notes) so storage is reclaimed. If a file fails to delete, it's **logged** (in `storage_audit_log`) and the response warns you — it's never silently left behind.
- **Cancelling an upload cleans up after itself.** Aborting/deleting a half-finished or finished upload also removes any bytes already stored.
- **No "ghost" files on upload.** The database record is always created **before** the video is uploaded, so an upload can't leave a file with no admin-visible row.

### Orphan-cleanup tool (for engineers)

If older files ever get stranded (e.g. from before this safeguard existed), there's a safe reconciliation tool — **dry-run first, delete only with explicit confirmation**:

- **In-app (super-admin):** `GET /api/admin/lectures/orphans` returns a dry-run report (orphans + reclaimable MB + any dangling references). `POST` with `{ "confirm": "DELETE" }` reclaims them. It re-scans server-side and never deletes a file that still belongs to a live recording. Payment-proof files are never touched.
- **Command line:** `node scripts/r2-orphans.mjs` (dry-run) → `node scripts/r2-orphans.mjs --apply` (delete). Needs the R2 + Supabase service-role env vars.

> History: a one-time cleanup on 29 June reclaimed **~421 MB** of two orphaned `lecture.mp4` files left over from a ~1-hour window on 25 June (before delete-cascade existed). The bucket is now clean.

## Recording details: subject, thumbnail, date & faculty

When you **Add / Edit Content** for a recording or live class, you can now set extra details that make the student's Class Hub look premium and organised:

- **Subject** — pick from the dropdown (Polity, Economy, Geography, …). This drives the **subject folders** students see (see below). Recordings without a subject are grouped under **"General"** — nothing breaks, they just sit together.
- **Topic / Paper** — free text (e.g. "GS2", "Fundamental Rights").
- **Lecture date** — the class date (used for ordering and the "latest lecture" shown on folders).
- **Class / Session #** — orders recordings (Class 1, 2, 3…).
- **Faculty (optional)** — the teacher's name; shown on the card and searchable.
- **Thumbnail (optional)** — upload a custom cover image. **Never required:**
  - **YouTube** recordings auto-use the YouTube thumbnail.
  - **Uploaded (hosted)** videos use your custom thumbnail if you add one.
  - Anything without a thumbnail gets a **premium branded fallback** (navy/gold with the academy name + lecture title) — students never see a blank dark box.

⚠️ None of these change who can watch — access rules are unchanged. Locked recordings stay locked (students see the cover + a "Locked" note, but no playable video).

## Subject folders in the Class Hub (student view)

In a batch's **Recordings** and **Notes & Material** tabs, when there are **several subjects**, students first see clean **subject folders** (Polity, History, …) showing the lecture count, latest date and how many they've completed. Clicking a folder opens that subject's lectures with a **breadcrumb** (e.g. *Recordings → Polity*) and a **back to all subjects** link. Search inside an open folder only searches that subject. If a tab has just one subject or only a couple of items, students see a simple flat list instead — no unnecessary folders.

The folders read the **same Subject** you set on each item, so the admin and the student view never drift. On mobile the four batch tabs (**Recordings · Notes & Material · Current Affairs & More · Quizzes**) show as a tidy 2×2 grid. *(The old "My Performance" tab is now simply labelled **Quizzes** — the dashboard inside it is unchanged.)*

## Lecture Q&A (comments + faculty answers)

Under each uploaded lecture/recording (the `/lecture/...` watch page in the student Class Hub) there's a **Questions & discussion** thread.

**Who can see/post:** only students **enrolled in that course** (the same access rule as watching the video). Non-enrolled users see nothing. Everyone enrolled sees all questions on that lecture, so students learn from each other.

**How students use it:** type a question and press **`Post`**. They can **Reply** to a comment (one level deep, like YouTube) and **Edit/Delete their own** comment for **15 minutes** after posting.

**How staff reply:** open the lecture and reply in the thread, **or** use the dedicated queue (below). Staff replies show a **`Faculty`** badge (or **`Admin`** for admin/super-admin roles), are highlighted, and automatically mark the question **Answered**. The student is notified (SMS) if reply notifications are configured.

**Moderation (staff with Manage courses permission):** on any comment you can **Pin** it to the top, **Hide** it (soft-delete — it's kept in the database, never lost), **Mark answered/unmark**, and edit. Nothing is ever hard-deleted.

### Unanswered-questions queue
**Menu:** `Academics` → `Lecture Q&A`  ·  **Web address:** `/admin/lecture-comments`  ·  **Permission:** Manage courses.

Shows **every unanswered student question across all lectures**, **oldest first**, so nothing gets buried per-video. A red **count** shows how many are open; **filter chips** narrow to one course. For each question you can **Reply** (resolves it + notifies the student), **Mark answered**, **Pin**, **Hide**, or **Open lecture ↗**. Answered questions drop off the queue automatically.

⚠️ Comments are stored as plain text — any pasted HTML/script shows as text and never runs.

> **Enabling SMS reply notifications (optional):** set the `SMS_LECTURE_REPLY_TEMPLATE_ID` environment variable to a registered DLT template id (and have SMS enabled). Until then, replies still work and resolve the thread — they just don't send an SMS. Notifications are idempotent (one SMS per reply).

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
