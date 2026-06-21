import Accordion from "@/components/ui/Accordion";
import ContactButtons from "./ContactButtons";
import ResourceList from "./ResourceList";
import RichContent from "./RichContent";
import VideoEmbed from "./VideoEmbed";
import LearnCards from "./LearnCards";
import WhoShouldAttend from "./WhoShouldAttend";
import MentorCard from "./MentorCard";
import Reviews from "./Reviews";
import FlexibleSections from "./FlexibleSections";
import type { LandingView } from "@/lib/landingView";
import type { FAQItem, ContactLink, PdfResource } from "@/lib/types";

/**
 * Renders the premium landing body in a fixed high-conversion order. The hero,
 * pricing sidebar and primary Pay/Enroll CTA stay in the page itself — this
 * orchestrates everything between them, gracefully skipping empty sections so
 * old records render exactly as before.
 */
export default function LandingSections({
  view,
  aboutTitle = "About this program",
  aboutFallback,
  learnTitle = "What you'll learn",
  whoTitle = "Who is this for?",
  getTitle = "What you'll get",
  faqs,
  resources,
  contactLinks,
  resourcesTitle = "Included resources",
  resourcesSubtitle,
}: {
  view: LandingView;
  aboutTitle?: string;
  /** Plain-text fallback rendered when there is no rich about_html. */
  aboutFallback?: string | null;
  learnTitle?: string;
  whoTitle?: string;
  getTitle?: string;
  faqs?: FAQItem[];
  resources?: PdfResource[] | null;
  contactLinks?: ContactLink[] | null;
  resourcesTitle?: string;
  resourcesSubtitle?: string;
}) {
  const v = view;
  const faqItems = (faqs || []).filter((f) => f.q?.trim()).map((f) => ({ q: f.q, a: f.a }));
  const hasAbout = !!v.aboutHtml?.trim() || !!aboutFallback?.trim();

  return (
    <>
      {v.video?.placement === "before_about" && <VideoEmbed video={v.video} />}

      {hasAbout && (
        <section className="mt-10">
          <h2 className="text-2xl font-extrabold">{aboutTitle}</h2>
          {v.aboutHtml?.trim() ? (
            <RichContent html={v.aboutHtml} className="mt-4" />
          ) : (
            <div className="mt-4 space-y-3 text-ink2">
              {(aboutFallback || "").split(/\n\n+/).map((p, i) => <p key={i}>{p}</p>)}
            </div>
          )}
        </section>
      )}

      {v.video?.placement === "after_about" && <VideoEmbed video={v.video} />}

      <LearnCards title={learnTitle} items={v.learn} defaultIcon="🎯" />
      <WhoShouldAttend title={whoTitle} items={v.whoShouldAttend} />
      <LearnCards title={getTitle} items={v.whatYouGet} defaultIcon="🎁" />

      <MentorCard mentor={v.mentor} />

      <Reviews reviews={v.reviews} avg={v.ratingAvg} count={v.ratingCount} />

      {(resources || []).length > 0 && (
        <section className="mt-10">
          <h2 className="text-2xl font-extrabold">{resourcesTitle}</h2>
          {resourcesSubtitle && <p className="mb-3 mt-1 text-sm text-ink2">{resourcesSubtitle}</p>}
          <div className="mt-4">
            <ResourceList resources={resources} />
          </div>
        </section>
      )}

      {(contactLinks || []).length > 0 && (
        <section className="mt-10">
          <h2 className="text-2xl font-extrabold">Have a question?</h2>
          <p className="mb-3 mt-1 text-sm text-ink2">Reach out — we usually reply within minutes.</p>
          <ContactButtons links={contactLinks} />
        </section>
      )}

      {faqItems.length > 0 && (
        <section className="mt-10">
          <h2 className="text-2xl font-extrabold">Frequently asked questions</h2>
          <div className="mt-4">
            <Accordion items={faqItems} />
          </div>
        </section>
      )}

      <FlexibleSections sections={v.sections} />
    </>
  );
}
