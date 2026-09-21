import { notFound } from "next/navigation";
import AddToCartButton from "@/components/notes/AddToCartButton";
import PinChecker from "@/components/notes/PinChecker";
import ProductDescription from "@/components/notes/ProductDescription";
import TrackView from "@/components/notes/TrackView";
import ProductGallery from "@/components/notes/ProductGallery";
import SampleViewer from "@/components/notes/SampleViewer";
import TrustRow from "@/components/notes/TrustRow";
import ShippingStory from "@/components/notes/ShippingStory";
import InterestButton from "@/components/notes/InterestButton";
import ProductCard from "@/components/notes/ProductCard";
import { getProductBySlug, listActiveProducts } from "@/lib/store/catalogue";
import { formatPaise } from "@/lib/store/money";
import { calculateStorePrice, offerDiscountLabel } from "@/lib/store/pricing";
import { getActiveStoreOffer, getPublicActiveOffer, toPricingOffer } from "@/lib/store/offers";
import { SITE_URL } from "@/lib/config";
import Link from "next/link";

/** Prelims / Mains / Both → a phrase a customer understands at a glance. */
function stageLabel(stage: string | null): string | null {
  if (!stage) return null;
  const s = stage.trim().toLowerCase();
  if (s === "prelims") return "For Prelims";
  if (s === "mains") return "For Mains";
  if (s === "both" || s === "prelims_mains" || s === "prelims-mains") return "Prelims + Mains";
  return stage;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const p = await getProductBySlug(params.slug);
  if (!p) return { title: "Notes" };
  return {
    title: p.seo_title || `${p.name} — Naman IAS Notes`,
    description: p.seo_description || p.short_description || `Printed ${p.name}, delivered from Chandigarh.`,
    openGraph: p.cover_url ? { images: [p.cover_url] } : undefined,
    alternates: { canonical: `${SITE_URL}/notes/products/${p.slug}` },
  };
}

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const p = await getProductBySlug(params.slug);
  if (!p) notFound();
  const [offerRow, publicOffer] = await Promise.all([getActiveStoreOffer(), getPublicActiveOffer()]);
  const offer = offerRow ? toPricingOffer(offerRow) : null;
  const priced = calculateStorePrice(
    {
      id: p.id,
      kind: p.kind,
      category_id: p.category_id,
      selling_price_paise: p.selling_price_paise,
    },
    1,
    offer,
  );
  const av = p.availability;
  const purchasable = av.purchasable;
  const showInterest = av.state === "coming_soon" || av.state === "unavailable";
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
  const related = (await listActiveProducts({ categoryId: undefined, limit: 8 }))
    .filter((r) => r.id !== p.id && (r.category_slug === p.category_slug || r.kind === "bundle"))
    .slice(0, 3);
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
      price: ((purchasable ? priced.final_paise : p.selling_price_paise) / 100).toFixed(2),
      ...(purchasable && priced.discount_paise > 0 && publicOffer?.ends_at
        ? { priceValidUntil: publicOffer.ends_at.slice(0, 10) }
        : {}),
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
    <div className="container-wide py-8 pb-32">
      <TrackView
        event={p.kind === "bundle" ? "notes_bundle_viewed" : "notes_product_viewed"}
        props={{
          product_id: p.id,
          slug: p.slug,
          subject: p.subject,
          kind: p.kind,
          price_paise: priced.final_paise,
          offer_id: priced.offer_id,
        }}
      />
      {priced.offer_id && (
        <TrackView
          event="notes_offer_product_view"
          props={{ offer_id: priced.offer_id, product_id: p.id, category: p.category_slug }}
        />
      )}
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
          <ProductGallery name={p.name} subject={p.subject} photos={p.photos} coverUrl={hero} />
          <div className="mt-10">
            <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">Sample pages</h2>
            <p className="mt-1 text-sm text-[var(--ca-navy)]/55">
              Real inside pages. The watermark is in the pixels — comfortable on a phone, useless on a printer.
            </p>
            <div className="mt-4">
              <SampleViewer samples={p.samples} productId={p.id} />
            </div>
          </div>
        </div>

        <div>
          <p className="ca-eyebrow text-[var(--ca-gold-dark)]">{p.subject || p.category_name || "UPSC Notes"}</p>
          <h1 className="mt-2 font-heading text-3xl font-bold leading-tight text-[var(--ca-navy)] sm:text-4xl">{p.name}</h1>
          {p.subtitle && <p className="mt-2 text-base text-[var(--ca-navy)]/70">{p.subtitle}</p>}
          {p.author && <p className="mt-1 text-sm font-medium text-[var(--ca-gold-dark)]">By {p.author}</p>}
          {stage && (
            <span className="mt-3 inline-flex items-center rounded-full bg-[rgba(212,175,55,0.15)] px-3 py-1 text-xs font-semibold text-[var(--ca-gold-dark)]">
              {stage}
            </span>
          )}
          {meta && <p className="mt-2 text-sm text-[var(--ca-navy)]/55">{meta}</p>}
          <div className="mt-5 flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums text-[var(--ca-navy)]">{formatPaise(priced.final_paise)}</span>
            {priced.discount_paise > 0 && (
              <>
                <span className="text-base tabular-nums text-[var(--ca-navy)]/40 line-through">{formatPaise(priced.base_paise)}</span>
                <span className="sr-only">regular price</span>
                <span className="text-sm font-semibold text-[var(--ca-gold-dark)]">
                  {offer ? offerDiscountLabel(offer) : "Offer"}
                </span>
              </>
            )}
            <span className="text-sm text-[var(--ca-navy)]/45">incl. GST</span>
          </div>
          <div className="mt-3">
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
          {p.short_description && <p className="mt-4 text-sm leading-relaxed text-[var(--ca-navy)]/70">{p.short_description}</p>}
          <div className="mt-5">
            <TrustRow hasSamples={p.samples.length > 0} />
          </div>

          {p.kind === "bundle" && p.bundle_items.length > 0 && (
            <div className="mt-5 rounded-3xl bg-white p-4 ns-elev-1">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Included notes</p>
              <ul className="mt-3 divide-y divide-[var(--ca-navy)]/10">
                {p.bundle_items.map((b) => (
                  <li key={b.product_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={`/notes/products/${b.slug}`} className="ca-focus min-w-0 truncate font-medium text-[var(--ca-navy)] hover:underline">
                      {b.name}
                      {b.qty > 1 ? ` × ${b.qty}` : ""}
                    </Link>
                    <span className="shrink-0 tabular-nums text-[var(--ca-navy)]/55">{formatPaise(b.selling_price_paise * b.qty)}</span>
                  </li>
                ))}
              </ul>
              {p.components_total_paise > p.selling_price_paise && (
                <div className="mt-3 flex items-center justify-between border-t border-[var(--ca-navy)]/10 pt-3 text-sm">
                  <span className="text-[var(--ca-navy)]/60">
                    Individual total <span className="tabular-nums line-through">{formatPaise(p.components_total_paise)}</span>
                  </span>
                  <span className="font-semibold text-[var(--ca-gold-dark)]">
                    You save {formatPaise(p.components_total_paise - p.selling_price_paise)}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 hidden gap-3 sm:grid">
            {showInterest ? (
              <InterestButton productId={p.id} source="pdp" />
            ) : (
              <>
                <AddToCartButton productId={p.id} buyNow disabled={!purchasable} label={purchasable ? "Buy now" : av.label} />
                {purchasable && <AddToCartButton productId={p.id} />}
              </>
            )}
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

      <div className="mt-2 max-w-3xl">
        {p.description_md && <ProductDescription markdown={p.description_md} />}
        {p.topics.length > 0 && (
          <div className="mt-8">
            <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">Topics covered</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {p.topics.map((t, i) => (
                <span key={i} className="rounded-full border border-[var(--ca-navy)]/12 bg-white px-3 py-1 text-sm text-[var(--ca-navy)]/75">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
        {p.how_to_use_md && <ProductDescription markdown={p.how_to_use_md} title="How to use these notes" />}
        {p.prelims_relevance_md && <ProductDescription markdown={p.prelims_relevance_md} title="Prelims relevance" />}
        {p.mains_relevance_md && <ProductDescription markdown={p.mains_relevance_md} title="Mains relevance" />}
        {p.revision_value_md && <ProductDescription markdown={p.revision_value_md} title="Revision value" />}
      </div>

      <div className="mt-10 max-w-3xl">
        <ShippingStory compact />
      </div>

      <div className="mt-8 max-w-3xl rounded-3xl bg-white p-5 ns-elev-1">
        <h2 className="font-heading text-base font-bold text-[var(--ca-navy)]">Good to know</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-[var(--ca-navy)]/65">
          <li>This is a physical printed product. Sample images are representative; minor production differences may occur.</li>
          <li>No general returns. If a shipment arrives damaged, is the wrong item, is missing pages, or is lost in transit, contact support with your order number and we will make it right.</li>
          <li>Delivered pan-India from Chandigarh with tracking once dispatched.</li>
        </ul>
      </div>

      {related.length > 0 && (
        <div className="mt-12">
          <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">Related notes</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => (
              <ProductCard key={r.id} product={r} offer={offer} />
            ))}
          </div>
        </div>
      )}

      {!showInterest && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--ca-navy)]/10 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur ns-elev-4 sm:hidden">
          <div className="flex items-center gap-3">
            <div className="shrink-0">
              <p className="text-sm font-semibold tabular-nums text-[var(--ca-navy)]">{formatPaise(priced.final_paise)}</p>
              <p className="text-[11px] text-[var(--ca-navy)]/50">{av.label}</p>
            </div>
            <div className="flex flex-1 gap-2">
              {purchasable && <AddToCartButton productId={p.id} />}
              <AddToCartButton productId={p.id} buyNow disabled={!purchasable} label={purchasable ? "Buy now" : av.label} />
            </div>
          </div>
        </div>
      )}
      {showInterest && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--ca-navy)]/10 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
          <InterestButton productId={p.id} source="pdp" compact />
        </div>
      )}
    </div>
  );
}
