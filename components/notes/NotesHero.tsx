"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import HeroNotebook from "./HeroNotebook";

const TRUST = [
  { t: "Handwritten", d: "by Naman Sir" },
  { t: "Exam-focused", d: "& concise" },
  { t: "Diagrams &", d: "flowcharts" },
  { t: "Premium", d: "hard copies" },
  { t: "Pan-India", d: "delivery" },
];

export default function NotesHero() {
  const reduce = useReducedMotion();
  const enter = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.48, delay, ease: [0.22, 1, 0.36, 1] as const } };

  return (
    <header className="ns-hero-light">
      <div className="container-wide relative grid items-center gap-8 py-10 sm:py-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-6 lg:py-16">
        <div className="order-1 text-center lg:text-left">
          <motion.p className="ca-eyebrow text-[var(--ca-gold-dark)]" {...enter(0)}>
            Handwritten by Naman Sir
          </motion.p>
          <motion.h1
            className="mt-3 font-heading text-[2rem] font-extrabold leading-[1.08] tracking-tight text-[var(--ca-navy)] sm:text-5xl lg:max-w-xl lg:text-[3.35rem]"
            {...enter(0.08)}
          >
            <span className="lg:hidden">
              Naman Sir&apos;s
              <br />
              handwritten
              <br />
              UPSC notes
            </span>
            <span className="hidden lg:inline">
              Notes that
              <br />
              create officers.
            </span>
          </motion.h1>
          <motion.p
            className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[var(--ca-navy)]/62 sm:text-base lg:mx-0"
            {...enter(0.16)}
          >
            Naman Sir&apos;s handwritten UPSC notes — professionally printed and delivered to your doorstep.
          </motion.p>
          <motion.div
            className="mt-6 hidden flex-wrap items-center justify-center gap-3 lg:flex lg:justify-start"
            {...enter(0.24)}
          >
            <Link href="#catalogue" className="ca-btn ca-btn-gold ca-focus ns-press group rounded-full px-6">
              Shop notes
              <span aria-hidden="true" className="inline-block transition-transform duration-200 group-hover:translate-x-1">
                →
              </span>
            </Link>
            <Link href="#bundles" className="ca-btn ca-btn-outline ca-focus ns-press rounded-full px-6">
              Explore bundles
            </Link>
          </motion.div>
        </div>

        <div className="order-2 lg:order-2">
          <HeroNotebook />
        </div>

        <motion.div className="order-3 flex flex-col items-center gap-5 lg:col-span-2 lg:items-stretch" {...enter(0.28)}>
          <div className="flex w-full flex-wrap items-center justify-center gap-3 lg:hidden">
            <Link href="#catalogue" className="ca-btn ca-btn-gold ca-focus ns-press group min-w-[11.5rem] rounded-full px-6">
              Shop notes
              <span aria-hidden="true" className="inline-block transition-transform duration-200 group-hover:translate-x-1">
                →
              </span>
            </Link>
            <Link href="#bundles" className="ca-btn ca-btn-outline ca-focus ns-press rounded-full px-6">
              Explore bundles
            </Link>
          </div>
          <ul className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {TRUST.map((item, i) => (
              <motion.li
                key={item.t}
                className="rounded-2xl border border-[var(--ca-navy)]/8 bg-white/80 px-3 py-2.5 text-left ns-elev-1"
                {...(reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, delay: 0.32 + i * 0.05 } })}
              >
                <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--ca-navy)]">{item.t}</p>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ca-navy)]/50">{item.d}</p>
              </motion.li>
            ))}
          </ul>
        </motion.div>
      </div>
    </header>
  );
}
