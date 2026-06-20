import Reveal from "@/components/ui/Reveal";
import LeadForm from "@/components/public/LeadForm";

export const metadata = { title: "Book a Free Demo — Naman Sharma IAS Academy" };

export default function DemoPage() {
  return (
    <div className="container-wide section">
      <div className="grid items-start gap-10 lg:grid-cols-2">
        <Reveal>
          <p className="pill pill-blue mb-3">Free Demo & Counselling</p>
          <h1 className="text-4xl font-extrabold sm:text-5xl">Experience our teaching before you commit</h1>
          <p className="mt-4 text-lg text-ink2">
            Get a 1-week demo of live classes plus a free 1:1 counselling call to plan your UPSC journey.
          </p>
          <ul className="mt-6 space-y-3 text-ink2">
            {[
              "Attend real live classes for a full week",
              "Personalised strategy & subject guidance",
              "Clarity on the right course & optional for you",
              "Zero pressure, completely free",
            ].map((x) => (
              <li key={x} className="flex items-start gap-2">
                <span className="text-success">✓</span> {x}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="card p-6 sm:p-8">
            <h3 className="text-xl">Book your free demo</h3>
            <p className="mt-1 text-sm text-ink2">Fill this and our team will call you to schedule.</p>
            <div className="mt-5">
              <LeadForm source="Demo" campaign="Free Demo" cta="Book My Free Demo" />
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
