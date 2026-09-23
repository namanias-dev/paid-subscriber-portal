import PinChecker from "@/components/notes/PinChecker";
import TrackView from "@/components/notes/TrackView";
import ProductGallery from "@/components/notes/ProductGallery";
import SampleViewer from "@/components/notes/SampleViewer";
import TrustRow from "@/components/notes/TrustRow";
import ShippingStory from "@/components/notes/ShippingStory";
import ProductCard from "@/components/notes/ProductCard";
import NotesSubjectStory from "@/components/notes/NotesSubjectStory";
import PdpOfferChip from "@/components/notes/PdpOfferChip";
import PurchaseDock from "@/components/notes/PurchaseDock";
import NotesProofSection from "@/components/notes/NotesProofSection";
import type { NotesProofProduct } from "@/lib/store/notesProof";
import { listStorefrontProducts, type StoreProductDetail } from "@/lib/store/catalogue";
import { formatPaise } from "@/lib/store/money";
import { calculateStorePrice } from "@/lib/store/pricing";
import { getNotesCurriculum } from "@/lib/store/notesCurriculum";
import { notesProductPath } from "@/lib/store/paths";
import type { OfferForPricing } from "@/lib/store/pricing";
import type { PublicStoreOffer } from "@/lib/store/offers";
import { SITE_URL } from "@/lib/config";
import Link from "next/link";

function stageLabel(stage: string | null): string | null {
  if (!stage) return null;
  const s = stage.trim().toLowerCase();
  if (s === "prelims") return "For Prelims";
  if (s === "mains") return "For Mains";
  if (s === "both" || s === "prelims_mains" || s === "prelims-mains") return "Prelims + Mains";
  return stage;
}

export default async function NotesPdp({
  p,
  offer,
  publicOffer,
}: {
  p: StoreProductDetail;
  offer: OfferForPricing | null;
  publicOffer: PublicStoreOffer | null;
}) {
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
  const story = getNotesCurriculum(p.slug);
  const title = story?.title || p.name;
  const subtitle = story?.subheading || p.subtitle;
  const intro = story?.mentorIntro || p.short_description;
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
  const related = (await listStorefrontProducts()).filter((r) => r.id !== p.id).slice(0, 2);
  const canonical = `${SITE_URL}${notesProductPath(p.slug)}`;
  const showSale = purchasable && priced.discount_paise > 0 && publicOffer?.status === "ACTIVE";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: title,
    sku: p.sku,
    description: story?.seoDescription || p.short_description || undefined,
    image: hero || undefined,
    brand: { "@type": "Brand", name: "Naman Sharma IAS Academy" },
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price: ((purchasable ? priced.final_paise : p.selling_price_paise) / 100).toFixed(2),
      ...(showSale && publicOffer?.ends_at ? { priceValidUntil: publicOffer.ends_at.slice(0, 10) } : {}),
      availability: purchasable ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: canonical,
    },
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Notes", item: `${SITE_URL}/notes` },
      { "@type": "ListItem", position: 2, name: title, item: canonical },
    ],
  };

  return (
    <div className="container-wide py-8 pb-28">
      <TrackView
        event={p.kind === "bundle" ? "notes_bundle_viewed" : "notes_product_viewed"}
        props={{
          product_id: p.id,
          slug: p.slug,
          subject: p.subject || p.category_slug,
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
        <span aria-hidden="true"> · </span>
        <span>{p.category_name || p.subject || "UPSC Notes"}</span>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
        <div>
          <ProductGallery name={title} subject={p.subject} photos={p.photos} coverUrl={hero} />
          {p.samples.length > 0 && (
            <div className="mt-10" id="notes-samples">
              <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">Sample pages</h2>
              <p className="mt-1 text-sm text-[var(--ca-navy)]/55">
                Real inside pages. The watermark is in the pixels — comfortable on a phone, useless on a printer.
              </p>
              <div className="mt-4">
                <SampleViewer samples={p.samples} productId={p.id} />
              </div>
            </div>
          )}
        </div>

        <div>
          <p className="ca-eyebrow text-[var(--ca-gold-dark)]">{p.subject || p.category_name || "UPSC Notes"}</p>
          <h1 className="mt-2 font-heading text-3xl font-bold leading-tight text-[var(--ca-navy)] sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-3 text-base leading-relaxed text-[var(--ca-navy)]/70">{subtitle}</p>}
          {p.author && <p className="mt-1 text-sm font-medium text-[var(--ca-gold-dark)]">By {p.author}</p>}
          {stage && (
            <span className="mt-3 inline-flex items-center rounded-full bg-[rgba(212,175,55,0.15)] px-3 py-1 text-xs font-semibold text-[var(--ca-gold-dark)]">
              {stage}
            </span>
          )}
          {meta && <p className="mt-2 text-sm text-[var(--ca-navy)]/55">{meta}</p>}

          {showSale && publicOffer && (
            <div className="mt-5">
              <PdpOfferChip offer={publicOffer} />
            </div>
          )}

          {intro && <p className="mt-4 text-sm leading-relaxed text-[var(--ca-navy)]/70">{intro}</p>}
          <div className="mt-5">
            <TrustRow hasSamples={p.samples.length > 0} />
          </div>
          <div className="mt-5">
            <PurchaseDock
              productId={p.id}
              price={formatPaise(priced.final_paise)}
              compare={showSale ? formatPaise(priced.base_paise) : null}
              save={showSale ? `Save ${formatPaise(priced.discount_paise)}` : null}
              status={av.state === "on_demand" ? "Available to order · printed for you" : av.label}
              purchasable={purchasable}
              showInterest={showInterest}
              hasSamples={p.samples.length > 0}
              showProofPreview
            />
          </div>
          <div className="mt-6">
            <PinChecker dispatchDays={p.dispatch_days} />
          </div>
        </div>
      </div>

      <div className="mt-12 max-w-3xl">
        {story ? <NotesSubjectStory story={story} /> : null}
      </div>

      <div className="mt-12">
        <NotesProofSection
          placement="pdp"
          product={{
            id: p.id,
            slug: p.slug,
            subject: p.subject || p.category_slug,
            name: p.short_name || title,
            priceLabel: formatPaise(priced.final_paise),
            purchasable,
            statusLabel: av.label,
          } satisfies NotesProofProduct}
        />
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
          <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">The other launch notes</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {related.map((r) => (
              <ProductCard key={r.id} product={r} offer={offer} />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
