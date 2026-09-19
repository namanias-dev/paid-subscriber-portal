import { notFound } from "next/navigation";
import AddToCartButton from "@/components/notes/AddToCartButton";
import PinChecker from "@/components/notes/PinChecker";
import { getProductBySlug } from "@/lib/store/catalogue";
import { discountPercent, formatPaise } from "@/lib/store/money";
import Link from "next/link";
import Image from "next/image";

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
  const oos = p.sellable < 1;
  const meta = [p.edition, p.page_count ? `${p.page_count} pages` : null, p.language, p.binding_type]
    .filter(Boolean)
    .join(" · ");
  const hero = p.cover_url || p.photos[0]?.url || null;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    sku: p.sku,
    description: p.short_description || undefined,
    image: hero || undefined,
    brand: { "@type": "Brand", name: "Naman Sharma IAS Academy" },
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price: (p.selling_price_paise / 100).toFixed(2),
      availability: oos ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
    },
  };

  return (
    <div className="container-wide py-10 pb-28">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">
        <Link href="/notes" className="ca-focus hover:underline">
          Notes
        </Link>
        {p.category_slug && (
          <>
            {" · "}
            <Link href={`/notes/${p.category_slug}`} className="ca-focus hover:underline">
              {p.category_name}
            </Link>
          </>
        )}
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-[var(--ca-slate-100)]">
            {hero ? (
              <Image src={hero} alt={p.name} fill sizes="(max-width: 1024px) 100vw, 55vw" className="object-cover" priority />
            ) : (
              <div className="flex h-full items-end p-8 font-heading text-3xl font-bold text-[var(--ca-navy)]/30">{p.name}</div>
            )}
          </div>
          {p.photos.length > 1 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {p.photos.slice(0, 4).map((ph) =>
                ph.url ? (
                  <div key={ph.id} className="relative aspect-square overflow-hidden rounded-xl bg-[var(--ca-slate-100)]">
                    <Image src={ph.url} alt={ph.alt || ""} fill sizes="120px" className="object-cover" />
                  </div>
                ) : null,
              )}
            </div>
          )}
          {p.samples.length > 0 && (
            <div className="mt-10">
              <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">Sample pages</h2>
              <p className="mt-1 text-sm text-[var(--ca-navy)]/55">
                Real inside pages. The watermark is in the pixels — comfortable on a phone, useless on a printer.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {p.samples.map((s) =>
                  s.url ? (
                    // Samples are app-routed derivatives; next/image remote patterns may not cover /api.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={s.id}
                      src={s.url}
                      alt={s.alt || `Sample page ${s.source_page_no || ""}`}
                      className="rounded-xl border border-[var(--ca-navy)]/10 bg-white"
                    />
                  ) : null,
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <h1 className="font-heading text-3xl font-bold leading-tight text-[var(--ca-navy)] sm:text-4xl">{p.name}</h1>
          {meta && <p className="mt-2 text-sm text-[var(--ca-navy)]/55">{meta}</p>}
          <div className="mt-5 flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums text-[var(--ca-navy)]">{formatPaise(p.selling_price_paise)}</span>
            {pct > 0 && (
              <>
                <span className="text-base tabular-nums text-[var(--ca-navy)]/40 line-through">{formatPaise(p.mrp_paise)}</span>
                <span className="text-sm font-semibold text-[var(--ca-gold-dark)]">{pct}% off</span>
              </>
            )}
          </div>
          {p.short_description && <p className="mt-4 text-sm leading-relaxed text-[var(--ca-navy)]/70">{p.short_description}</p>}

          <ul className="mt-5 space-y-2 text-sm text-[var(--ca-navy)]/65">
            <li>Printed hard copy — not a PDF.</li>
            <li>Prepaid only via ICICI Eazypay (UPI, cards, net banking).</li>
            <li>Dispatched from Chandigarh with a concrete delivery date.</li>
          </ul>

          <div className="mt-6 hidden gap-3 sm:grid">
            <AddToCartButton
              productId={p.id}
              buyNow
              disabled={oos}
              label={oos ? "Out of stock" : "Buy now"}
            />
            {!oos && <AddToCartButton productId={p.id} />}
          </div>

          <div className="mt-6">
            <PinChecker dispatchDays={p.dispatch_days} />
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--ca-navy)]/10 bg-white/95 p-3 backdrop-blur sm:hidden">
        <div className="flex gap-2">
          {!oos && <AddToCartButton productId={p.id} />}
          <AddToCartButton productId={p.id} buyNow disabled={oos} label={oos ? "Out of stock" : "Buy now"} />
        </div>
      </div>
    </div>
  );
}
