"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import AshokaChakra from "@/components/public/AshokaChakra";
import Counter from "@/components/ui/Counter";
import { ACADEMY } from "@/lib/config";

const HEAD = "Crack UPSC the Right Way — with Naman Sir".split(" ");
const FLOAT_CARDS = [
  { label: "Prelims", icon: "🎯", x: "left-2 top-6", d: 0 },
  { label: "Mains", icon: "✍️", x: "right-2 top-16", d: 0.4 },
  { label: "Interview", icon: "🎙️", x: "left-6 bottom-10", d: 0.8 },
  { label: "Current Affairs", icon: "📰", x: "right-6 bottom-2", d: 1.2 },
];

export default function Hero() {
  const reduce = useReducedMotion();
  return (
    <section className="relative overflow-hidden bg-dotted">
      <div className="pointer-events-none absolute -left-20 -top-24 -z-0">
        <AshokaChakra size={420} opacity={0.05} />
      </div>
      <div className="pointer-events-none absolute -bottom-28 -right-24 -z-0">
        <AshokaChakra size={360} opacity={0.04} />
      </div>

      <div className="container-wide grid items-center gap-10 py-16 sm:py-24 lg:grid-cols-2">
        <div>
          <motion.span
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="pill pill-blue mb-5"
          >
            ⭐ Chandigarh&apos;s #1 Personal UPSC Academy
          </motion.span>

          <h1 className="font-heading text-4xl font-extrabold leading-[1.08] sm:text-6xl">
            {HEAD.map((w, i) => (
              <motion.span
                key={i}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.07, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className={`mr-2 inline-block ${w === "Naman" || w === "Sir" ? "grad-text" : ""}`}
              >
                {w}
              </motion.span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="mt-5 max-w-xl text-lg text-ink2"
          >
            Chandigarh&apos;s most personal UPSC academy. Foundation, Optionals, Test Series &
            Mentorship — Online, Offline & Hybrid.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.75, duration: 0.5 }}
            className="mt-7 flex flex-wrap gap-3"
          >
            <Link href="/demo" className="btn btn-primary px-6 text-base">Book Free Demo</Link>
            <Link href="/courses/beginner-upsc-masterclass" className="btn btn-saffron px-6 text-base">
              ₹50 Beginner Masterclass
            </Link>
          </motion.div>

          <div className="mt-9 grid max-w-lg grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat value={388} suffix="K+" label="Instagram" />
            <Stat value={220} suffix="K+" label="YouTube" />
            <Stat value={9} suffix="+" label="Years" />
            <Stat value={9} suffix="+" label="Top AIRs" />
          </div>
        </div>

        {/* Floating visual */}
        <div className="relative mx-auto hidden h-[420px] w-full max-w-md lg:block">
          <motion.div
            animate={reduce ? {} : { y: [0, -12, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            className="card absolute inset-x-6 top-10 z-10 p-5 shadow-soft-lg"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white">▶</div>
              <div>
                <p className="font-semibold">Today&apos;s Live Class</p>
                <p className="text-xs text-muted">Ethics — Case Studies · 8:00 PM</p>
              </div>
            </div>
            <div className="mt-4 h-2 w-full rounded-full bg-surface">
              <div className="h-2 w-2/3 rounded-full bg-primary" />
            </div>
            <p className="mt-2 text-xs text-muted">68% of aspirants joined live today</p>
          </motion.div>

          {FLOAT_CARDS.map((c) => (
            <motion.div
              key={c.label}
              animate={reduce ? {} : { y: [0, -10, 0] }}
              transition={{ duration: 5 + c.d, repeat: Infinity, ease: "easeInOut", delay: c.d }}
              className={`absolute ${c.x} z-20 rounded-2xl border border-line bg-white px-4 py-3 shadow-soft`}
            >
              <div className="text-xl">{c.icon}</div>
              <div className="text-sm font-semibold">{c.label}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  return (
    <div>
      <div className="font-heading text-2xl font-extrabold text-ink">
        <Counter value={value} suffix={suffix} />
      </div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
