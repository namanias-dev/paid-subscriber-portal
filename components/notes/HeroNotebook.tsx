"use client";

import { useEffect, useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import HeroCallouts from "./HeroCallouts";

const WIDTH = 900;
const HEIGHT = 1105;

export default function HeroNotebook() {
  const reduce = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 90, damping: 18, mass: 0.4 });
  const sy = useSpring(my, { stiffness: 90, damping: 18, mass: 0.4 });
  const rotateY = useTransform(sx, [-1, 1], [-2.6, 2.6]);
  const rotateX = useTransform(sy, [-1, 1], [1.6, -1.6]);
  const shiftX = useTransform(sx, [-1, 1], [-6, 6]);
  const { scrollYProgress } = useScroll({
    target: stageRef,
    offset: ["start end", "end start"],
  });
  const scrollLift = useTransform(scrollYProgress, [0.15, 0.7], [10, -8]);
  const scrollScale = useTransform(scrollYProgress, [0.15, 0.7], [0.985, 1.02]);

  useEffect(() => {
    if (reduce) return;
    const el = stageRef.current;
    if (!el) return;
    const fine = window.matchMedia("(pointer: fine) and (min-width: 1024px)");
    if (!fine.matches) return;

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      mx.set(Math.max(-1, Math.min(1, x)));
      my.set(Math.max(-1, Math.min(1, y)));
    };
    const onLeave = () => {
      mx.set(0);
      my.set(0);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [mx, my, reduce]);

  return (
    <div ref={stageRef} className="ns-notebook-stage mx-auto w-[min(94vw,420px)] sm:w-[min(80vw,520px)] lg:w-[min(54vw,620px)]">
      <motion.div
        className="relative"
        style={
          reduce
            ? undefined
            : {
                rotateX,
                rotateY,
                x: shiftX,
                y: scrollLift,
                scale: scrollScale,
                transformStyle: "preserve-3d",
              }
        }
        initial={reduce ? false : { opacity: 0, y: 16, scale: 0.97, rotateZ: -1.2 }}
        animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1, rotateZ: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="ns-notebook-frame">
          <div className={`ns-notebook-art relative ${reduce ? "" : "max-lg:ns-notebook-float"}`}>
            <div className="ns-notebook-shadow-warm" aria-hidden="true" />
            <div className="ns-notebook-shadow-depth" aria-hidden="true" />
            <div className="ns-notebook-shadow-contact" aria-hidden="true" />
            <picture>
              <source media="(max-width: 640px)" srcSet="/notes/hero-notebook-sm.webp" type="image/webp" />
              <source srcSet="/notes/hero-notebook.webp" type="image/webp" />
              <img
                src="/notes/hero-notebook.png"
                alt="Naman Sir's spiral-bound handwritten UPSC notes"
                width={WIDTH}
                height={HEIGHT}
                decoding="async"
                fetchPriority="high"
                className="relative z-[1] h-auto w-full select-none"
                draggable={false}
              />
            </picture>
            <div className="ns-notebook-sweep z-[2] rounded-[2px]" aria-hidden="true" />
            <div
              className="pointer-events-none absolute inset-[8%] z-[2] rounded-[40%_12%_18%_30%] bg-[radial-gradient(ellipse_at_30%_20%,rgba(255,255,255,0.22),transparent_46%)]"
              aria-hidden="true"
            />
            <div className="ns-notebook-rim" aria-hidden="true" />
          </div>
          <HeroCallouts />
        </div>
      </motion.div>
    </div>
  );
}
