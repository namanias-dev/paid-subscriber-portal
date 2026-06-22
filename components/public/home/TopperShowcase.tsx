"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import TopperCard from "@/components/public/TopperCard";
import type { Topper } from "@/lib/types";

function TiltCard({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

  if (reduce) return <>{children}</>;

  function onMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ rx: -py * 6, ry: px * 6 }); // subtle, max ~6deg
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={() => setTilt({ rx: 0, ry: 0 })}
      style={{ transformStyle: "preserve-3d", height: "100%" }}
      animate={{ rotateX: tilt.rx, rotateY: tilt.ry, scale: tilt.rx || tilt.ry ? 1.03 : 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 18 }}
    >
      {children}
    </motion.div>
  );
}

export default function TopperShowcase({
  toppers,
  heading,
  subtitle,
}: {
  toppers: Topper[];
  heading?: string;
  subtitle?: string;
}) {
  const reduce = useReducedMotion();
  if (!toppers?.length) return null;
  const list = [...toppers].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).slice(0, 8);

  return (
    <section className="section bg-surface">
      <div className="container-wide">
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="pill pill-blue mb-3">Our Results Speak</p>
          <h2 className="text-3xl font-extrabold sm:text-4xl">{heading || "Results that speak"}</h2>
          <p className="mt-2 text-ink2">{subtitle || "Real students. Real ranks — across UPSC CSE & IFoS."}</p>
        </motion.div>

        <motion.div
          className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
          style={{ perspective: 1000 }}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
        >
          {list.map((t) => (
            <motion.div
              key={t.id}
              variants={{
                hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 24 },
                show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
              }}
            >
              <TiltCard>
                <TopperCard topper={t} />
              </TiltCard>
            </motion.div>
          ))}
        </motion.div>

        <div className="mt-8 text-center">
          <Link href="/results" className="btn btn-primary">View All Results →</Link>
        </div>
      </div>
    </section>
  );
}
