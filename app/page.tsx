import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import LoginForm from "@/components/layout/LoginForm";
import PlanCard from "@/components/ui/PlanCard";
import { PLANS } from "@/lib/config";

const WHAT_YOU_GET = [
  { icon: "📰", title: "Daily Current Affairs", desc: "Curated daily, exam-ready." },
  { icon: "📝", title: "Daily Prelims MCQs", desc: "Practice with explanations." },
  { icon: "📚", title: "Subject Booklets", desc: "Crisp revision material." },
  { icon: "🗂️", title: "PYQ Bank", desc: "Topic-wise previous years." },
  { icon: "✍️", title: "Answer Writing", desc: "Mains practice + models." },
  { icon: "🔴", title: "Live + Recordings", desc: "Learn live or anytime." },
];

const TRUST = [
  "414K+ Instagram",
  "AIR 84 Student",
  "3 UPSC 2025 Selections",
  "Chandigarh's #1 IAS Faculty",
];

const TOPPERS = [
  "AIR 84",
  "AIR 122 — Shivani",
  "AIR 231 — Vineet",
  "AIR 245 — Sahil (IFoS)",
  "AIR 351 — Aditi",
  "AIR 434 — Manu",
  "AIR 617",
  "AIR 914 — Gourav",
  "AIR 944 — Rudraksh",
];

export default function LandingPage() {
  return (
    <div id="top">
      <Navbar />

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-4 pb-10 pt-12 text-center sm:pt-16">
        <span className="pill pill-lifetime mx-auto">⭐ Premium UPSC Community</span>
        <h1 className="mx-auto mt-5 max-w-3xl font-heading text-4xl leading-tight text-text sm:text-6xl">
          Naman Sharma <span className="text-gold-light">IAS Academy</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted sm:text-lg">
          Join India&apos;s most personal UPSC preparation community. Daily current
          affairs, MCQs, booklets, PYQs, and live sessions — curated by Naman Sir.
        </p>

        <div className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-center gap-2">
          {TRUST.map((t) => (
            <span
              key={t}
              className="rounded-full border px-3 py-1.5 text-xs font-medium text-gold-light"
              style={{ borderColor: "var(--border)", background: "rgba(201,168,76,0.08)" }}
            >
              {t}
            </span>
          ))}
        </div>

        <div className="mt-8 flex justify-center gap-3">
          <a href="#plans" className="btn-gold">
            View Plans
          </a>
          <a href="#login" className="btn-outline">
            Login
          </a>
        </div>
      </section>

      {/* WHAT YOU GET */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="mb-6 text-center font-heading text-2xl text-text sm:text-3xl">
          What You Get
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WHAT_YOU_GET.map((f) => (
            <div key={f.title} className="card card-hover p-5">
              <div className="mb-2 text-3xl">{f.icon}</div>
              <h3 className="font-heading text-lg text-text">{f.title}</h3>
              <p className="mt-1 text-sm text-muted">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PLANS */}
      <section id="plans" className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="mb-2 text-center font-heading text-2xl text-text sm:text-3xl">
          Choose Your Plan
        </h2>
        <p className="mb-8 text-center text-sm text-muted">
          One subscription. Everything you need for UPSC CSE.
        </p>
        <div className="grid grid-cols-1 gap-6 pt-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </div>
      </section>

      {/* LOGIN */}
      <section id="login" className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-6 flex items-center gap-4">
          <div className="h-px flex-1" style={{ background: "var(--border)" }} />
          <span className="text-sm text-muted">Already a subscriber? Login here</span>
          <div className="h-px flex-1" style={{ background: "var(--border)" }} />
        </div>
        <LoginForm />
      </section>

      {/* SOCIAL PROOF */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="mb-6 text-center font-heading text-2xl text-text sm:text-3xl">
          Results That Speak
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TOPPERS.map((t) => (
            <div
              key={t}
              className="card p-4 text-center text-sm font-semibold text-gold-light"
            >
              🏅 {t}
            </div>
          ))}
        </div>

        <div className="card mx-auto mt-8 max-w-2xl p-6">
          <p className="font-heading text-lg italic text-text">
            &ldquo;Naman Sir&apos;s personal mentorship and daily content kept me
            consistent through the toughest months. The community made all the
            difference in my journey.&rdquo;
          </p>
          <p className="mt-3 text-sm text-gold-light">— IAS Manu Verma</p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
