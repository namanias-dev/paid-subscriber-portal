/**
 * See-before-you-buy proof assets.
 *
 * Public bytes only, under `media/`, served by the existing `/media` route.
 * No PDF file is sent to the browser. Pages are screen-sized WebP derivatives
 * of an already-watermarked sample.
 *
 * Add another sample by publishing
 *   media/store/samples/<id>/page-01.webp …
 * and appending one `NotesSampleAsset`.
 *
 * Physical-copy video (the single identifier to replace if the file moves):
 *   media/store/videos/physical-notes/poster.webp
 *   media/store/videos/physical-notes/full.mp4
 * Republish with `scripts/notes-proof-publish.mjs`.
 */
import { stablePublicMediaUrl } from "@/lib/publicMediaUrl";
import { teachingVideoPublicSrc } from "@/lib/store/teachingVideos";

export interface NotesSampleAsset {
  id: string;
  title: string;
  /** Canonical product slug this chapter belongs to. */
  productSlug: string;
  pageCount: number;
}

export interface NotesProofProduct {
  id: string;
  slug: string;
  subject: string | null;
  name: string;
  priceLabel: string;
  purchasable: boolean;
  statusLabel: string;
}

export interface PhysicalNotesVideo {
  id: string;
  posterSrc: string;
  fullSrc: string;
  width: number;
  height: number;
  enabled: boolean;
  ariaLabel: string;
}

export const NOTES_SAMPLE_PREFIX = "store/samples";

export const NOTES_SAMPLE_ASSETS: NotesSampleAsset[] = [
  {
    id: "anti-defection-law",
    title: "Anti-Defection Law",
    productSlug: "polity",
    pageCount: 23,
  },
];

/** Encoded portrait file from `notes-reels/IMG_7595_CURSOR_UPLOAD.mp4`. */
export const PHYSICAL_NOTES_VIDEO: PhysicalNotesVideo = {
  id: "physical-notes",
  posterSrc: teachingVideoPublicSrc("physical-notes", "poster.webp"),
  fullSrc: teachingVideoPublicSrc("physical-notes", "full.mp4"),
  width: 720,
  height: 1290,
  enabled: true,
  ariaLabel: "Naman showing the printed notes that ship after an order",
};

export function defaultNotesSample(): NotesSampleAsset {
  const sample = NOTES_SAMPLE_ASSETS[0];
  if (!sample) throw new Error("Notes proof sample is not configured");
  return sample;
}

export function samplePageObjectKey(sampleId: string, page: number): string {
  const n = String(page).padStart(2, "0");
  return `media/${NOTES_SAMPLE_PREFIX}/${sampleId}/page-${n}.webp`;
}

export function samplePageSrc(sampleId: string, page: number): string {
  const n = String(page).padStart(2, "0");
  return stablePublicMediaUrl(`${NOTES_SAMPLE_PREFIX}/${sampleId}/page-${n}.webp`);
}

export function isNotesProofProduct(product: {
  slug: string;
  category_slug?: string | null;
  subject?: string | null;
  name?: string;
  short_name?: string | null;
}): boolean {
  if (product.slug === "polity" || product.category_slug === "polity") return true;
  const blob = `${product.subject || ""} ${product.name || ""} ${product.short_name || ""}`.toLowerCase();
  return blob.includes("polity");
}

export function proofAttribution(product: NotesProofProduct | null, extra: Record<string, string | number | boolean | null> = {}) {
  return {
    product_id: product?.id ?? null,
    slug: product?.slug ?? null,
    subject: product?.subject ?? null,
    ...extra,
  };
}
