/**
 * Lightweight Fast Origin Transfer diagnostics for public `/media/*`.
 *
 * Does not download object bodies. Used by `/api/ops/media-cost-probe` and
 * the cost audit so production can confirm whether bytes still leave Vercel
 * origin instead of a path-scoped Cloudflare media CDN.
 */

import { mediaCdnBase } from "@/lib/publicMediaUrl";
import { teachingVideoObjectKey, listEnabledTeachingVideos } from "@/lib/store/teachingVideos";
import {
  NOTES_SAMPLE_ASSETS,
  PHYSICAL_NOTES_VIDEO,
  physicalNotesVideoForProduct,
  samplePageObjectKey,
} from "@/lib/store/notesProof";

export interface MediaCatalogueEntry {
  id: string;
  key: string;
  kind: "teaching_full" | "teaching_preview" | "teaching_poster" | "physical_full" | "sample_page" | "sample_pdf";
}

/** Public store media most likely to dominate Fast Origin Transfer. */
export function listBandwidthCriticalMediaKeys(): MediaCatalogueEntry[] {
  const out: MediaCatalogueEntry[] = [];
  for (const video of listEnabledTeachingVideos()) {
    out.push(
      { id: video.id, key: teachingVideoObjectKey(video.id, "full.mp4"), kind: "teaching_full" },
      { id: video.id, key: teachingVideoObjectKey(video.id, "preview.mp4"), kind: "teaching_preview" },
      { id: video.id, key: teachingVideoObjectKey(video.id, "poster.webp"), kind: "teaching_poster" },
    );
  }
  const physical = [
    PHYSICAL_NOTES_VIDEO,
    physicalNotesVideoForProduct("economy"),
    physicalNotesVideoForProduct("modern-history"),
  ].filter((v): v is NonNullable<typeof v> => !!v && v.enabled);
  for (const video of physical) {
    out.push({ id: video.id, key: teachingVideoObjectKey(video.id, "full.mp4"), kind: "physical_full" });
  }
  for (const sample of NOTES_SAMPLE_ASSETS) {
    out.push({ id: sample.id, key: samplePageObjectKey(sample.id, 1), kind: "sample_page" });
    if (sample.pdfSrc) {
      out.push({
        id: sample.id,
        key: `media/store/samples/${sample.id}/sample.pdf`,
        kind: "sample_pdf",
      });
    }
  }
  return out;
}

export function mediaCdnConfigured(): boolean {
  return mediaCdnBase().length > 0;
}

export function interpretVercelCacheHeader(value: string | null | undefined): "HIT" | "MISS" | "STALE" | "OTHER" | "ABSENT" {
  const v = (value || "").trim().toUpperCase();
  if (!v) return "ABSENT";
  if (v.includes("HIT")) return "HIT";
  if (v.includes("MISS")) return "MISS";
  if (v.includes("STALE")) return "STALE";
  return "OTHER";
}

/** Rough GB if every catalogue full/preview object were transferred once through origin. */
export function estimateCatalogueGb(sizesBytes: number[]): number {
  const total = sizesBytes.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return total / (1024 * 1024 * 1024);
}
