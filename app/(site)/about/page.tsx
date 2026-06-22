import Reveal, { Stagger, StaggerItem } from "@/components/ui/Reveal";
import Counter from "@/components/ui/Counter";
import Link from "next/link";
import { getSiteSettings } from "@/lib/dataProvider";
import { DEFAULT_ABOUT } from "@/lib/homeDefaults";

export const metadata = { title: "About — Naman Sharma IAS Academy" };
export const dynamic = "force-dynamic";

export default async function AboutPage() {
  const settings = await getSiteSettings();
  const about = settings.about || DEFAULT_ABOUT;
  const mentorParas = (about.mentor_body || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const values = about.values?.length ? about.values : DEFAULT_ABOUT.values || [];

  return (
    <div>
      <section className="section container-wide">
        <Reveal>
          <p className="pill pill-blue mb-3">{about.hero_eyebrow || DEFAULT_ABOUT.hero_eyebrow}</p>
          <h1 className="max-w-3xl text-4xl font-extrabold sm:text-5xl">
            {about.hero_title || DEFAULT_ABOUT.hero_title}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-ink2">{about.hero_intro || DEFAULT_ABOUT.hero_intro}</p>
        </Reveal>

        <Stagger className="mt-10 grid gap-5 sm:grid-cols-4">
          {[
            { v: 388, s: "K+", l: "Instagram" },
            { v: 220, s: "K+", l: "YouTube" },
            { v: 9, s: "+", l: "Years" },
            { v: 9, s: "+", l: "Top AIRs" },
          ].map((x) => (
            <StaggerItem key={x.l}>
              <div className="card p-6 text-center">
                <div className="font-heading text-3xl font-extrabold text-primary">
                  <Counter value={x.v} suffix={x.s} />
                </div>
                <div className="mt-1 text-sm text-muted">{x.l}</div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="section bg-surface">
        <div className="container-wide grid gap-8 lg:grid-cols-2">
          <Reveal>
            <h2 className="text-3xl font-extrabold">{about.mentor_heading || DEFAULT_ABOUT.mentor_heading}</h2>
            {mentorParas.map((p, i) => (
              <p key={i} className="mt-3 text-ink2">{p}</p>
            ))}
            <Link href="/demo" className="btn btn-primary mt-6">Book a free demo →</Link>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="card flex h-72 items-center justify-center bg-primary-tint text-6xl">🎓</div>
          </Reveal>
        </div>
      </section>

      <section className="section container-wide">
        <Reveal>
          <h2 className="text-3xl font-extrabold">{about.values_heading || DEFAULT_ABOUT.values_heading}</h2>
        </Reveal>
        <Stagger className="mt-8 grid gap-5 sm:grid-cols-3">
          {values.map((v, i) => (
            <StaggerItem key={i}>
              <div className="card card-hover h-full p-6">
                <div className="mb-3 text-3xl">{v.icon}</div>
                <h3 className="text-lg">{v.title}</h3>
                <p className="mt-1.5 text-sm text-ink2">{v.desc}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>
    </div>
  );
}
