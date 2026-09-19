import { notFound } from "next/navigation";
import AddToCartButton from "@/components/notes/AddToCartButton";
import PinChecker from "@/components/notes/PinChecker";
import ProductDescription from "@/components/notes/ProductDescription";
import { getProductBySlug } from "@/lib/store/catalogue";
import { discountPercent, formatPaise } from "@/lib/store/money";
import { SITE_URL } from "@/lib/config";
import Link from "next/link";
import Image from "next/image";

/** Prelims / Mains / Both → a phrase a customer understands at a glance. */
function stageLabel(stage: string | null): string | null {
  if (!stage) return null;
  const s = stage.trim().toLowerCase();
  if (s === "prelims") return "For Prelims";
  if (s === "mains") return "For Mains";
  if (s === "both" || s === "prelims_mains" || s === "prelims-mains") return "Prelims + Mains";
  return stage;
}

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
  const av = p.availability;
  const purchasable = av.purchasable;
  const meta = [
    p.edition,
    p.page_count ? `${p.page_count} pages` : null,
    p.booklets ? `${p.booklets} booklet${p.booklets === 1 ? "" : "s"}` : null,
    p.language,
    p.binding_type,
  ]
    .filter(Boolean)
    .join(" · ");
  const hero = p.cover_url || p.photos[0]?.url || null;
  const stage = stageLabel(p.stage);
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
      availability: purchasable ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: `${SITE_URL}/notes/products/${p.slug}`,
    },
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Notes", item: `${SITE_URL}/notes` },
      ...(p.category_slug && p.category_name
        ? [{ "@type": "ListItem", position: 2, name: p.category_name, item: `${SITE_URL}/notes/${p.category_slug}` }]
        : []),
      {
        "@type": "ListItem",
        position: p.category_slug && p.category_name ? 3 : 2,
        name: p.name,
        item: `${SITE_URL}/notes/products/${p.slug}`,
      },
    ],
  };

  return (
    <div className="container-wide py-10 pb-28">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
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
          {(p.subject || stage) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {p.subject && (
                <span className="inline-flex items-center rounded-full bg-[var(--ca-navy)]/5 px-3 py-1 text-xs font-semibold text-[var(--ca-navy)]">
                  {p.subject}
                </span>
              )}
              {stage && (
                <span className="inline-flex items-center rounded-full bg-[rgba(212,175,55,0.15)] px-3 py-1 text-xs font-semibold text-[var(--ca-gold-dark)]">
                  {stage}
                </span>
              )}
            </div>
          )}
          {p.subtitle && <p className="mt-2 text-base text-[var(--ca-navy)]/70">{p.subtitle}</p>}
          {p.author && <p className="mt-1 text-sm font-medium text-[var(--ca-gold-dark)]">By {p.author}</p>}
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

          <div className="mt-4">
            <span
              className={
                av.state === "in_stock" || av.state === "on_demand"
                  ? "inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800"
                  : av.state === "low_stock"
                    ? "inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800"
                    : "inline-flex items-center gap-2 rounded-full bg-[var(--ca-navy)]/5 px-3 py-1 text-xs font-semibold text-[var(--ca-navy)]/70"
              }
            >
              {av.state === "on_demand" ? "Available to order · printed for you" : av.label}
            </span>
          </div>

          <ul className="mt-5 space-y-2 text-sm text-[var(--ca-navy)]/65">
            <li><strong className="font-semibold text-[var(--ca-navy)]">Physical hard copy</strong> — printed notes shipped to your address, not a PDF.</li>
            <li>Prepaid only via ICICI Eazypay (UPI, cards, net banking).</li>
            <li>Dispatched from Chandigarh with a concrete delivery date.</li>
          </ul>

          <div className="mt-6 hidden gap-3 sm:grid">
            <AddToCartButton productId={p.id} buyNow disabled={!purchasable} label={purchasable ? "Buy now" : av.label} />
            {purchasable && <AddToCartButton productId={p.id} />}
          </div>

          <div className="mt-6">
            <PinChecker dispatchDays={p.dispatch_days} />
          </div>

          {p.highlights.length > 0 && (
            <div className="mt-8">
              <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">What&apos;s included</h2>
              <ul className="mt-3 grid gap-2 text-sm text-[var(--ca-navy)]/70">
                {p.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ca-gold,#d4af37)]" aria-hidden="true" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {p.ideal_for.length > 0 && (
            <div className="mt-8">
              <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Who these notes are for</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {p.ideal_for.map((t, i) => (
                  <span key={i} className="rounded-full bg-[var(--ca-navy)]/5 px-3 py-1 text-sm text-[var(--ca-navy)]/75">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {p.description_md && (
        <div className="mt-2 max-w-3xl">
          <ProductDescription markdown={p.description_md} />
        </div>
      )}

      <div className="mt-10 max-w-3xl rounded-2xl border border-[var(--ca-navy)]/10 bg-white p-5">
        <h2 className="font-heading text-base font-bold text-[var(--ca-navy)]">Good to know</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-[var(--ca-navy)]/65">
          <li>This is a physical printed product. Sample images are representative; minor production differences may occur.</li>
          <li>Prepaid orders only. We do not accept general returns, but we will make it right if an order arrives damaged, wrong or incomplete — contact support with your order number.</li>
          <li>Delivered pan-India from Chandigarh with tracking once dispatched.</li>
        </ul>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--ca-navy)]/10 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
        <div className="flex items-center gap-2">
          <div className="shrink-0">
            <p className="text-sm font-semibold tabular-nums text-[var(--ca-navy)]">{formatPaise(p.selling_price_paise)}</p>
          </div>
          <div className="flex flex-1 gap-2">
            {purchasable && <AddToCartButton productId={p.id} />}
            <AddToCartButton productId={p.id} buyNow disabled={!purchasable} label={purchasable ? "Buy now" : av.label} />
          </div>
        </div>
      </div>
    </div>
  );
}
