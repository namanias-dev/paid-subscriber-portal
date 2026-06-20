import Reveal, { Stagger, StaggerItem } from "@/components/ui/Reveal";
import Counter from "@/components/ui/Counter";
import Link from "next/link";
import { ACADEMY } from "@/lib/config";

export const metadata = { title: "About — Naman Sharma IAS Academy" };

export default function AboutPage() {
  return (
    <div>
      <section className="section container-wide">
        <Reveal>
          <p className="pill pill-blue mb-3">About</p>
          <h1 className="max-w-3xl text-4xl font-extrabold sm:text-5xl">
            9+ years of making UPSC personal in <span className="grad-text">Chandigarh</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-ink2">
            Naman Sharma IAS Academy was built on one belief — that sincere, personal mentorship
            beats crowded coaching halls. With small batches, direct faculty access and a
            results-first culture, we&apos;ve helped aspirants secure top ranks across UPSC CSE & IFoS.
          </p>
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
            <h2 className="text-3xl font-extrabold">Meet Naman Sir</h2>
            <p className="mt-3 text-ink2">
              A mentor known for clarity, consistency and a genuinely personal approach. Naman Sir
              has guided thousands of aspirants with daily current affairs, structured foundation
              courses, optionals and rigorous test series — online, offline and hybrid.
            </p>
            <p className="mt-3 text-ink2">&quot;Chandigarh se bhi UPSC crack hota hai&quot; isn&apos;t a slogan — it&apos;s a promise we keep every year.</p>
            <Link href="/demo" className="btn btn-primary mt-6">Book a free demo →</Link>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="card flex h-72 items-center justify-center bg-primary-tint text-6xl">🎓</div>
          </Reveal>
        </div>
      </section>

      <section className="section container-wide">
        <Reveal>
          <h2 className="text-3xl font-extrabold">Our values</h2>
        </Reveal>
        <Stagger className="mt-8 grid gap-5 sm:grid-cols-3">
          {[
            { i: "🤝", t: "Personal first", d: "Every student matters. Small batches, real attention." },
            { i: "📈", t: "Results-driven", d: "Proven methods, refined over 9+ years." },
            { i: "💛", t: "Accessible", d: "Affordable, honest, and student-friendly pricing." },
          ].map((v) => (
            <StaggerItem key={v.t}>
              <div className="card card-hover h-full p-6">
                <div className="mb-3 text-3xl">{v.i}</div>
                <h3 className="text-lg">{v.t}</h3>
                <p className="mt-1.5 text-sm text-ink2">{v.d}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>
    </div>
  );
}
