/**
 * Notes Store teaching-video catalogue.
 *
 * Config-driven on purpose: adding another classroom clip is one metadata
 * entry plus encoded R2 derivatives. No new database, no Instagram embed, no
 * Stream account. Public bytes live under the existing `media/` prefix so
 * `/media/...` and the R2 CDN keep serving them like product photos.
 */
import { stablePublicMediaUrl } from "@/lib/publicMediaUrl";

export interface TeachingVideo {
  id: string;
  title?: string;
  eyebrow?: string;
  posterSrc: string;
  previewSrc: string;
  fullSrc: string;
  captionsSrc?: string;
  viewLabel?: string;
  durationSeconds?: number;
  ariaLabel: string;
  enabled: boolean;
  order: number;
  width: number;
  height: number;
  previewStartSec: number;
  posterTimeSec: number;
}

export const TEACHING_VIDEO_PREFIX = "store/videos";

export function teachingVideoObjectKey(id: string, file: string): string {
  return `media/${TEACHING_VIDEO_PREFIX}/${id}/${file}`;
}

export function teachingVideoPublicSrc(id: string, file: string): string {
  return stablePublicMediaUrl(`${TEACHING_VIDEO_PREFIX}/${id}/${file}`);
}

/**
 * Catalogue is sourced from the owner's `notes-reels/` masters in R2.
 * Public bytes stay under `media/store/videos/<id>/` so `/media/...` can
 * serve them. viewLabel is allowed only on the first clip — the owner
 * confirmed ~1.6M Instagram views for that reel only.
 */
export const TEACHING_VIDEOS: TeachingVideo[] = [
  {
    id: "naman-sir-teaches-01",
    ariaLabel: "Naman Sir teaching actual GDP growth with handwritten notes",
    viewLabel: "1.6M+ VIEWS",
    posterSrc: teachingVideoPublicSrc("naman-sir-teaches-01", "poster.webp"),
    previewSrc: teachingVideoPublicSrc("naman-sir-teaches-01", "preview.mp4"),
    fullSrc: teachingVideoPublicSrc("naman-sir-teaches-01", "full.mp4"),
    enabled: true,
    order: 10,
    width: 720,
    height: 1280,
    durationSeconds: 179,
    previewStartSec: 6.5,
    posterTimeSec: 8.5,
  },
  {
    id: "naman-sir-teaches-02",
    ariaLabel: "Naman Sir teaching the Joint Parliamentary Committee and the FCRA Bill",
    posterSrc: teachingVideoPublicSrc("naman-sir-teaches-02", "poster.webp"),
    previewSrc: teachingVideoPublicSrc("naman-sir-teaches-02", "preview.mp4"),
    fullSrc: teachingVideoPublicSrc("naman-sir-teaches-02", "full.mp4"),
    enabled: true,
    order: 20,
    width: 720,
    height: 1280,
    durationSeconds: 179,
    previewStartSec: 32,
    posterTimeSec: 35,
  },
  {
    id: "naman-sir-teaches-03",
    ariaLabel: "Naman Sir teaching population and foundational values of civil services",
    posterSrc: teachingVideoPublicSrc("naman-sir-teaches-03", "poster.webp"),
    previewSrc: teachingVideoPublicSrc("naman-sir-teaches-03", "preview.mp4"),
    fullSrc: teachingVideoPublicSrc("naman-sir-teaches-03", "full.mp4"),
    enabled: true,
    order: 30,
    width: 720,
    height: 1280,
    durationSeconds: 180,
    previewStartSec: 16,
    posterTimeSec: 90,
  },
];

export function listEnabledTeachingVideos(): TeachingVideo[] {
  return TEACHING_VIDEOS.filter((video) => video.enabled).sort((a, b) => a.order - b.order);
}

export function teachingAspectRatio(video: Pick<TeachingVideo, "width" | "height">): string {
  return `${video.width} / ${video.height}`;
}
