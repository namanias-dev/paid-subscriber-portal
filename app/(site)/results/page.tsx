import Reveal, { Stagger, StaggerItem } from "@/components/ui/Reveal";
import Link from "next/link";

export const metadata = { title: "Results — Naman Sharma IAS Academy" };

const TOPPERS = [
  { air: "AIR 84", name: "" },
  { air: "AIR 122", name: "Shivani" },
  { air: "AIR 231", name: "Vineet" },
  { air: "AIR 245", name: "Sahil (IFoS)" },
  { air: "AIR 351", name: "Aditi" },
  { air: "AIR 434", name: "Manu" },
  { air: "AIR 617", name: "" },
  { air: "AIR 914", name: "Gourav" },
  { air: "AIR 944", name: "Rudraksh" },
];

const STORIES = [
  { name: "Manu Verma", air: "AIR 434", quote: "The small batch meant I could ask anything, anytime. Naman Sir's mentorship was the turning point in my preparation." },
  { name: "Aditi", air: "AIR 351", quote: "Daily content and consistent answer-writing feedback kept me on track. I never felt alone in this journey." },
];

export default function ResultsPage() {
  return (
    <div className="container-wide section">
      <Reveal>
        <p className="pill pill-blue mb-3">Results</p>
        <h1 className="text-4xl font-extrabold sm:text-5xl">Our students, their ranks</h1>
        <p className="mt-3 max-w-2xl text-ink2">Across UPSC CSE and IFoS — proof that personal mentorship works.</p>
      </Reveal>

      <Stagger className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {TOPPERS.map((t) => (
          <StaggerItem key={t.air}>
            <div className="card card-hover p-6 text-center">
              <div className="font-heading text-2xl font-extrabold text-primary">🏅 {t.air}</div>
              {t.name && <div className="mt-1 text-sm text-ink2">{t.name}</div>}
            </div>
          </StaggerItem>
        ))}
      </Stagger>

      <h2 className="mt-16 text-3xl font-extrabold">Topper stories</h2>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {STORIES.map((s) => (
          <Reveal key={s.name}>
            <div className="card p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-tint font-heading text-lg font-bold text-primary">
                  {s.name[0]}
                </div>
                <div>
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-sm text-primary">{s.air}</p>
                </div>
              </div>
              <p className="mt-4 leading-relaxed text-ink2">“{s.quote}”</p>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="mt-12 text-center">
        <Link href="/demo" className="btn btn-primary">Start your success story →</Link>
      </div>
    </div>
  );
}
