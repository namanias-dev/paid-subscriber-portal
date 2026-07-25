"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A hand-rolled row window. No virtualization dependency is added — the repo
 * has none and this needs about forty lines.
 *
 * WHY WINDOWING IS NEEDED AT ALL
 * ------------------------------
 * Pages ACCUMULATE. Load-more appends the next keyset page to the rows already
 * on screen, because a counsellor working the re-engagement queue scrolls a
 * continuous list rather than flipping through pages. At 100 rows a page that
 * reaches four figures quickly, and a `<tr>` with twelve cells is not cheap:
 * painting 3,000 of them stalls the main thread for seconds on the laptops this
 * portal actually runs on.
 *
 * HOW IT WORKS
 * ------------
 * One scroll container of known height, one FIXED row height, and two spacer
 * rows. Only `[startIndex, endIndex)` is mounted; the spacers above and below
 * carry the remaining height so the scrollbar is the true length of the list
 * and native scrolling, keyboard paging and the browser's own scroll anchoring
 * all keep working. `overscan` rows are mounted beyond each edge so a fast
 * flick does not expose blank space.
 *
 * The fixed row height is the load-bearing assumption. Cells in this table are
 * single-line and `overflow-hidden`, and the row height is applied as an
 * inline style, so a long value truncates instead of reflowing the row and
 * desynchronising every offset below it.
 */

/** Used before the container has been measured, and if measurement fails. */
const FALLBACK_VIEWPORT_PX = 640;

export interface RowWindow {
  /** Attach to the scroll container. */
  scrollRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Attach to the scroll container's `onScroll`. */
  onScroll: () => void;
  /** First mounted row index (inclusive). */
  startIndex: number;
  /** Last mounted row index (exclusive). */
  endIndex: number;
  /** Spacer height above the mounted rows, in px. */
  padTop: number;
  /** Spacer height below the mounted rows, in px. */
  padBottom: number;
  /** Jump back to the top — used when the query changes and rows reset. */
  scrollToTop: () => void;
}

export function useWindowedRows(params: {
  count: number;
  rowHeight: number;
  overscan?: number;
}): RowWindow {
  const { count, rowHeight, overscan = 8 } = params;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT_PX);

  // Measure before paint so the very first frame mounts the right rows.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || FALLBACK_VIEWPORT_PX);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll events fire far faster than we can usefully re-render, so collapse
  // a burst into one state update per animation frame.
  const onScroll = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const el = scrollRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const scrollToTop = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
    setScrollTop(0);
  }, []);

  const visibleCount = Math.ceil(viewport / rowHeight) + overscan * 2;
  const rawStart = Math.floor(scrollTop / rowHeight) - overscan;
  const startIndex = count === 0 ? 0 : Math.min(Math.max(0, rawStart), Math.max(0, count - 1));
  const endIndex = Math.min(count, startIndex + visibleCount);

  return {
    scrollRef,
    onScroll,
    startIndex,
    endIndex,
    padTop: startIndex * rowHeight,
    padBottom: Math.max(0, (count - endIndex) * rowHeight),
    scrollToTop,
  };
}
