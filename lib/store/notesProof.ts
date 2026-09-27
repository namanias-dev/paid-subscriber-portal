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
  {
    id: "foreign-direct-investment",
    title: "Foreign Direct Investment (FDI)",
    productSlug: "economy",
    pageCount: 24,
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

/** Encoded portrait file from `notes-reels/IMG_7678_CURSOR_UPLOAD.mp4`. */
const ECONOMY_PHYSICAL_NOTES_VIDEO: PhysicalNotesVideo = {
  id: "physical-notes-economy",
  posterSrc: teachingVideoPublicSrc("physical-notes-economy", "poster.webp"),
  fullSrc: teachingVideoPublicSrc("physical-notes-economy", "full.mp4"),
  width: 720,
  height: 1290,
  enabled: true,
  ariaLabel: "Naman showing the printed Indian Economy notes that ship after an order",
};

const PHYSICAL_NOTES_BY_SLUG: Record<string, PhysicalNotesVideo> = {
  polity: PHYSICAL_NOTES_VIDEO,
  economy: ECONOMY_PHYSICAL_NOTES_VIDEO,
};

export function notesSampleForProduct(slug: string | null | undefined): NotesSampleAsset | null {
  if (!slug) return null;
  return NOTES_SAMPLE_ASSETS.find((sample) => sample.productSlug === slug) ?? null;
}

export function physicalNotesVideoForProduct(slug: string | null | undefined): PhysicalNotesVideo | null {
  if (!slug) return null;
  return PHYSICAL_NOTES_BY_SLUG[slug] ?? null;
}

export function defaultNotesSample(): NotesSampleAsset {
  const sample = notesSampleForProduct("polity");
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
}): boolean {
  return Boolean(notesSampleForProduct(product.slug) || notesSampleForProduct(product.category_slug));
}

export function proofAttribution(product: NotesProofProduct | null, extra: Record<string, string | number | boolean | null> = {}) {
  return {
    product_id: product?.id ?? null,
    slug: product?.slug ?? null,
    subject: product?.subject ?? null,
    ...extra,
  };
}
