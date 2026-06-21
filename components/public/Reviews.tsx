import Image from "next/image";
import type { Review } from "@/lib/types";

function Stars({ n }: { n: number }) {
  const v = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span className="text-amber-400" aria-label={`${v} out of 5 stars`}>
      {"★".repeat(v)}
      <span className="text-line-strong">{"★".repeat(5 - v)}</span>
    </span>
  );
}

export default function Reviews({
  reviews,
  avg,
  count,
  title = "What our students say",
}: {
  reviews?: Review[];
  avg?: number | null;
  count?: number;
  title?: string;
}) {
  const list = (reviews || []).filter((r) => r?.name?.trim() && r?.text?.trim());
  if (!list.length) return null;
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-2xl font-extrabold">{title}</h2>
        {avg != null && count ? (
          <p className="text-sm font-semibold text-ink2">
            <Stars n={avg} /> <span className="ml-1">{avg.toFixed(1)} · {count} review{count > 1 ? "s" : ""}</span>
          </p>
        ) : null}
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {list.map((r, i) => (
          <figure key={r.id || i} className="card flex flex-col p-5">
            <div className="flex items-center gap-3">
              {r.photo_url ? (
                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-surface2">
                  <Image src={r.photo_url} alt={r.name} fill sizes="44px" className="object-cover" />
                </div>
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-tint font-semibold text-primary">
                  {r.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <figcaption className="font-semibold text-ink">{r.name}</figcaption>
                <div className="text-sm leading-none"><Stars n={r.rating} /></div>
              </div>
            </div>
            <blockquote className="mt-3 text-sm leading-relaxed text-ink2">“{r.text}”</blockquote>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {r.result?.trim() && <span className="pill pill-gold">🏆 {r.result}</span>}
              {r.city?.trim() && <span className="text-xs text-muted">📍 {r.city}</span>}
              {r.video_url?.trim() && (
                <a href={r.video_url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-primary">▶ Watch video</a>
              )}
            </div>
          </figure>
        ))}
      </div>
    </section>
  );
}
