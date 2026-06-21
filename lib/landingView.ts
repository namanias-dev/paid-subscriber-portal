import { sanitizeHtml } from "./sanitizeHtml";
import { parseVideo, type ParsedVideo } from "./videoEmbed";
import type {
  Course,
  Webinar,
  Review,
  LearnItem,
  PageSection,
  SeatConfig,
  WhatsAppConfig,
  MentorInfo,
  VideoPlacement,
} from "./types";

export interface LandingVideo extends ParsedVideo {
  title?: string | null;
  subtitle?: string | null;
  placement: VideoPlacement;
}

export interface LandingSection extends PageSection {
  contentHtml: string;
}

export interface LandingMentor extends MentorInfo {
  bioHtml: string;
}

/**
 * Pre-built, serializable view-model for the premium landing layout. All HTML
 * is re-sanitized here (server) so client components can render it directly via
 * dangerouslySetInnerHTML without pulling a sanitizer into the public bundle.
 */
export interface LandingView {
  aboutHtml: string;
  video: LandingVideo | null;
  learn: LearnItem[];
  whoShouldAttend: string[];
  whatYouGet: LearnItem[];
  reviews: Review[];
  ratingAvg: number | null;
  ratingCount: number;
  mentor: LandingMentor | null;
  sections: LandingSection[];
  seat: SeatConfig | null;
  whatsapp: WhatsAppConfig | null;
}

function cleanLearn(items?: LearnItem[]): LearnItem[] {
  return (items || []).filter((i) => i?.title?.trim());
}

export function buildLandingView(item: Course | Webinar): LandingView {
  const aboutHtml = sanitizeHtml(item.about_html);

  // Video
  let video: LandingVideo | null = null;
  const vc = item.video_config;
  if (vc?.show && vc.url?.trim()) {
    const parsed = parseVideo(vc.url);
    if (parsed && parsed.kind !== "unknown") {
      video = {
        ...parsed,
        title: vc.title || null,
        subtitle: vc.subtitle || null,
        placement: vc.placement || "before_about",
      };
    }
  }

  // Reviews (visible, sorted, aggregate)
  const reviews = (item.reviews || [])
    .filter((r) => r?.visible !== false && r?.name?.trim() && r?.text?.trim())
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const ratingCount = reviews.length;
  const ratingAvg = ratingCount
    ? Math.round((reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / ratingCount) * 10) / 10
    : null;

  // Mentor
  let mentor: LandingMentor | null = null;
  const m = item.mentor;
  if (m && (m.name?.trim() || m.bio?.trim() || m.image_url?.trim())) {
    mentor = { ...m, bioHtml: sanitizeHtml(m.bio) };
  }

  // Flexible sections
  const sections: LandingSection[] = (item.sections || [])
    .filter((s) => s?.visible !== false && s?.title?.trim())
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s) => ({ ...s, contentHtml: sanitizeHtml(s.content) }));

  // Seats
  const seat = item.seat_config?.show ? item.seat_config : null;

  // WhatsApp (only when there is a usable number)
  const wc = item.whatsapp_config;
  const whatsapp = wc && (wc.whatsapp?.trim() || wc.phone?.trim()) ? wc : null;

  return {
    aboutHtml,
    video,
    learn: cleanLearn(item.what_you_learn),
    whoShouldAttend: (item.who_should_attend || []).filter((s) => s?.trim()),
    whatYouGet: cleanLearn(item.what_you_get),
    reviews,
    ratingAvg,
    ratingCount,
    mentor,
    sections,
    seat,
    whatsapp,
  };
}
