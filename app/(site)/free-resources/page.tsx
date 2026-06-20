import Reveal, { Stagger, StaggerItem } from "@/components/ui/Reveal";
import { ACADEMY } from "@/lib/config";

export const metadata = { title: "Free Resources — Naman Sharma IAS Academy" };

const RES = [
  { icon: "📰", title: "Daily Current Affairs", desc: "Exam-ready daily CA with crisp analysis.", href: ACADEMY.telegram, cta: "Get on Telegram" },
  { icon: "📝", title: "Daily Prelims MCQs", desc: "Practice 10 MCQs daily with explanations.", href: ACADEMY.telegram, cta: "Join Telegram" },
  { icon: "📚", title: "Free PDFs & Notes", desc: "Booklets, value-adds and revision notes.", href: ACADEMY.telegram, cta: "Download" },
  { icon: "🗺️", title: "UPSC Through Maps", desc: "Free sample map sets for Prelims geography.", href: "/courses/upsc-through-maps-prelims-2026", cta: "Explore" },
  { icon: "▶", title: "YouTube Lectures", desc: "220K+ subscribers — free strategy & concept videos.", href: ACADEMY.youtube, cta: "Watch on YouTube" },
  { icon: "✈️", title: "Telegram Community", desc: "Join 23K+ aspirants for daily updates.", href: ACADEMY.telegram, cta: "Join Now" },
];

export default function FreeResourcesPage() {
  return (
    <div className="container-wide section">
      <Reveal>
        <p className="pill pill-blue mb-3">Free Resources</p>
        <h1 className="text-4xl font-extrabold sm:text-5xl">Start preparing today — for free</h1>
        <p className="mt-3 max-w-2xl text-ink2">Daily current affairs, MCQs, PDFs and a thriving community. No payment needed.</p>
      </Reveal>

      <Stagger className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {RES.map((r) => (
          <StaggerItem key={r.title}>
            <div className="card card-hover flex h-full flex-col p-6">
              <div className="mb-3 text-3xl">{r.icon}</div>
              <h3 className="text-lg">{r.title}</h3>
              <p className="mt-1.5 flex-1 text-sm text-ink2">{r.desc}</p>
              <a
                href={r.href}
                target={r.href.startsWith("http") ? "_blank" : undefined}
                rel="noopener noreferrer"
                className="btn btn-secondary mt-4 w-full"
              >
                {r.cta} →
              </a>
            </div>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}
