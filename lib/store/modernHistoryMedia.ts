/**
 * Allowlisted Modern History public media keys.
 * Masters stay at notes-reels/; public bytes live under media/ like Polity/Economy.
 */
import { MODERN_HISTORY_PRODUCT_ID } from "./modernHistoryLaunch";

export const MODERN_HISTORY_VIDEO_SOURCE_KEY = "notes-reels/IMG_8005_CURSOR_UPLOAD.mp4";
export const MODERN_HISTORY_VIDEO_ID = "physical-notes-modern-history";
export const MODERN_HISTORY_SAMPLE_ID = "modern-history-sample";

export const MODERN_HISTORY_COVER_KEY = `media/store/products/${MODERN_HISTORY_PRODUCT_ID}/cover.webp`;
export const MODERN_HISTORY_THUMB_KEY = `media/store/products/${MODERN_HISTORY_PRODUCT_ID}/thumb.webp`;
export const MODERN_HISTORY_SAMPLE_PDF_KEY = `media/store/samples/${MODERN_HISTORY_SAMPLE_ID}/sample.pdf`;
export const MODERN_HISTORY_VIDEO_FULL_KEY = `media/store/videos/${MODERN_HISTORY_VIDEO_ID}/full.mp4`;
export const MODERN_HISTORY_VIDEO_POSTER_KEY = `media/store/videos/${MODERN_HISTORY_VIDEO_ID}/poster.webp`;

const SAMPLE_PAGE = new RegExp(
  `^media/store/samples/${MODERN_HISTORY_SAMPLE_ID}/page-\\d{2}\\.webp$`,
);

export function modernHistorySamplePageKey(page: number): string {
  return `media/store/samples/${MODERN_HISTORY_SAMPLE_ID}/page-${String(page).padStart(2, "0")}.webp`;
}

/** True only for the public MH keys this ingest may sign or write. */
export function isModernHistoryPublicMediaKey(key: string): boolean {
  const k = (key || "").replace(/^\/+/, "").split("?")[0];
  return (
    k === MODERN_HISTORY_COVER_KEY ||
    k === MODERN_HISTORY_THUMB_KEY ||
    k === MODERN_HISTORY_SAMPLE_PDF_KEY ||
    k === MODERN_HISTORY_VIDEO_FULL_KEY ||
    k === MODERN_HISTORY_VIDEO_POSTER_KEY ||
    SAMPLE_PAGE.test(k)
  );
}
