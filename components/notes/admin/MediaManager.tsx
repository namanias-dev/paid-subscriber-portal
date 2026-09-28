"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

interface MediaItem {
  id: string;
  kind: "photo" | "sample_page";
  url: string | null;
  source_page_no: number | null;
  position: number;
}

interface PdfState {
  pdf_key: string;
  page_count: number;
  max_pages: number;
  selected: number[];
}

/**
 * Per-product media manager: product photos (cover + gallery) and watermarked
 * sample pages uploaded either as images or generated from a private PDF. The
 * original PDF is never exposed — only the watermarked derivatives are served.
 * Mobile-first single-column stacks with large tap targets.
 */
export default function MediaManager({ productId, coverKey }: { productId: string; coverKey?: string | null }) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [coverKeyState, setCoverKeyState] = useState<string | null>(coverKey || null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbNote, setThumbNote] = useState<string | null>(null);
  const [coverNote, setCoverNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfState | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const sampleInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const coverSlotInput = useRef<HTMLInputElement>(null);
  const thumbSlotInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/notes/media?product_id=${productId}`, { cache: "no-store" });
    const json = await res.json();
    if (json.ok) {
      setMedia(json.media || []);
      setCoverKeyState(json.cover_image_key || null);
      setCoverUrl(json.cover_url || null);
      setThumbnailUrl(json.store_thumbnail_url || null);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const photos = media.filter((m) => m.kind === "photo");
  const samples = media.filter((m) => m.kind === "sample_page");

  function ratioNote(file: File, target: number, label: string): Promise<string | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const ratio = img.naturalWidth / img.naturalHeight;
        const off = Math.abs(ratio - target) / target;
        resolve(off > 0.08 ? `Recommended ratio: ${label} for best presentation.` : null);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  async function uploadCover(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    setCoverNote(await ratioNote(file, 4 / 3, "4:3"));
    try {
      const fd = new FormData();
      fd.append("product_id", productId);
      fd.append("kind", "photo");
      fd.append("make_cover", "1");
      fd.append("file", file);
      const res = await fetch("/api/admin/notes/media", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setMsg(json?.error || "Image upload failed");
        return;
      }
      setMsg("Product detail cover updated");
      await load();
    } finally {
      setBusy(false);
      if (coverSlotInput.current) coverSlotInput.current.value = "";
    }
  }

  async function removeCover() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/notes/media", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set_cover", product_id: productId, media_id: null }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setMsg(json?.error || "Product update failed");
        return;
      }
      setMsg("Product detail cover removed");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function uploadThumbnail(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    setThumbNote(await ratioNote(file, 4 / 5, "4:5"));
    try {
      const fd = new FormData();
      fd.append("product_id", productId);
      fd.append("kind", "store_thumbnail");
      fd.append("file", file);
      const res = await fetch("/api/admin/notes/media", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setMsg(json?.error || "Image upload failed");
        return;
      }
      setThumbnailUrl(json.thumbnail?.url || null);
      setMsg("Notes Store thumbnail updated");
      await load();
    } finally {
      setBusy(false);
      if (thumbSlotInput.current) thumbSlotInput.current.value = "";
    }
  }

  async function removeThumbnail() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/notes/media", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "clear_store_thumbnail", product_id: productId }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setMsg(json?.error || "Product update failed");
        return;
      }
      setThumbnailUrl(null);
      setThumbNote(null);
      setMsg("Notes Store thumbnail removed. The landing page uses the product cover.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function uploadImages(kind: "photo" | "sample", files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("product_id", productId);
        fd.append("kind", kind);
        fd.append("file", file);
        const res = await fetch("/api/admin/notes/media", { method: "POST", body: fd });
        const json = await res.json();
        if (!json.ok) {
          setMsg(json.error ? `${file.name}: ${json.error}` : "Image upload failed");
          break;
        }
      }
      await load();
    } finally {
      setBusy(false);
      if (photoInput.current) photoInput.current.value = "";
      if (sampleInput.current) sampleInput.current.value = "";
    }
  }

  async function uploadPdf(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("product_id", productId);
      fd.append("kind", "sample_pdf");
      fd.append("file", file);
      const res = await fetch("/api/admin/notes/media", { method: "POST", body: fd });
      const json = await res.json();
      if (!json.ok) {
        setMsg(json.error);
        return;
      }
      setPdf({ pdf_key: json.pdf_key, page_count: json.page_count, max_pages: json.max_pages, selected: [] });
      setMsg(`PDF uploaded — ${json.page_count} pages. Select up to ${json.max_pages} to show students.`);
    } finally {
      setBusy(false);
      if (pdfInput.current) pdfInput.current.value = "";
    }
  }

  function togglePage(n: number) {
    setPdf((cur) => {
      if (!cur) return cur;
      if (cur.selected.includes(n)) return { ...cur, selected: cur.selected.filter((x) => x !== n) };
      if (cur.selected.length >= cur.max_pages) return cur;
      return { ...cur, selected: [...cur.selected, n].sort((a, b) => a - b) };
    });
  }

  async function generatePdfSamples() {
    if (!pdf || !pdf.selected.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/notes/media", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "generate_pdf_samples", product_id: productId, pdf_key: pdf.pdf_key, pages: pdf.selected }),
      });
      const json = await res.json();
      if (!json.ok) {
        setMsg(json.error);
        return;
      }
      setMsg(`Generated ${json.created} watermarked sample page(s).`);
      setPdf(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/admin/notes/media?id=${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function setCover(id: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/notes/media", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set_cover", product_id: productId, media_id: id }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setMsg(typeof json?.error === "string" && json.error ? json.error : "Image upload failed");
        return;
      }
      setMsg("Cover updated");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {msg && <p className="rounded border border-line bg-white px-2 py-1 text-xs text-ink2">{msg}</p>}

      <section className="rounded-lg border border-line bg-surface p-3">
        <h4 className="text-sm font-semibold text-ink">Product images</h4>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ImageSlot
            title="Product detail cover"
            hint="Recommended: 4:3. Used on the product page, product cards, and cart."
            note={coverNote}
            preview={coverUrl}
            previewClass="aspect-[4/3] object-contain"
            busy={busy}
            inputRef={coverSlotInput}
            onFile={(file) => void uploadCover(file)}
            onRemove={() => void removeCover()}
          />
          <ImageSlot
            title="Notes Store thumbnail"
            hint="Recommended: 4:5, 1280 × 1600 px. Used on subject cards on the Notes Store landing page."
            note={thumbNote}
            preview={thumbnailUrl}
            previewClass="aspect-[4/5] object-cover"
            busy={busy}
            inputRef={thumbSlotInput}
            onFile={(file) => void uploadThumbnail(file)}
            onRemove={() => void removeThumbnail()}
          />
        </div>
      </section>

      {/* Photos / cover + gallery */}
      <section className="rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-ink">Cover & gallery ({photos.length})</h4>
          <label className="cursor-pointer rounded bg-ink px-3 py-1.5 text-xs font-semibold text-white">
            {busy ? "Working…" : "Add photos"}
            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={busy} onChange={(e) => uploadImages("photo", e.target.files)} />
          </label>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((m) => {
            const activeCover = coverKeyState || coverKey;
            const isCover = activeCover && m.url && m.url.includes(activeCover.split("/").pop() || "___");
            return (
              <figure key={m.id} className={`overflow-hidden rounded-lg border bg-white ${isCover ? "border-[var(--primary)] ring-1 ring-[var(--primary)]" : "border-line"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {m.url ? <img src={m.url} alt="" className="aspect-square w-full object-cover" /> : <div className="aspect-square" />}
                <figcaption className="flex items-center justify-between gap-1 p-1">
                  <button type="button" onClick={() => setCover(m.id)} className="text-[11px] font-medium text-ink2 hover:text-ink">
                    {isCover ? "Cover ✓" : "Set cover"}
                  </button>
                  <button type="button" onClick={() => remove(m.id)} className="text-[11px] font-medium text-red-700">
                    Delete
                  </button>
                </figcaption>
              </figure>
            );
          })}
          {photos.length === 0 && <p className="col-span-full text-xs text-muted">No photos yet. The first photo becomes the cover.</p>}
        </div>
      </section>

      {/* Sample pages */}
      <section className="rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-ink">Sample pages ({samples.length})</h4>
          <div className="flex gap-2">
            <label className="cursor-pointer rounded bg-ink px-3 py-1.5 text-xs font-semibold text-white">
              Add images
              <input ref={sampleInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={busy} onChange={(e) => uploadImages("sample", e.target.files)} />
            </label>
            <label className="cursor-pointer rounded border border-ink px-3 py-1.5 text-xs font-semibold text-ink">
              Upload PDF
              <input ref={pdfInput} type="file" accept="application/pdf" hidden disabled={busy} onChange={(e) => uploadPdf(e.target.files?.[0])} />
            </label>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          Images and PDF pages are auto-watermarked and downscaled. The original upload stays private and is never shown.
        </p>

        {/* PDF page selection */}
        {pdf && (
          <div className="mt-3 rounded-lg border border-[var(--primary)]/40 bg-white p-3">
            <p className="text-xs font-semibold text-ink">
              Select pages to show students ({pdf.selected.length}/{pdf.max_pages}) · {pdf.page_count}-page PDF
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Array.from({ length: pdf.page_count }, (_, i) => i + 1).map((n) => {
                const on = pdf.selected.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => togglePage(n)}
                    className={`h-8 min-w-8 rounded px-2 text-xs font-medium ${on ? "bg-[var(--primary)] text-white" : "bg-surface text-ink2 ring-1 ring-line"}`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy || !pdf.selected.length} onClick={generatePdfSamples} className="h-9 rounded bg-ink px-3 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Generating…" : `Generate ${pdf.selected.length} page${pdf.selected.length === 1 ? "" : "s"}`}
              </button>
              <button type="button" onClick={() => setPdf(null)} className="h-9 rounded border border-line px-3 text-sm text-ink2">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {samples.map((m) => (
            <figure key={m.id} className="overflow-hidden rounded-lg border border-line bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.url ? <img src={m.url} alt="" className="aspect-[3/4] w-full object-cover" /> : <div className="aspect-[3/4]" />}
              <figcaption className="flex items-center justify-between gap-1 p-1">
                <span className="text-[11px] text-muted">{m.source_page_no ? `p.${m.source_page_no}` : "img"}</span>
                <button type="button" onClick={() => remove(m.id)} className="text-[11px] font-medium text-red-700">
                  Delete
                </button>
              </figcaption>
            </figure>
          ))}
          {samples.length === 0 && <p className="col-span-full text-xs text-muted">No sample pages yet.</p>}
        </div>
      </section>
    </div>
  );
}

function ImageSlot({
  title,
  hint,
  note,
  preview,
  previewClass,
  busy,
  inputRef,
  onFile,
  onRemove,
}: {
  title: string;
  hint: string;
  note: string | null;
  preview: string | null;
  previewClass: string;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement>;
  onFile: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">{hint}</p>
      <div className="mt-3 overflow-hidden rounded-lg border border-line bg-[#f4efe4]">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className={`w-full bg-[#f4efe4] ${previewClass}`} />
        ) : (
          <div className={`flex w-full items-center justify-center text-[11px] text-muted ${previewClass}`}>No image yet</div>
        )}
      </div>
      {note && <p className="mt-2 text-[11px] font-medium text-amber-800">{note}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="cursor-pointer rounded bg-ink px-3 py-1.5 text-xs font-semibold text-white">
          {preview ? "Replace" : "Upload"}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          disabled={busy || !preview}
          onClick={onRemove}
          className="rounded border border-line px-3 py-1.5 text-xs font-semibold text-ink2 disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
