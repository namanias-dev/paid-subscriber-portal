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
 * First clip is reserved for the 1.6M-view classroom reel the owner attached.
 * `enabled` stays false until poster/preview/full derivatives are on R2 — the
 * landing page must never render a broken blank player.
 *
 * viewLabel is allowed only because the owner explicitly stated ~1.6M Instagram
 * views for this specific clip. Do not copy that number onto later videos.
 */
export const TEACHING_VIDEOS: TeachingVideo[] = [
  {
    id: "naman-sir-teaches-01",
    ariaLabel: "Naman Sir teaching a UPSC classroom concept",
    viewLabel: "1.6M+ VIEWS",
    posterSrc: teachingVideoPublicSrc("naman-sir-teaches-01", "poster.webp"),
    previewSrc: teachingVideoPublicSrc("naman-sir-teaches-01", "preview.mp4"),
    fullSrc: teachingVideoPublicSrc("naman-sir-teaches-01", "full.mp4"),
    captionsSrc: teachingVideoPublicSrc("naman-sir-teaches-01", "captions.vtt"),
    enabled: false,
    order: 10,
    width: 512,
    height: 910,
    previewStartSec: 0,
    posterTimeSec: 2.4,
  },
];

export function listEnabledTeachingVideos(): TeachingVideo[] {
  return TEACHING_VIDEOS.filter((video) => video.enabled).sort((a, b) => a.order - b.order);
}

export function teachingAspectRatio(video: Pick<TeachingVideo, "width" | "height">): string {
  return `${video.width} / ${video.height}`;
}
