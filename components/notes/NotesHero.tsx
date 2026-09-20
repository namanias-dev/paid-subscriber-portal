"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import NotebookStack from "./NotebookStack";

export default function NotesHero({
  coverUrl,
  title,
  subject,
}: {
  coverUrl?: string | null;
  title?: string | null;
  subject?: string | null;
}) {
  const reduce = useReducedMotion();
  const enter = reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 } };

  return (
    <header className="ca-dark ca-grain relative overflow-hidden">
      <div className="ca-orb" style={{ width: 320, height: 320, top: -130, right: -70, background: "rgba(212,175,55,0.16)" }} />
      <div className="container-wide relative grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
        <div>
          <motion.p className="ca-eyebrow" {...enter} transition={{ duration: 0.4 }}>
            UPSC Notes by Naman Sir
          </motion.p>
          <motion.h1
            className="ca-hero-title mt-3 max-w-xl font-heading text-3xl font-extrabold leading-[1.12] tracking-tight sm:text-5xl"
            {...enter}
            transition={{ duration: 0.5, delay: reduce ? 0 : 0.08 }}
          >
            Physical notes for serious UPSC preparation.
          </motion.h1>
          <motion.p
            className="mt-4 max-w-md text-sm leading-relaxed text-[var(--ca-slate-300)] sm:text-base"
            {...enter}
            transition={{ duration: 0.45, delay: reduce ? 0 : 0.16 }}
          >
            Handwritten / structured classroom notes. Hard copies, PAN-India delivery, actual sample pages on live titles.
          </motion.p>
          <motion.div className="mt-7 flex flex-wrap gap-3" {...enter} transition={{ duration: 0.45, delay: reduce ? 0 : 0.24 }}>
            <Link href="#catalogue" className="ca-btn ca-btn-gold rounded-full px-6">
              Explore Notes
            </Link>
            <Link href="#bundles" className="ca-btn ca-btn-glass rounded-full px-6">
              View Complete Bundles
            </Link>
          </motion.div>
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
            Prepared by Naman Sir · Physical Notes · Trackable Delivery
          </p>
        </div>
        <motion.div {...enter} transition={{ duration: 0.55, delay: reduce ? 0 : 0.12 }} className="px-6 sm:px-10">
          <NotebookStack coverUrl={coverUrl} title={title} subject={subject} />
        </motion.div>
      </div>
    </header>
  );
}
