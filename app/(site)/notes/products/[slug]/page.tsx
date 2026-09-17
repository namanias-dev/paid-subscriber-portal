import { notFound } from "next/navigation";
import AddToCartButton from "@/components/notes/AddToCartButton";
import PinChecker from "@/components/notes/PinChecker";
import { getProductBySlug } from "@/lib/store/catalogue";
import { discountPercent, formatPaise } from "@/lib/store/money";
import Link from "next/link";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const p = await getProductBySlug(params.slug);
  if (!p) return { title: "Notes" };
  return {
    title: p.seo_title || `${p.name} — Naman IAS Notes`,
    description: p.seo_description || p.short_description || `Printed ${p.name}, delivered from Chandigarh.`,
    openGraph: p.cover_url ? { images: [p.cover_url] } : undefined,
  };
}

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const p = await getProductBySlug(params.slug);
  if (!p) notFound();
  const pct = discountPercent(p.mrp_paise, p.selling_price_paise);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    sku: p.sku,
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price: (p.selling_price_paise / 100).toFixed(2),
      availability: p.sellable > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  return (
    <div className="container-wide py-10 pb-28">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark,#9a7b2f)]">
        <Link href="/notes">Notes</Link>
        {p.category_slug && (
          <>
            {" · "}
            <Link href={`/notes/${p.category_slug}`}>{p.category_name}</Link>
          </>
        )}
      </p>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="overflow-hidden rounded-3xl bg-[var(--ca-slate-100)]">
            {p.cover_url || p.photos[0]?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.cover_url || p.photos[0].url || ""} alt={p.name} className="w-full object-cover" />
            ) : (
              <div className="flex aspect-[4/3] items-end p-8 font-heading text-3xl font-bold text-[var(--ca-navy)]/30">{p.name}</div>
            )}
          </div>
          {p.photos.length > 1 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {p.photos.slice(0, 4).map((ph) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={ph.id} src={ph.url || ""} alt={ph.alt || ""} className="aspect-square rounded-xl object-cover" />
              ))}
            </div>
          )}
          {p.samples.length > 0 && (
            <div className="mt-10">
              <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">Sample pages</h2>
              <p className="mt-1 text-sm text-[var(--ca-navy)]/55">Non-contiguous pages. Watermark is in the image, not on top of it.</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {p.samples.map((s) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={s.id} src={s.url || ""} alt={s.alt || `Sample page ${s.source_page_no || ""}`} className="rounded-xl border border-[var(--ca-navy)]/10 bg-white" />
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <h1 className="font-heading text-3xl font-bold leading-tight text-[var(--ca-navy)] sm:text-4xl">{p.name}</h1>
          <p className="mt-2 text-sm text-[var(--ca-navy)]/55">
            {[p.edition, p.page_count ? `${p.page_count} pages` : null, p.language].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-5 flex items-baseline gap-3">
            <span className="text-3xl font-semibold text-[var(--ca-navy)]">{formatPaise(p.selling_price_paise)}</span>
            {pct > 0 && (
              <>
                <span className="text-base text-[var(--ca-navy)]/40 line-through">{formatPaise(p.mrp_paise)}</span>
                <span className="text-sm font-semibold text-[var(--ca-gold-dark,#9a7b2f)]">{pct}% off</span>
              </>
            )}
          </div>
          {p.short_description && <p className="mt-4 text-sm leading-relaxed text-[var(--ca-navy)]/70">{p.short_description}</p>}

          <div className="mt-6 hidden gap-3 sm:grid">
            <AddToCartButton productId={p.id} buyNow label={p.sellable > 0 ? "Buy now" : "Out of stock"} />
            {p.sellable > 0 && <AddToCartButton productId={p.id} />}
          </div>

          <div className="mt-6">
            <PinChecker dispatchDays={p.dispatch_days} />
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--ca-navy)]/10 bg-white/95 p-3 backdrop-blur sm:hidden">
        <div className="flex gap-2">
          <AddToCartButton productId={p.id} />
          <AddToCartButton productId={p.id} buyNow label={p.sellable > 0 ? "Buy now" : "Out of stock"} />
        </div>
      </div>
    </div>
  );
}
