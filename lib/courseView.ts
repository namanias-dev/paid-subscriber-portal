import { batchModes, batchTimings } from "./installments";
import type { Course } from "./types";

/**
 * Shared, display-only summary of a course's batch offerings. Single source of
 * truth for the batch-aware presentation on BOTH the listing card (CourseCard)
 * and the detail page (CourseDetail), so they stay consistent.
 *
 * For a course with 0/1 batch this reports `multiBatch: false` and the caller
 * keeps using the course-level fields exactly as before (no behaviour change).
 * For 2+ batches it unions the per-batch mode/timing/start and reports whether
 * prices differ (so a "From <lowest>" price can be shown). It NEVER affects
 * pricing/checkout — it only derives what to display.
 */
export interface CourseOfferingSummary {
  multiBatch: boolean;
  /** Union of modes across batches (multi-batch only; empty otherwise). */
  modes: string[];
  /** Union of timings across batches (multi-batch only; empty otherwise). */
  timings: string[];
  /** Unique batch start dates (multi-batch only). */
  starts: string[];
  /** The single shared start when every batch starts together, else null. */
  sharedStart: string | null;
  /** True when batches genuinely differ in price (so show "From <min>"). */
  priceVaries: boolean;
  /** Lowest batch price when prices vary, else the course-level price. */
  displayPrice: number;
}

export function courseOfferingSummary(course: Course): CourseOfferingSummary {
  const batches = course.batches || [];
  const multiBatch = batches.length >= 2;
  if (!multiBatch) {
    return {
      multiBatch: false,
      modes: [],
      timings: [],
      starts: [],
      sharedStart: course.batch_start ?? null,
      priceVaries: false,
      displayPrice: course.price,
    };
  }
  const modes = Array.from(new Set(batches.flatMap((b) => batchModes(b))));
  const timings = Array.from(new Set(batches.flatMap((b) => batchTimings(b))));
  const starts = Array.from(new Set(batches.map((b) => b.start_date).filter((s): s is string => !!s)));
  const batchPrices = batches.map((b) => b.price).filter((n): n is number => typeof n === "number");
  const priceVaries = batchPrices.length > 1 && new Set(batchPrices).size > 1;
  return {
    multiBatch: true,
    modes,
    timings,
    starts,
    sharedStart: starts.length === 1 ? starts[0] : null,
    priceVaries,
    displayPrice: priceVaries ? Math.min(...batchPrices) : course.price,
  };
}
