"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AddToCartButton from "@/components/notes/AddToCartButton";
import { trackClient } from "@/lib/analytics/client";
import {
  proofAttribution,
  samplePageSrc,
  type NotesProofProduct,
  type NotesSampleAsset,
} from "@/lib/store/notesProof";

export default function NotesSampleReader({
  sample,
  product,
  placement,
  onClose,
}: {
  sample: NotesSampleAsset;
  product: NotesProofProduct | null;
  placement: "landing" | "pdp";
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const seen = useRef(new Set<string>());
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const productRef = useRef(product);
  productRef.current = product;
  const [page, setPage] = useState(1);
  const [renderedPage, setRenderedPage] = useState(1);
  const [zoomed, setZoomed] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const count = sample.pageCount;
  const last = page >= count;
  if (page !== renderedPage) {
    setRenderedPage(page);
    setStatus("loading");
    setZoomed(false);
  }

  const go = useCallback(
    (delta: number) => {
      setZoomed(false);
      setPage((current) => Math.min(count, Math.max(1, current + delta)));
    },
    [count],
  );

  useEffect(() => {
    const root = dialogRef.current;
    const previously = document.activeElement as HTMLElement | null;
    const scrollY = window.scrollY;
    const body = document.body;
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    root?.querySelector<HTMLElement>("[data-proof-close]")?.focus();

    trackClient("notes_sample_opened", proofAttribution(productRef.current, { sample_id: sample.id, placement }));

    function focusables() {
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const nodes = focusables();
      if (!nodes.length) return;
      const first = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      if (!first || !lastNode) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        lastNode.focus();
      } else if (!e.shiftKey && document.activeElement === lastNode) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      body.style.width = "";
      window.scrollTo(0, scrollY);
      previously?.focus?.();
    };
  }, [go, placement, sample.id]);

  useEffect(() => {
    const key = `${sample.id}:${page}`;
    if (!seen.current.has(key)) {
      seen.current.add(key);
      trackClient(
        "notes_sample_page_view",
        proofAttribution(productRef.current, { sample_id: sample.id, placement, page }),
      );
      if (page === count) {
        trackClient("notes_sample_completed", proofAttribution(productRef.current, { sample_id: sample.id, placement }));
      }
    }
    const next = page + 1;
    if (next <= count) {
      const img = new Image();
      img.src = samplePageSrc(sample.id, next);
    }
  }, [count, page, placement, sample.id]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (zoomed || e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    drag.current = null;
    if (!start || start.id !== e.pointerId || zoomed) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    go(dx < 0 ? 1 : -1);
  }

  const src = samplePageSrc(sample.id, page);

  return (
    <div
      ref={dialogRef}
      className="ns-reader"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ns-reader-title"
    >
      <header className="ns-reader-bar">
        <button type="button" className="ns-reader-icon ca-focus" data-proof-close onClick={onClose} aria-label="Close sample notes">
          <span aria-hidden="true">×</span>
        </button>
        <div className="min-w-0 flex-1">
          <p id="ns-reader-title" className="truncate font-heading text-base font-bold text-[var(--ca-navy)]">
            {sample.title}
          </p>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Sample</p>
        </div>
        <button
          type="button"
          className="ca-focus ns-reader-textbtn"
          aria-pressed={zoomed}
          onClick={() => setZoomed((z) => !z)}
        >
          {zoomed ? "Fit page" : "Zoom"}
        </button>
      </header>

      <div
        className={zoomed ? "ns-reader-stage is-zoomed" : "ns-reader-stage"}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {status !== "ready" && status !== "error" && <div className="ns-reader-skeleton" aria-hidden="true" />}
        {status === "error" ? (
          <div className="ns-reader-error">
            <p>This page did not load.</p>
            <button type="button" className="ca-focus ns-reader-textbtn" onClick={() => setStatus("loading")}>
              Try again
            </button>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={page}
            src={src}
            alt={`${sample.title}, sample page ${page} of ${count}`}
            draggable={false}
            className={zoomed ? "ns-reader-img is-zoomed" : "ns-reader-img"}
            onLoad={() => setStatus("ready")}
            onError={() => setStatus("error")}
          />
        )}
      </div>

      {last && (
        <div className="ns-reader-end">
          <p className="font-heading text-lg font-bold text-[var(--ca-navy)]">That is only a preview.</p>
          <p className="mt-1 text-sm text-[var(--ca-navy)]/65">
            The complete notes are the printed set packed for your UPSC preparation.
          </p>
        </div>
      )}

      <div className="ns-reader-nav">
        <button type="button" className="ns-reader-icon ca-focus" onClick={() => go(-1)} disabled={page <= 1} aria-label="Previous page">
          <span aria-hidden="true">‹</span>
        </button>
        <p className="tabular-nums text-sm font-semibold text-[var(--ca-navy)]" aria-live="polite">
          {page} / {count}
        </p>
        <button type="button" className="ns-reader-icon ca-focus" onClick={() => go(1)} disabled={page >= count} aria-label="Next page">
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <p className="sr-only">Swipe sideways, or use the arrow keys, to move between pages.</p>

      {product && (
        <footer className="ns-reader-buy">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-[var(--ca-navy)]/55">{product.name}</p>
            <p className="font-heading text-xl font-extrabold tabular-nums leading-none text-[var(--ca-navy)]">{product.priceLabel}</p>
          </div>
          <div className="w-44 shrink-0 sm:w-56">
            {product.purchasable ? (
              <AddToCartButton
                productId={product.id}
                buyNow
                label={last ? "Buy complete notes" : "Buy now"}
                onIntent={() =>
                  trackClient(
                    "notes_sample_buy_clicked",
                    proofAttribution(product, { sample_id: sample.id, placement, page }),
                  )
                }
              />
            ) : (
              <p className="text-sm font-semibold text-[var(--ca-navy)]/60">{product.statusLabel}</p>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
