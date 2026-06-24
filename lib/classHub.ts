import type { ContentItem, ContentType, ClassHubView } from "./types";
import type { QuizAttemptStatus } from "./quizAttemptStatus";
import { CONTENT_META } from "./contentMeta";

/**
 * ============================================================================
 *  CLASS HUB ASSEMBLY — pure, serializable grouping of a batch's content into
 *  premium sections, with drip/locked states and per-student "NEW" flags.
 *  No DB access here; the page supplies content + views + unlocked quizzes.
 * ============================================================================
 */

export type ClassHubSectionId = "recordings" | "notes" | "tests" | "ca";

export const CLASS_HUB_SECTIONS: {
  id: ClassHubSectionId;
  label: string;
  empty: string;
}[] = [
  { id: "recordings", label: "Recordings", empty: "Recordings will appear here after each class." },
  { id: "notes", label: "Notes & Material", empty: "Notes, booklets and maps will appear here." },
  { id: "tests", label: "Tests & Quizzes", empty: "Tests and quizzes assigned to your batch will appear here." },
  { id: "ca", label: "Current Affairs & More", empty: "Current affairs, PYQs and answer writing will appear here." },
];

const SECTION_FOR_TYPE: Record<ContentType, ClassHubSectionId> = {
  recording: "recordings",
  live_link: "recordings",
  notes: "notes",
  booklet: "notes",
  maps: "notes",
  mcq: "tests",
  test_series: "tests",
  current_affairs: "ca",
  pyq: "ca",
  answer_writing: "ca",
};

export interface ClassHubItem {
  id: string;
  title: string;
  subject: string | null;
  type: ContentType;
  typeLabel: string;
  classNo: number | null;
  date: string | null;
  /** External link (YouTube/Drive/Telegram or a quiz route). Null when locked. */
  link: string | null;
  /** Whether to open in a new tab (external) vs internal nav (quizzes). */
  external: boolean;
  action: string;
  /** Future drip — visible as "Unlocks on …" but not openable yet. */
  locked: boolean;
  unlockOn: string | null;
  isNew: boolean;
  /** For quiz items: slug + the learner's attempt status (✓ Attempted + report/PDF). */
  quizSlug?: string | null;
  attempt?: QuizAttemptStatus | null;
}

export interface ClassHubSection {
  id: ClassHubSectionId;
  label: string;
  empty: string;
  items: ClassHubItem[];
  newCount: number;
}

/** A quiz unlocked by the course, surfaced inside the Tests section. */
export interface ClassHubQuizInput {
  id: string;
  title: string;
  slug: string;
  subject: string | null;
  created_at: string;
  attempt?: QuizAttemptStatus | null;
}

function firstLink(item: ContentItem): string | null {
  return item.youtube_link || item.drive_link || item.telegram_link || null;
}

/** When an item became available to a student: max(created, drip) — used for NEW. */
function availableAtMs(item: ContentItem): number {
  const created = Date.parse(item.created_at) || 0;
  const drip = item.drip_date ? Date.parse(item.drip_date) || 0 : 0;
  return Math.max(created, drip);
}

/** Drip in the future = locked (visible but not yet openable). */
function isDripLocked(item: ContentItem, nowMs: number): boolean {
  if (!item.drip_date) return false;
  const t = Date.parse(item.drip_date);
  return Number.isFinite(t) && t > nowMs;
}

/**
 * Build the ordered, gated, NEW-flagged Class Hub sections for one batch.
 * `views` are this student's last-seen rows (any course); we read the matching
 * course rows. A null studentId (edge) simply yields no NEW flags.
 */
export function assembleClassHubSections(opts: {
  items: ContentItem[];
  quizzes?: ClassHubQuizInput[];
  courseId: string;
  views: ClassHubView[];
  now?: number;
}): ClassHubSection[] {
  const { items, quizzes = [], courseId, views, now = Date.now() } = opts;

  const lastSeen = new Map<string, number>();
  for (const v of views) {
    if (v.course_id === courseId) lastSeen.set(v.section, Date.parse(v.last_seen_at) || 0);
  }
  const seenFor = (s: ClassHubSectionId) => lastSeen.get(s) ?? 0;

  const buckets: Record<ClassHubSectionId, ClassHubItem[]> = {
    recordings: [], notes: [], tests: [], ca: [],
  };

  for (const item of items) {
    const section = SECTION_FOR_TYPE[item.type] ?? "notes";
    const locked = isDripLocked(item, now);
    const link = locked ? null : firstLink(item);
    const isNew = !locked && availableAtMs(item) > seenFor(section);
    buckets[section].push({
      id: item.id,
      title: item.title,
      subject: item.subject,
      type: item.type,
      typeLabel: CONTENT_META[item.type]?.label ?? item.type,
      classNo: item.class_no ?? null,
      date: item.date,
      link,
      external: true,
      action: item.type === "recording" || item.type === "live_link" ? "Watch" : CONTENT_META[item.type]?.action ?? "Open",
      locked,
      unlockOn: locked ? item.drip_date : null,
      isNew,
    });
  }

  // Course-unlocked quizzes flow into the Tests section (entitlement-gated route).
  for (const q of quizzes) {
    const isNew = (Date.parse(q.created_at) || 0) > seenFor("tests");
    buckets.tests.push({
      id: `quiz:${q.id}`,
      title: q.title,
      subject: q.subject,
      type: "test_series",
      typeLabel: "Quiz",
      classNo: null,
      date: q.created_at,
      link: `/quizzes/${q.slug}`,
      external: false,
      action: q.attempt ? "Re-attempt" : "Start Test",
      locked: false,
      unlockOn: null,
      isNew,
      quizSlug: q.slug,
      attempt: q.attempt ?? null,
    });
  }

  const dateMs = (s: string | null) => (s ? Date.parse(s) || 0 : 0);

  return CLASS_HUB_SECTIONS.map((def) => {
    const list = buckets[def.id];
    if (def.id === "recordings") {
      // Class-number ordering (Class 1, 2, …); untagged fall to the end by date.
      list.sort((a, b) => {
        if (a.classNo != null && b.classNo != null) return a.classNo - b.classNo;
        if (a.classNo != null) return -1;
        if (b.classNo != null) return 1;
        return dateMs(b.date) - dateMs(a.date);
      });
    } else {
      list.sort((a, b) => dateMs(b.date) - dateMs(a.date));
    }
    return {
      id: def.id,
      label: def.label,
      empty: def.empty,
      items: list,
      newCount: list.filter((i) => i.isNew).length,
    };
  });
}

/** Total NEW items across all sections for a course (entry-point dot). */
export function totalNewCount(sections: ClassHubSection[]): number {
  return sections.reduce((sum, s) => sum + s.newCount, 0);
}
