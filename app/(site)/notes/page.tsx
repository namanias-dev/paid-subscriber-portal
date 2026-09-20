import ProductCard from "@/components/notes/ProductCard";
import TrackView from "@/components/notes/TrackView";
import NotesHero from "@/components/notes/NotesHero";
import NotesLandingMotion from "@/components/notes/NotesLandingMotion";
import NotesReveal from "@/components/notes/NotesReveal";
import { BenefitTicker, ResultsTicker } from "@/components/notes/NotesTicker";
import SubjectRail from "@/components/notes/SubjectRail";
import StudentVoices from "@/components/notes/StudentVoices";
import FeaturedNotes from "@/components/notes/FeaturedNotes";
import BundleShowcase from "@/components/notes/BundleShowcase";
import SampleStory from "@/components/notes/SampleStory";
import ShippingStory from "@/components/notes/ShippingStory";
import NotesClosingCta from "@/components/notes/NotesClosingCta";
import NotesTeachingShowcase from "@/components/notes/NotesTeachingShowcase";
import { getProductBySlug, listActiveCategories, listActiveProducts } from "@/lib/store/catalogue";
import { listPreferenceSubjects } from "@/lib/store/preferences";

export const revalidate = 600;
export const metadata = {
  title: "Naman Sir's Handwritten UPSC Notes — Delivered to Your Doorstep",
  description:
    "Premium printed hard copies of Naman Sir's handwritten UPSC notes. Exam-focused, revision-ready, delivered pan-India from Chandigarh.",
};

const WHY = [
  { t: "Curation, not page count", d: "Less material, better organised, written for the paper in front of you." },
  { t: "Handwritten by Naman Sir", d: "The same notes taught in class — diagrams, underlines, the asides that make a topic stick." },
  { t: "Revision-ready binding", d: "Hard copies meant to live on a desk for months, not a printout that falls apart in week two." },
];

const FAQS = [
  { q: "Are these the same notes taught in class?", a: "Yes. Printed from the current edition of Naman Sir's handwritten and curated notes. Editions are marked on each product." },
  { q: "Do you deliver all over India?", a: "Yes, prepaid, from Chandigarh. Enter your PIN on a product page for a concrete delivery date." },
  { q: "Is cash on delivery available?", a: "No. Every order is prepaid. It keeps the price down and the dispatch queue honest." },
  { q: "Can I get a PDF instead?", a: "This store sells printed hard copies only. Sample pages on each product show the real inside pages." },
  { q: "What if my shipment arrives damaged or incomplete?", a: "There are no general returns on printed notes. If a parcel arrives damaged, wrong, missing pages, or is lost in transit, contact support with your order number and we will make it right." },
];

export default async function NotesLanding() {
  const [categories, featured, bestsellers, bundles, products, voiceSubjects] = await Promise.all([
    listActiveCategories(),
    listActiveProducts({ featured: true, limit: 5 }),
    listActiveProducts({ bestsellers: true, limit: 8 }),
    listActiveProducts({ kind: "bundle", limit: 4 }),
    listActiveProducts({ limit: 16 }),
    listPreferenceSubjects(),
  ]);
  const merch = featured.length ? featured : bestsellers.length ? bestsellers : products.filter((p) => p.kind === "single");
  const sampleSource = products.find((p) => p.kind === "single") || products[0] || null;
  const sampleDetail = sampleSource ? await getProductBySlug(sampleSource.slug) : null;
  const bundleDetails = await Promise.all(bundles.map((b) => getProductBySlug(b.slug)));
  const upcoming = products.filter((p) => p.availability.state === "coming_soon" || p.availability.state === "unavailable");

  return (
    <>
      <TrackView event="notes_store_viewed" />
      <NotesLandingMotion />
      <NotesHero />
      <ResultsTicker />
      <BenefitTicker />
      <NotesTeachingShowcase />

      <div className="relative z-10 bg-[var(--ca-surface)] pb-6">
        <NotesReveal className="container-wide pt-12" >
          <div id="catalogue">
            <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Catalogue</p>
            <h2 className="mt-2 font-heading text-3xl font-bold text-[var(--ca-navy)]">Shop by subject</h2>
            <p className="mt-2 max-w-xl text-sm text-[var(--ca-navy)]/55">Each subject is a physical notes identity — not a generic tile.</p>
            <div className="mt-6">
              <SubjectRail categories={categories} products={products} />
            </div>
          </div>
        </NotesReveal>

        <NotesReveal className="container-wide mt-14">
          <StudentVoices subjects={voiceSubjects} />
        </NotesReveal>

        {upcoming.length > 0 && (
          <NotesReveal className="container-wide mt-16">
            <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Upcoming</p>
            <h2 className="mt-2 font-heading text-3xl font-bold text-[var(--ca-navy)]">Tell us what you want next</h2>
            <p className="mt-2 max-w-xl text-sm text-[var(--ca-navy)]/55">
              This is a demand signal, not an order. We use it to decide what to prepare next.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {upcoming.map((p) => (
                <ProductCard key={p.id} product={p} interestSource="landing" />
              ))}
            </div>
          </NotesReveal>
        )}
      </div>

      <section className="ca-dark py-4">
        <div className="container-wide py-8 text-center">
          <p className="text-sm text-white/70">Physical hard copies · Prepaid ICICI checkout · Trackable courier dispatch</p>
        </div>
      </section>

      <div className="bg-[var(--ca-surface)] py-16">
        <NotesReveal className="container-wide">
          <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Featured</p>
          <h2 className="mt-2 font-heading text-3xl font-bold text-[var(--ca-navy)]">Notes worth starting with</h2>
          <div className="mt-6">
            <FeaturedNotes products={merch} />
          </div>
        </NotesReveal>
      </div>

      <section id="bundles" className="bg-[linear-gradient(180deg,#f4ecd4_0%,#f7f5f1_100%)] py-16">
        <NotesReveal className="container-wide">
          <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Bundles</p>
          <h2 className="mt-2 font-heading text-3xl font-bold text-[var(--ca-navy)]">Higher-value sets, when listed</h2>
          <div className="mt-6">
            <BundleShowcase bundles={bundles} details={bundleDetails.filter(Boolean) as NonNullable<(typeof bundleDetails)[number]>[]} />
          </div>
        </NotesReveal>
      </section>

      <div className="bg-[var(--ca-surface)] py-16">
        <NotesReveal>
          <SampleStory product={sampleDetail} />
        </NotesReveal>
        <NotesReveal className="container-wide mt-16 grid gap-6 md:grid-cols-3">
          {WHY.map((w) => (
            <div key={w.t} className="rounded-3xl bg-white p-6 ns-elev-1">
              <h3 className="font-heading text-lg font-semibold text-[var(--ca-navy)]">{w.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ca-navy)]/65">{w.d}</p>
            </div>
          ))}
        </NotesReveal>
        <NotesReveal className="container-wide mt-16">
          <ShippingStory />
        </NotesReveal>
        <NotesReveal className="container-wide mt-16">
          <h2 className="font-heading text-2xl font-bold text-[var(--ca-navy)]">Questions</h2>
          <div className="mt-6 divide-y divide-[var(--ca-navy)]/10 rounded-3xl bg-white ns-elev-1">
            {FAQS.map((f) => (
              <details key={f.q} className="px-5 py-4">
                <summary className="cursor-pointer font-semibold text-[var(--ca-navy)]">{f.q}</summary>
                <p className="mt-2 text-sm text-[var(--ca-navy)]/65">{f.a}</p>
              </details>
            ))}
          </div>
        </NotesReveal>
      </div>

      <NotesClosingCta />
    </>
  );
}
