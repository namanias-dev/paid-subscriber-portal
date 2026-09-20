"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { BookOpen } from "lucide-react";
import type { StoreProductMedia } from "@/lib/store/catalogue";

export default function ProductGallery({
  name,
  subject,
  photos,
  coverUrl,
}: {
  name: string;
  subject?: string | null;
  photos: StoreProductMedia[];
  coverUrl: string | null;
}) {
  const images = (photos.length ? photos : coverUrl ? [{ id: "cover", url: coverUrl, alt: name, kind: "photo" as const, r2_key: "", source_page_no: null, position: 0, width: null, height: null }] : []).filter((p) => p.url);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const current = images[index];

  const next = useCallback(() => setIndex((i) => (images.length ? (i + 1) % images.length : 0)), [images.length]);
  const prev = useCallback(() => setIndex((i) => (images.length ? (i - 1 + images.length) % images.length : 0)), [images.length]);

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

  if (!current) {
    return (
      <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--ca-navy-900)] to-[var(--ca-navy-600)] ns-elev-3">
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center">
          <BookOpen size={40} strokeWidth={1.5} className="text-[var(--ca-gold-bright)] opacity-90" aria-hidden="true" />
          {subject && <span className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ca-gold-bright)]/80">{subject}</span>}
          <p className="font-heading text-2xl font-bold leading-tight text-white/95 sm:text-3xl">{name}</p>
          <span className="text-sm font-medium text-white/60">Handwritten UPSC notes · printed &amp; delivered</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl bg-[var(--ca-slate-100)] ns-elev-3"
        aria-label="Enlarge product photo"
      >
        <Image src={current.url!} alt={current.alt || name} fill sizes="(max-width: 1024px) 100vw, 55vw" className="object-cover" priority />
      </button>
      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto ns-hide-scrollbar">
          {images.map((ph, i) => (
            <button
              key={ph.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={i === index}
              className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border ${i === index ? "border-[var(--ca-gold)]" : "border-transparent"}`}
            >
              <Image src={ph.url!} alt={ph.alt || ""} fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Product photos">
          <button type="button" className="absolute right-4 top-4 min-h-11 rounded-full bg-white px-4 text-sm font-semibold" onClick={() => setOpen(false)}>
            Close
          </button>
          {images.length > 1 && (
            <>
              <button type="button" className="absolute left-3 min-h-12 min-w-12 rounded-full bg-white text-xl" onClick={prev} aria-label="Previous photo">
                ‹
              </button>
              <button type="button" className="absolute right-3 min-h-12 min-w-12 rounded-full bg-white text-xl" onClick={next} aria-label="Next photo">
                ›
              </button>
            </>
          )}
          <div className="relative h-[80vh] w-full max-w-3xl">
            <Image src={current.url!} alt={current.alt || name} fill sizes="100vw" className="object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
