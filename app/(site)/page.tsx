import Link from "next/link";
import Hero from "@/components/public/home/Hero";
import CourseExplorer from "@/components/public/home/CourseExplorer";
import Testimonials from "@/components/public/Testimonials";
import Reveal, { Stagger, StaggerItem } from "@/components/ui/Reveal";
import Accordion from "@/components/ui/Accordion";
import LeadForm from "@/components/public/LeadForm";
import { getPublishedCourses, getWebinars } from "@/lib/dataProvider";
import { ACADEMY } from "@/lib/config";

const TOPPERS = [
  "AIR 84", "AIR 122 · Shivani", "AIR 231 · Vineet", "AIR 245 · Sahil (IFoS)",
  "AIR 351 · Aditi", "AIR 434 · Manu", "AIR 617", "AIR 914 · Gourav", "AIR 944 · Rudraksh",
];

const WHY = [
  { icon: "👥", title: "Small batches (~40)", desc: "Personal attention for every aspirant — not a crowded hall." },
  { icon: "🎓", title: "9+ years of mentoring", desc: "A proven, refined methodology that produces results." },
  { icon: "🤝", title: "Direct faculty mentorship", desc: "Learn from Naman Sir directly, with 1:1 guidance." },
  { icon: "📍", title: "Chandigarh se bhi UPSC", desc: "World-class preparation, right here in the Tricity." },
];

const MODES = [
  { icon: "🏛️", title: "Offline — Chandigarh", desc: "Classroom batches at Sector 17C." },
  { icon: "💻", title: "Live Online — Pan India", desc: "Interactive live classes from anywhere." },
  { icon: "🎥", title: "Recorded", desc: "Self-paced learning, anytime access." },
  { icon: "🔀", title: "Hybrid", desc: "Best of both — class + recordings." },
];

const FAQ = [
  { q: "Do you teach in Hindi or English?", a: "Our classes are bilingual (Hinglish) so every aspirant can follow comfortably." },
  { q: "Are batches small?", a: "Yes — we deliberately keep batches around 40 students for genuine personal attention." },
  { q: "Can I attend from outside Chandigarh?", a: "Absolutely. Our Live Online and Recorded modes serve aspirants across India." },
  { q: "Is there an EMI option?", a: "Yes, most foundation programs offer easy monthly EMI. See each course page for details." },
  { q: "How do I start?", a: "Book a free demo or join the ₹50 beginner masterclass to experience our teaching first." },
];

export default async function HomePage() {
  const [courses, webinars] = await Promise.all([getPublishedCourses(), getWebinars()]);
  const upcoming = webinars.filter((w) => w.status === "upcoming").slice(0, 2);

  return (
    <>
      <Hero />

      {/* Trust bar */}
      <div className="border-y border-line bg-surface2">
        <div className="container-wide flex flex-wrap items-center justify-center gap-x-8 gap-y-2 py-4 text-sm font-medium text-ink2">
          <span>⭐ 388K+ Instagram</span>
          <span className="h-4 w-px bg-line" />
          <span>▶ 220K+ YouTube</span>
          <span className="h-4 w-px bg-line" />
          <span>🏅 9+ Top AIRs</span>
          <span className="h-4 w-px bg-line" />
          <span>📚 9+ Years</span>
          <span className="h-4 w-px bg-line" />
          <span>📍 Chandigarh Sector 17C</span>
        </div>
        <div className="h-1 w-full" style={{ background: "linear-gradient(90deg,#FF9933,#fff,#138808)" }} />
      </div>

      {/* Why Naman Sir */}
      <section className="section container-wide">
        <Reveal>
          <p className="pill pill-blue mb-3">Why Naman Sir</p>
          <h2 className="max-w-2xl text-3xl font-extrabold sm:text-4xl">A genuinely personal way to prepare for UPSC</h2>
        </Reveal>
        <Stagger className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {WHY.map((w) => (
            <StaggerItem key={w.title}>
              <div className="card card-hover h-full p-6">
                <div className="mb-3 text-3xl">{w.icon}</div>
                <h3 className="text-lg">{w.title}</h3>
                <p className="mt-1.5 text-sm text-ink2">{w.desc}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* Learning modes */}
      <section className="section bg-surface">
        <div className="container-wide">
          <Reveal>
            <h2 className="text-3xl font-extrabold sm:text-4xl">Learn your way</h2>
            <p className="mt-2 text-ink2">Online, offline, recorded or hybrid — your schedule, your choice.</p>
          </Reveal>
          <Stagger className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {MODES.map((m) => (
              <StaggerItem key={m.title}>
                <div className="card card-hover h-full p-6">
                  <div className="mb-3 text-3xl">{m.icon}</div>
                  <h3 className="text-lg">{m.title}</h3>
                  <p className="mt-1.5 text-sm text-ink2">{m.desc}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Course explorer */}
      <section className="section container-wide">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-3xl font-extrabold sm:text-4xl">Explore our courses</h2>
              <p className="mt-2 text-ink2">Foundation to optionals, test series to mentorship.</p>
            </div>
            <Link href="/courses" className="btn btn-secondary">View all courses →</Link>
          </div>
        </Reveal>
        <div className="mt-8">
          <CourseExplorer courses={courses} limit={6} />
        </div>
      </section>

      {/* Results wall */}
      <section className="section bg-surface">
        <div className="container-wide">
          <Reveal>
            <h2 className="text-3xl font-extrabold sm:text-4xl">Results that speak</h2>
            <p className="mt-2 text-ink2">Our students, their ranks — across UPSC CSE & IFoS.</p>
          </Reveal>
          <Stagger className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {TOPPERS.map((t) => (
              <StaggerItem key={t}>
                <div className="card p-4 text-center text-sm font-semibold text-primary">🏅 {t}</div>
              </StaggerItem>
            ))}
          </Stagger>
          <div className="mt-6 text-center">
            <Link href="/results" className="btn btn-secondary">See topper stories →</Link>
          </div>
        </div>
      </section>

      {/* Free resources */}
      <section className="section container-wide">
        <Reveal>
          <h2 className="text-3xl font-extrabold sm:text-4xl">Free resources to get started</h2>
        </Reveal>
        <Stagger className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: "📰", t: "Daily Current Affairs" },
            { icon: "📝", t: "Daily MCQs" },
            { icon: "📚", t: "Free PDFs & Notes" },
            { icon: "✈️", t: "Join Telegram (23K+)" },
          ].map((r) => (
            <StaggerItem key={r.t}>
              <Link href="/free-resources" className="card card-hover block p-6">
                <div className="mb-3 text-3xl">{r.icon}</div>
                <h3 className="text-base">{r.t}</h3>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* Webinar / demo band */}
      <section className="section">
        <div className="container-wide">
          <div className="rounded-2xl bg-primary p-8 text-white sm:p-12" style={{ backgroundImage: "linear-gradient(135deg,#0057FF,#3D8BFF)" }}>
            <div className="grid items-center gap-6 lg:grid-cols-2">
              <div>
                <h2 className="text-3xl font-extrabold text-white sm:text-4xl">Start for just ₹50</h2>
                <p className="mt-2 max-w-md text-white/90">Join the Beginner Masterclass or book a 1-week demo and experience our teaching before you commit.</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/courses/beginner-upsc-masterclass" className="btn bg-white px-6 text-primary">₹50 Masterclass</Link>
                  <Link href="/demo" className="btn btn-secondary border-white px-6 text-white hover:bg-white/10">1-Week Demo</Link>
                </div>
              </div>
              <div className="grid gap-3">
                {upcoming.map((w) => (
                  <Link key={w.id} href={`/webinars/${w.slug}`} className="rounded-xl bg-white/10 p-4 backdrop-blur hover:bg-white/15">
                    <p className="font-semibold text-white">{w.title}</p>
                    <p className="text-sm text-white/80">{w.registrations.toLocaleString("en-IN")} registered</p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="section bg-surface">
        <div className="container-wide">
          <Reveal>
            <h2 className="text-3xl font-extrabold sm:text-4xl">What aspirants say</h2>
          </Reveal>
        </div>
        <div className="mt-8">
          <Testimonials />
        </div>
      </section>

      {/* Locations */}
      <section className="section container-wide">
        <div className="grid items-center gap-8 lg:grid-cols-2">
          <Reveal>
            <h2 className="text-3xl font-extrabold sm:text-4xl">Visit us in Chandigarh</h2>
            <p className="mt-2 text-ink2">Our flagship offline centre is at {ACADEMY.address}. We serve aspirants across the region.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {ACADEMY.citiesServed.map((c) => (
                <span key={c} className="pill pill-gray">{c}</span>
              ))}
            </div>
            <Link href="/contact" className="btn btn-primary mt-6">Get directions & contact →</Link>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="card overflow-hidden p-0">
              <iframe
                title="Chandigarh Sector 17C"
                src="https://www.google.com/maps?q=Sector%2017C%20Chandigarh&output=embed"
                className="h-72 w-full border-0"
                loading="lazy"
              />
            </div>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section className="section bg-surface">
        <div className="container-x">
          <Reveal>
            <h2 className="text-center text-3xl font-extrabold sm:text-4xl">Frequently asked questions</h2>
          </Reveal>
          <div className="mx-auto mt-8 max-w-3xl">
            <Accordion items={FAQ} />
          </div>
        </div>
      </section>

      {/* Lead capture */}
      <section className="section container-x">
        <div className="card p-8 sm:p-10">
          <div className="grid items-center gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-extrabold">Get free counselling</h2>
              <p className="mt-2 text-ink2">Talk to our team and build a personalised UPSC roadmap — completely free.</p>
            </div>
            <LeadForm source="Website" campaign="Home Counselling" compact />
          </div>
        </div>
      </section>
    </>
  );
}
