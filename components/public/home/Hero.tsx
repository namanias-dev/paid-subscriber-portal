"use client";

import Link from "next/link";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import AshokaChakra from "@/components/public/AshokaChakra";
import Counter from "@/components/ui/Counter";
import { DEFAULT_HERO } from "@/lib/homeDefaults";
import type { HeroConfig, HeroButtonStyle } from "@/lib/types";

const FLOAT_CARDS = [
  { label: "Prelims", icon: "🎯", x: "left-2 top-6", d: 0 },
  { label: "Mains", icon: "✍️", x: "right-2 top-16", d: 0.4 },
  { label: "Interview", icon: "🎙️", x: "left-6 bottom-10", d: 0.8 },
  { label: "Current Affairs", icon: "📰", x: "right-6 bottom-2", d: 1.2 },
];

const BTN_CLASS: Record<HeroButtonStyle, string> = {
  primary: "btn btn-primary",
  saffron: "btn btn-saffron",
  gold: "btn btn-gold",
  secondary: "btn btn-secondary",
};

const HIGHLIGHT = /^(naman|sir)[.,!]?$/i;

export default function Hero({ hero }: { hero?: HeroConfig }) {
  const reduce = useReducedMotion();
  const h = hero || DEFAULT_HERO;
  const headline = (h.headline || DEFAULT_HERO.headline!).trim();
  const words = headline.split(/\s+/);
  const stats = h.stats?.length ? h.stats : DEFAULT_HERO.stats!;
  const buttons = (h.buttons?.length ? h.buttons : DEFAULT_HERO.buttons!).filter((b) => b.enabled && b.label?.trim() && b.href?.trim());
  const portrait = h.portrait_url?.trim();

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
          {h.badge?.trim() && (
            <motion.span
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="pill pill-blue mb-5"
            >
              {h.badge}
            </motion.span>
          )}

          <h1 className="font-heading text-4xl font-extrabold leading-[1.08] sm:text-6xl">
            {words.map((w, i) => (
              <motion.span
                key={i}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className={`mr-2 inline-block ${HIGHLIGHT.test(w) ? "grad-text" : ""}`}
              >
                {w}
              </motion.span>
            ))}
          </h1>

          {h.subheading?.trim() && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55, duration: 0.5 }}
              className="mt-5 max-w-xl text-lg text-ink2"
            >
              {h.subheading}
            </motion.p>
          )}

          {buttons.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.5 }}
              className="mt-7 flex flex-wrap gap-3"
            >
              {buttons.map((b, i) => (
                <Link key={i} href={b.href} className={`${BTN_CLASS[b.style || "primary"]} px-6 text-base`}>
                  {b.label}
                </Link>
              ))}
            </motion.div>
          )}

          {stats.length > 0 && (
            <div className="mt-9 grid max-w-lg grid-cols-2 gap-4 sm:grid-cols-4">
              {stats.map((st, i) => (
                <Stat key={i} value={st.value} suffix={st.suffix} label={st.label} />
              ))}
            </div>
          )}
        </div>

        {/* Right visual: portrait when uploaded, otherwise the animated card cluster */}
        {portrait ? (
          <div className="relative mx-auto mt-4 w-full max-w-md lg:mt-0">
            {/* premium gradient/glow backdrop */}
            <div
              aria-hidden
              className="absolute inset-0 -z-0 mx-auto h-full w-[88%] rounded-[40%] blur-2xl"
              style={{ background: "radial-gradient(closest-side, rgba(0,87,255,0.22), rgba(201,162,39,0.12), transparent)" }}
            />
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10"
            >
              <Image
                src={portrait}
                alt={h.portrait_alt || "Naman Sir"}
                width={520}
                height={620}
                priority
                sizes="(max-width: 1024px) 80vw, 460px"
                className="mx-auto h-auto w-auto max-h-[300px] object-contain drop-shadow-2xl sm:max-h-[440px] lg:max-h-[520px]"
              />
            </motion.div>
            <motion.div
              animate={reduce ? {} : { y: [0, -10, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              className="absolute left-0 top-8 z-20 hidden rounded-2xl border border-line bg-white px-4 py-3 shadow-soft sm:block"
            >
              <div className="text-xl">🎯</div>
              <div className="text-sm font-semibold">Prelims to Interview</div>
            </motion.div>
            <motion.div
              animate={reduce ? {} : { y: [0, -8, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
              className="absolute bottom-6 right-0 z-20 hidden rounded-2xl border border-line bg-white px-4 py-3 shadow-soft sm:block"
            >
              <div className="text-xl">🏅</div>
              <div className="text-sm font-semibold">9+ Top AIRs</div>
            </motion.div>
          </div>
        ) : (
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

            {FLOAT_CARDS.map((card) => (
              <motion.div
                key={card.label}
                animate={reduce ? {} : { y: [0, -10, 0] }}
                transition={{ duration: 5 + card.d, repeat: Infinity, ease: "easeInOut", delay: card.d }}
                className={`absolute ${card.x} z-20 rounded-2xl border border-line bg-white px-4 py-3 shadow-soft`}
              >
                <div className="text-xl">{card.icon}</div>
                <div className="text-sm font-semibold">{card.label}</div>
              </motion.div>
            ))}
          </div>
        )}
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
