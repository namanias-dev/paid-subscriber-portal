import Link from "next/link";
import type { StoreProductDetail } from "@/lib/store/catalogue";

export default function SampleStory({ product }: { product: StoreProductDetail | null }) {
  const samples = (product?.samples || []).filter((s) => s.url).slice(0, 3);
  return (
    <section className="container-wide">
      <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Sample pages</p>
      <h2 className="mt-2 max-w-xl font-heading text-3xl font-bold text-[var(--ca-navy)]">See the actual notes before you order</h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ca-navy)]/60">
        Watermarked inside pages from the printed edition. Comfortable to read on a phone, useless to reprint.
      </p>
      {samples.length ? (
        <div className="relative mt-8 flex justify-center">
          <div className="relative h-64 w-full max-w-xl">
            {samples.map((s, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={s.id}
                src={s.url || ""}
                alt={s.alt || `Sample page ${s.source_page_no || i + 1}`}
                className="absolute left-1/2 top-0 h-64 w-44 -translate-x-1/2 rounded-xl border border-[var(--ca-navy)]/10 bg-white object-cover ns-elev-3"
                style={{ transform: `translate(-50%, 0) rotate(${(i - 1) * 7}deg) translateX(${(i - 1) * 42}px)` }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-8 rounded-3xl border border-dashed border-[var(--ca-navy)]/15 bg-white px-6 py-10 text-center text-sm text-[var(--ca-navy)]/55">
          Sample pages appear here once a live title has approved previews.
        </div>
      )}
      {product && (
        <div className="mt-8 text-center">
          <Link href={`/notes/${product.slug}`} className="ca-btn ca-btn-outline rounded-full px-6">
            View notes sample
          </Link>
        </div>
      )}
    </section>
  );
}
