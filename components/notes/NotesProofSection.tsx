"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import AddToCartButton from "@/components/notes/AddToCartButton";
import PhysicalNotesVideo from "@/components/notes/PhysicalNotesVideo";
import { bindNotesSample } from "@/components/notes/notesProofBridge";
import { trackClient } from "@/lib/analytics/client";
import {
  PHYSICAL_NOTES_VIDEO,
  defaultNotesSample,
  proofAttribution,
  samplePageSrc,
  type NotesProofProduct,
} from "@/lib/store/notesProof";

const NotesSampleReader = dynamic(() => import("@/components/notes/NotesSampleReader"), { ssr: false });

export default function NotesProofSection({
  product,
  placement,
}: {
  product: NotesProofProduct | null;
  placement: "landing" | "pdp";
}) {
  const sample = defaultNotesSample();
  const rootRef = useRef<HTMLElement>(null);
  const impressed = useRef(false);
  const videoPlayed = useRef(false);
  const [open, setOpen] = useState(false);
  const front = samplePageSrc(sample.id, 1);
  const back = sample.pageCount > 1 ? samplePageSrc(sample.id, 2) : front;

  useEffect(() => bindNotesSample(() => setOpen(true)), []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || impressed.current || entry.intersectionRatio < 0.35) return;
        impressed.current = true;
        trackClient("notes_sample_impression", proofAttribution(product, { sample_id: sample.id, placement }));
      },
      { threshold: [0.35] },
    );
    io.observe(root);
    return () => io.disconnect();
  }, [placement, product, sample.id]);

  function buyFromBridge() {
    const played = videoPlayed.current;
    trackClient(
      played ? "notes_physical_video_buy_clicked" : "notes_sample_buy_clicked",
      proofAttribution(product, {
        sample_id: sample.id,
        video_id: PHYSICAL_NOTES_VIDEO.id,
        placement: `${placement}_bridge`,
        video_played: played,
      }),
    );
  }

  return (
    <section
      ref={rootRef}
      id={placement === "landing" ? "see-before-you-buy" : "see-before-you-buy-product"}
      className={placement === "landing" ? "container-wide" : ""}
      aria-labelledby={placement === "landing" ? "see-before-heading" : "see-before-heading-product"}
    >
      <p className="ca-eyebrow text-[var(--ca-gold-dark)]">See before you buy</p>
      <h2
        id={placement === "landing" ? "see-before-heading" : "see-before-heading-product"}
        className="mt-2 max-w-xl font-heading text-3xl font-bold text-[var(--ca-navy)]"
      >
        Know exactly what you are ordering
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ca-navy)]/60">
        Preview real pages, then watch the printed copy that ships after your order.
      </p>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <article className="ns-proof-card">
          <div className="ns-proof-stack" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={back} alt="" className="ns-proof-sheet ns-proof-sheet-back" width={168} height={224} loading="lazy" decoding="async" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={front} alt="" className="ns-proof-sheet ns-proof-sheet-front" width={180} height={240} loading="lazy" decoding="async" />
            <span className="ns-proof-badge">Sample</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Preview the content</p>
            <h3 className="mt-2 font-heading text-2xl font-bold text-[var(--ca-navy)]">{sample.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ca-navy)]/65">
              Actual notes. Same handwriting, density, and layout as the printed edition — {sample.pageCount} sample pages.
            </p>
            <button type="button" className="ca-focus ns-proof-preview mt-5" onClick={() => setOpen(true)}>
              Preview notes
            </button>
          </div>
        </article>

        <article className="ns-proof-card ns-proof-card-video">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">See the physical copy</p>
            <h3 className="mt-2 font-heading text-2xl font-bold text-[var(--ca-navy)]">What arrives after you order</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ca-navy)]/65">
              Naman walks through the complete printed copy that is packed and shipped.
            </p>
            <ul className="mt-3 space-y-1 text-sm text-[var(--ca-navy)]/70">
              <li>Actual printed copy</li>
              <li>Prepared for serious UPSC study</li>
              <li>Delivered to your doorstep</li>
            </ul>
          </div>
          <PhysicalNotesVideo product={product} placement={placement} onPlayed={() => { videoPlayed.current = true; }} />
        </article>
      </div>

      {product && (
        <div className="ns-proof-bridge">
          <div>
            <p className="text-sm font-semibold text-[var(--ca-navy)]">Seen enough?</p>
            <p className="mt-1 font-heading text-2xl font-extrabold tabular-nums text-[var(--ca-navy)]">{product.priceLabel}</p>
            <p className="mt-1 text-xs text-[var(--ca-navy)]/55">{product.name} · incl. GST</p>
          </div>
          <div className="w-full sm:w-64">
            {product.purchasable ? (
              <AddToCartButton productId={product.id} buyNow label="Buy now" onIntent={buyFromBridge} />
            ) : (
              <p className="text-sm font-semibold text-[var(--ca-navy)]/60">{product.statusLabel}</p>
            )}
          </div>
        </div>
      )}

      {open && (
        <NotesSampleReader sample={sample} product={product} placement={placement} onClose={() => setOpen(false)} />
      )}
    </section>
  );
}
