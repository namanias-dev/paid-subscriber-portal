/**
 * "What's New" aggregator — computes the homepage announcement feed ON-READ
 * from LIVE data so it can never go stale:
 *   • latest published Resources (guides/articles/blogs)
 *   • newest downloadable PDFs (ca_pdfs with a file)
 *   • upcoming webinars whose registration is OPEN (lifecycle-derived)
 *   • published course batches with open enrollment / seats
 *   • admin-pinned manual announcements (within their active date window)
 *
 * Expired/closed items are excluded by construction. Pure aggregation over the
 * existing verified data layer — no new access rules.
 */
import {
  getPublicResources,
  getPublicDownloadablePdfs,
  getPublicWebinars,
  getPublishedCourses,
  getActiveAnnouncements,
} from "./dataProvider";
import { effectiveRegStatus, hasWebinarEnded } from "./webinarLifecycle";

export type WhatsNewKind = "pinned" | "webinar" | "batch" | "article" | "download";

export interface WhatsNewItem {
  id: string;
  kind: WhatsNewKind;
  title: string;
  href: string;
  /** Short contextual label (e.g. "Live webinar", "Open batch", "New PDF"). */
  label: string;
  /** Optional external link (open in new tab). */
  external?: boolean;
  /** Sort timestamp (ms). */
  ts: number;
}

export interface WhatsNew {
  /** Items for the slim rotating top bar (pinned first, then fresh highlights). */
  barItems: WhatsNewItem[];
  /** Grouped cards for the "What's New" homepage section. */
  webinars: WhatsNewItem[];
  batches: WhatsNewItem[];
  articles: WhatsNewItem[];
  downloads: WhatsNewItem[];
  hasAny: boolean;
}

const EMPTY: WhatsNew = { barItems: [], webinars: [], batches: [], articles: [], downloads: [], hasAny: false };

function ms(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Build the full "What's New" feed. Best-effort: never throws to the page. */
export async function getWhatsNew(limitPerGroup = 4): Promise<WhatsNew> {
  try {
    const [resources, pdfs, webinars, courses, pinned] = await Promise.all([
      getPublicResources(),
      getPublicDownloadablePdfs(),
      getPublicWebinars(),
      getPublishedCourses(),
      getActiveAnnouncements(),
    ]);
    const now = Date.now();

    const pinnedItems: WhatsNewItem[] = pinned.map((a) => ({
      id: `pin-${a.id}`,
      kind: "pinned",
      title: a.title,
      href: a.href || "#",
      label: a.badge || "New",
      external: !!a.href && /^https?:\/\//i.test(a.href),
      ts: ms(a.updated_at) || ms(a.created_at) || now,
    }));

    const webinarItems: WhatsNewItem[] = webinars
      .filter((w) => w.status !== "completed" && effectiveRegStatus(w) === "OPEN" && !hasWebinarEnded(w))
      .sort((a, b) => ms(a.datetime) - ms(b.datetime)) // soonest first
      .slice(0, limitPerGroup)
      .map((w) => ({
        id: `web-${w.id}`,
        kind: "webinar",
        title: w.title,
        href: `/webinars/${w.slug}`,
        label: "Live webinar",
        ts: ms(w.datetime) || now,
      }));

    const batchItems: WhatsNewItem[] = courses
      .filter((c) => c.status === "published" && c.active !== false && (c.seats_left == null || c.seats_left > 0))
      .sort((a, b) => (b.featured === a.featured ? ms(b.created_at) - ms(a.created_at) : b.featured ? 1 : -1))
      .slice(0, limitPerGroup)
      .map((c) => ({
        id: `bat-${c.id}`,
        kind: "batch",
        title: c.title,
        href: `/courses/${c.slug}`,
        label: c.seats_left != null && c.seats_left > 0 ? `${c.seats_left} seats left` : "Open batch",
        ts: ms(c.created_at) || now,
      }));

    const articleItems: WhatsNewItem[] = [...resources]
      .sort((a, b) => ms(b.publish_at || b.created_at) - ms(a.publish_at || a.created_at))
      .slice(0, limitPerGroup)
      .map((r) => ({
        id: `art-${r.id}`,
        kind: "article",
        title: r.title,
        href: `/resources/${r.slug}`,
        label: "New guide",
        ts: ms(r.publish_at || r.created_at) || now,
      }));

    const downloadItems: WhatsNewItem[] = pdfs.slice(0, limitPerGroup).map((p) => ({
      id: `dl-${p.id}`,
      kind: "download",
      title: p.title,
      href: "/resources/downloads",
      label: "New PDF",
      ts: ms(p.date_ref) || ms(p.created_at) || now,
    }));

    // Bar: pinned first, then the single freshest item from each auto group,
    // capped to 5 to keep it slim.
    const freshest = [webinarItems[0], batchItems[0], articleItems[0], downloadItems[0]].filter(Boolean) as WhatsNewItem[];
    const barItems = [...pinnedItems, ...freshest].slice(0, 5);

    const hasAny =
      barItems.length > 0 ||
      webinarItems.length > 0 ||
      batchItems.length > 0 ||
      articleItems.length > 0 ||
      downloadItems.length > 0;

    return {
      barItems,
      webinars: webinarItems,
      batches: batchItems,
      articles: articleItems,
      downloads: downloadItems,
      hasAny,
    };
  } catch {
    return EMPTY;
  }
}
