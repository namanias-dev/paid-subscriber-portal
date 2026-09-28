"use client";

import { useEffect, useRef, useState } from "react";
import AddToCartButton from "@/components/notes/AddToCartButton";
import InterestButton from "@/components/notes/InterestButton";
import { requestNotesSample } from "@/components/notes/notesProofBridge";

export default function PurchaseDock({
  productId,
  price,
  compare,
  save,
  status,
  purchasable,
  showInterest,
  hasSamples,
  showProofPreview = false,
}: {
  productId: string;
  price: string;
  compare: string | null;
  save: string | null;
  status: string;
  purchasable: boolean;
  showInterest: boolean;
  hasSamples: boolean;
  showProofPreview?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const node = panelRef.current;
    if (!node || showInterest) return;
    const io = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0.15 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [showInterest]);

  function scrollToSamples() {
    document.getElementById("notes-samples")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <div ref={panelRef} className="ns-purchase">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
          <p className="font-heading text-[2.35rem] font-extrabold leading-none tabular-nums text-[var(--ca-navy)] sm:text-5xl">
            {price}
          </p>
          {compare && (
            <p className="pb-1 text-base tabular-nums text-[var(--ca-navy)]/40 line-through">
              {compare}
              <span className="sr-only"> regular price</span>
            </p>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--ca-navy)]/50">incl. GST</span>
          {save && <span className="rounded-full bg-[rgba(212,175,55,0.18)] px-2.5 py-0.5 text-xs font-bold text-[var(--ca-gold-dark)]">{save}</span>}
          <span className="text-[var(--ca-navy)]/55">{status}</span>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[var(--ca-navy)]/55">
          Printed hard copy · prepaid · tracking after dispatch from Chandigarh
        </p>
        <div className="mt-5 grid gap-2.5">
          {showInterest ? (
            <InterestButton productId={productId} source="pdp" />
          ) : (
            <>
              <AddToCartButton productId={productId} buyNow disabled={!purchasable} label={purchasable ? "Buy now" : status} />
              {purchasable && <AddToCartButton productId={productId} />}
            </>
          )}
        </div>
        {(showProofPreview || hasSamples) && (
          <div className="mt-4 border-t border-[var(--ca-navy)]/10 pt-4">
            <p className="text-sm text-[var(--ca-navy)]/60">Not sure yet? Preview actual pages before ordering.</p>
            {showProofPreview ? (
              <button type="button" className="ca-focus ns-proof-secondary mt-3" onClick={() => requestNotesSample()}>
                Preview sample notes
              </button>
            ) : (
              <button type="button" className="ca-focus ns-proof-secondary mt-3" onClick={scrollToSamples}>
                View sample pages
              </button>
            )}
          </div>
        )}
      </div>

      {!showInterest && stuck && (
        <div className="ns-purchase-sticky" role="region" aria-label="Purchase">
          <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
            <div className="min-w-0 shrink">
              <p className="font-heading text-lg font-extrabold tabular-nums leading-none text-[var(--ca-navy)]">{price}</p>
              {save ? <p className="mt-0.5 text-[11px] font-semibold text-[var(--ca-gold-dark)]">{save}</p> : <p className="mt-0.5 text-[11px] text-[var(--ca-navy)]/50">incl. GST</p>}
            </div>
            <div className="flex min-w-0 flex-1 gap-2">
              {purchasable && <AddToCartButton productId={productId} compact />}
              <AddToCartButton productId={productId} buyNow compact disabled={!purchasable} label={purchasable ? "Buy now" : status} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
