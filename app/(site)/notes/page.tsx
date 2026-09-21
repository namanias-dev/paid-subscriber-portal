import NotesHero from "@/components/notes/NotesHero";
import NotesLandingMotion from "@/components/notes/NotesLandingMotion";
import NotesReveal from "@/components/notes/NotesReveal";
import { BenefitTicker, ResultsTicker } from "@/components/notes/NotesTicker";
import SubjectRail from "@/components/notes/SubjectRail";
import StudentVoices from "@/components/notes/StudentVoices";
import SampleStory from "@/components/notes/SampleStory";
import ShippingStory from "@/components/notes/ShippingStory";
import NotesClosingCta from "@/components/notes/NotesClosingCta";
import NotesTeachingShowcase from "@/components/notes/NotesTeachingShowcase";
import OfferLaunch from "@/components/notes/OfferLaunch";
import TrackView from "@/components/notes/TrackView";
import { getProductBySlug, listStorefrontProducts } from "@/lib/store/catalogue";
import { listPreferenceSubjects } from "@/lib/store/preferences";
import { getPublicActiveOffer } from "@/lib/store/offers";

export const dynamic = "force-dynamic";
export const revalidate = 0;
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
  const [products, voiceSubjects, publicOffer] = await Promise.all([
    listStorefrontProducts(),
    listPreferenceSubjects(),
    getPublicActiveOffer(),
  ]);
  const sampleSource = products[0] || null;
  const sampleDetail = sampleSource ? await getProductBySlug(sampleSource.slug) : null;
  const pricingOffer = publicOffer;
  const qualifier = products.map((p) => p.short_name || p.category_name || p.subject).filter(Boolean).join(" · ");

  return (
    <>
      <TrackView event="notes_store_viewed" />
      <NotesLandingMotion />
      <NotesHero />
      <OfferLaunch initial={publicOffer} qualifier={qualifier || null} />
      <ResultsTicker />
      <BenefitTicker />
      <NotesTeachingShowcase />

      <div className="relative z-10 bg-[var(--ca-surface)] pb-6">
        <NotesReveal className="container-wide pt-12">
          <div id="catalogue">
            <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Catalogue</p>
            <h2 className="mt-2 font-heading text-3xl font-bold text-[var(--ca-navy)]">Shop by subject</h2>
            <p className="mt-2 max-w-xl text-sm text-[var(--ca-navy)]/55">Each subject is a physical notes identity — not a generic tile.</p>
            <div className="mt-6">
              <SubjectRail products={products} offer={pricingOffer} />
            </div>
          </div>
        </NotesReveal>

        <NotesReveal className="container-wide mt-14">
          <StudentVoices subjects={voiceSubjects} />
        </NotesReveal>
      </div>

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
