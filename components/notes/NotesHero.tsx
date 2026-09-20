"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import HeroNotebook from "./HeroNotebook";

function TrustMark() {
  return (
    <div className="ns-trust-mark">
      <span className="ns-trust-mark-seal" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none" className="h-full w-full">
          <path
            d="M15.2 5.2c-2.6 1.4-4.7 3.7-5.8 6.4-1.2 2.8-1.1 5.6.1 7.6"
            stroke="currentColor"
            strokeWidth="1.15"
            strokeLinecap="round"
          />
          <path
            d="M16.8 5.2c2.6 1.4 4.7 3.7 5.8 6.4 1.2 2.8 1.1 5.6-.1 7.6"
            stroke="currentColor"
            strokeWidth="1.15"
            strokeLinecap="round"
          />
          <path d="M11.4 8.6c1.6.4 2.8 1.4 3.4 2.6" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" />
          <path d="M20.6 8.6c-1.6.4-2.8 1.4-3.4 2.6" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" />
          <path d="M10.2 12.2c1.5.2 2.6 1 3.2 2.1" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" />
          <path d="M21.8 12.2c-1.5.2-2.6 1-3.2 2.1" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" />
          <path
            d="M12.6 20.6 15.3 23.2 20.2 17.8"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="min-w-0 text-left">
        <span className="ns-trust-mark-title">Trusted by UPSC toppers</span>
        <span className="ns-trust-mark-sub">Proven UPSC results</span>
      </span>
    </div>
  );
}

function ShopCtas({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-3 lg:justify-start ${className}`}>
      <Link href="#catalogue" className="ca-btn ca-btn-gold ca-focus ns-press group rounded-full px-6">
        Shop UPSC Notes
        <span aria-hidden="true" className="inline-block transition-transform duration-200 group-hover:translate-x-1">
          →
        </span>
      </Link>
      <Link href="#bundles" className="ca-btn ca-btn-outline ca-focus ns-press rounded-full px-6">
        Explore bundles
      </Link>
    </div>
  );
}

export default function NotesHero() {
  const reduce = useReducedMotion();
  const enter = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.46, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <header className="ns-hero-light">
      <div className="container-wide relative grid items-center gap-5 py-7 sm:gap-7 sm:py-12 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] lg:gap-8 lg:py-16">
        <div className="order-1 text-center lg:text-left">
          <motion.div className="flex justify-center lg:justify-start" {...enter(0)}>
            <TrustMark />
          </motion.div>
          <motion.h1
            className="mt-3.5 font-heading text-[clamp(1.5rem,6.1vw,2.15rem)] font-extrabold leading-[1.12] tracking-tight text-[var(--ca-navy)] sm:text-4xl lg:max-w-xl lg:text-[3.15rem] lg:leading-[1.08]"
            {...enter(0.07)}
          >
            <span className="block whitespace-nowrap">Naman Sir&apos;s UPSC Notes.</span>
            <span className="block whitespace-nowrap">Delivered to Your Door.</span>
          </motion.h1>
          <motion.div className="mx-auto mt-3 max-w-md lg:mx-0" {...enter(0.14)}>
            <p className="text-[0.95rem] font-semibold leading-snug text-[var(--ca-navy)]/78 sm:text-base">
              Handwritten by Naman Sir. Professionally printed. Built for UPSC.
            </p>
            <p className="mt-1.5 text-[0.8rem] leading-relaxed text-[var(--ca-navy)]/50 sm:text-sm">
              Exam-focused hard copies for smarter study and faster revision, delivered across India.
            </p>
          </motion.div>
          <motion.div className="mt-5" {...enter(0.2)}>
            <ShopCtas />
          </motion.div>
        </div>

        <div className="order-2">
          <HeroNotebook />
          <p className="ns-hero-narrow-proof">Premium hard copies · Pan-India delivery</p>
        </div>
      </div>
    </header>
  );
}
