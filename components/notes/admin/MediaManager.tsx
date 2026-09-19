"use client";

import { useEffect, useRef, useState } from "react";

interface MediaItem {
  id: string;
  kind: "photo" | "sample_page";
  url: string | null;
  source_page_no: number | null;
  position: number;
}

/**
 * Per-product media manager: upload product photos and watermarked sample pages
 * to Cloudflare R2, reorder, set the cover, and delete. Photos are marketing
 * imagery; sample pages are the watermarked, downscaled previews a customer can
 * see. Mobile-first: single-column stacks, large tap targets.
 */
export default function MediaManager({ productId }: { productId: string }) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const sampleInput = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch(`/api/admin/notes/media?product_id=${productId}`, { cache: "no-store" });
    const json = await res.json();
    if (json.ok) setMedia(json.media || []);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const photos = media.filter((m) => m.kind === "photo");
  const samples = media.filter((m) => m.kind === "sample_page");

  async function upload(kind: "photo" | "sample", files: FileList | null) {
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
          setMsg(`${file.name}: ${json.error}`);
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
      await fetch("/api/admin/notes/media", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set_cover", product_id: productId, media_id: id }),
      });
      setMsg("Cover updated");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      {msg && <p className="mb-2 rounded border border-line bg-white px-2 py-1 text-xs">{msg}</p>}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-ink">Product photos ({photos.length})</h4>
          <label className="cursor-pointer rounded bg-ink px-3 py-1.5 text-xs font-semibold text-white">
            {busy ? "Uploading…" : "Add photos"}
            <input
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              disabled={busy}
              onChange={(e) => upload("photo", e.target.files)}
            />
          </label>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((m) => (
            <figure key={m.id} className="overflow-hidden rounded-lg border border-line bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.url ? <img src={m.url} alt="" className="aspect-square w-full object-cover" /> : <div className="aspect-square" />}
              <figcaption className="flex items-center justify-between gap-1 p-1">
                <button type="button" onClick={() => setCover(m.id)} className="text-[11px] font-medium text-ink2 hover:text-ink">
                  Cover
                </button>
                <button type="button" onClick={() => remove(m.id)} className="text-[11px] font-medium text-red-700">
                  Delete
                </button>
              </figcaption>
            </figure>
          ))}
          {photos.length === 0 && <p className="col-span-full text-xs text-muted">No photos yet.</p>}
        </div>
      </section>

      <section className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-ink">Sample pages ({samples.length})</h4>
          <label className="cursor-pointer rounded bg-ink px-3 py-1.5 text-xs font-semibold text-white">
            {busy ? "Uploading…" : "Add sample pages"}
            <input
              ref={sampleInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              disabled={busy}
              onChange={(e) => upload("sample", e.target.files)}
            />
          </label>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          Uploaded pages are automatically watermarked and downscaled. The original is stored privately and never shown.
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {samples.map((m) => (
            <figure key={m.id} className="overflow-hidden rounded-lg border border-line bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.url ? <img src={m.url} alt="" className="aspect-[3/4] w-full object-cover" /> : <div className="aspect-[3/4]" />}
              <figcaption className="flex items-center justify-end p-1">
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
