"use client";

import { useCallback, useEffect, useState } from "react";
import { trackClient } from "@/lib/analytics/client";
import type { StoreProductMedia } from "@/lib/store/catalogue";

export default function SampleViewer({
  samples,
  productId,
}: {
  samples: StoreProductMedia[];
  productId: string;
}) {
  const pages = samples.filter((s) => s.url);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const current = pages[index];

  const next = useCallback(() => setIndex((i) => (pages.length ? (i + 1) % pages.length : 0)), [pages.length]);
  const prev = useCallback(() => setIndex((i) => (pages.length ? (i - 1 + pages.length) % pages.length : 0)), [pages.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, prev]);

  if (!pages.length) {
    return (
      <div className="rounded-3xl border border-dashed border-[var(--ca-navy)]/15 bg-white px-5 py-8 text-sm text-[var(--ca-navy)]/55">
        Sample pages will appear here once this title has approved previews.
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {pages.slice(0, 3).map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setIndex(i);
              setOpen(true);
              trackClient("notes_sample_opened", { product_id: productId, sample_id: s.id });
            }}
            className="overflow-hidden rounded-2xl border border-[var(--ca-navy)]/10 bg-white ns-elev-1"
          >
            {/* Preview derivatives are app-routed; next/image remote patterns may not cover /api. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.url || ""} alt={s.alt || `Sample page ${s.source_page_no || i + 1}`} className="aspect-[3/4] w-full object-cover" />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="ca-focus mt-4 text-sm font-semibold text-[var(--ca-navy)] underline"
        onClick={() => {
          setOpen(true);
          trackClient("notes_sample_opened", { product_id: productId });
        }}
      >
        Open sample viewer
      </button>
      {open && current && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--ca-navy-900)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]" role="dialog" aria-modal="true" aria-label="Notes sample viewer">
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <p className="text-sm font-semibold">
              Sample {index + 1} / {pages.length}
            </p>
            <button type="button" className="min-h-11 rounded-full bg-white px-4 text-sm font-semibold text-[var(--ca-navy)]" onClick={() => { setOpen(false); setZoomed(false); }}>
              Close
            </button>
          </div>
          <div className="relative flex flex-1 items-center justify-center overflow-hidden px-3">
            {pages.length > 1 && (
              <>
                <button type="button" className="absolute left-2 z-10 min-h-12 min-w-12 rounded-full bg-white text-xl" onClick={prev} aria-label="Previous page">
                  ‹
                </button>
                <button type="button" className="absolute right-2 z-10 min-h-12 min-w-12 rounded-full bg-white text-xl" onClick={next} aria-label="Next page">
                  ›
                </button>
              </>
            )}
            <button type="button" onClick={() => setZoomed((z) => !z)} className="h-full w-full max-w-lg">
              {/* High-resolution derivative loads only when the viewer is open. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.url || ""}
                alt={current.alt || `Sample page ${current.source_page_no || index + 1}`}
                className={`mx-auto h-full w-full object-contain transition-transform ${zoomed ? "scale-150" : "scale-100"}`}
              />
            </button>
          </div>
          {pages.length > 1 && (
            <div className="flex justify-center gap-2 overflow-x-auto px-4 py-3 ns-hide-scrollbar">
              {pages.map((s, i) => (
                <button key={s.id} type="button" onClick={() => setIndex(i)} className={`h-2.5 w-2.5 rounded-full ${i === index ? "bg-[var(--ca-gold)]" : "bg-white/30"}`} aria-label={`Page ${i + 1}`} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
