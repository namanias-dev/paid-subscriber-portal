import Image from "next/image";

/**
 * Physical notes composition for the landing hero. Real cover when present;
 * otherwise a premium stacked-booklet fallback. No WebGL.
 */
export default function NotebookStack({
  coverUrl,
  title,
  subject,
}: {
  coverUrl?: string | null;
  title?: string | null;
  subject?: string | null;
}) {
  return (
    <div className="relative mx-auto aspect-[4/5] w-full max-w-[280px] sm:max-w-[320px]" aria-hidden={false}>
      <div className="absolute inset-x-[18%] bottom-1 h-6 rounded-[50%] bg-[rgba(10,26,63,0.28)] blur-xl" aria-hidden="true" />
      <div className="absolute left-[12%] top-[10%] h-[78%] w-[72%] rotate-[-11deg] rounded-[14px] bg-[var(--ca-navy-800)] ns-elev-3" aria-hidden="true" />
      <div className="absolute left-[18%] top-[7%] h-[80%] w-[72%] rotate-[-4deg] rounded-[14px] bg-white ns-elev-2" aria-hidden="true">
        <div className="absolute inset-y-4 left-0 w-1.5 bg-gradient-to-b from-[var(--ca-gold-soft)] via-[var(--ca-gold)] to-[var(--ca-gold-dark)]" />
      </div>
      <div className="relative h-full w-full overflow-hidden rounded-[18px] bg-gradient-to-br from-[var(--ca-navy-900)] to-[var(--ca-navy-600)] ns-elev-5">
        {coverUrl ? (
          <Image src={coverUrl} alt={title || "UPSC notes"} fill sizes="(max-width: 640px) 70vw, 320px" className="object-cover" priority />
        ) : (
          <div className="flex h-full flex-col justify-between p-6">
            <div>
              <p className="ca-eyebrow text-[10px]">{subject || "UPSC Notes"}</p>
              <p className="mt-3 font-heading text-2xl font-extrabold leading-tight text-white">{title || "Handwritten classroom notes"}</p>
            </div>
            <div className="flex items-end justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">Naman Sir</span>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ca-gold)] text-[10px] font-extrabold text-[var(--ca-navy)]">NS</span>
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-[var(--ca-gold)] to-transparent opacity-80" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-white/5" aria-hidden="true" />
      </div>
      {subject && (
        <span className="absolute -right-1 top-8 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[var(--ca-navy)] ns-elev-2">
          {subject}
        </span>
      )}
    </div>
  );
}
