"use client";

import { motion, useReducedMotion } from "framer-motion";

type Callout = {
  id: "print" | "auth" | "deliver";
  kicker: string;
  line: string;
  live?: boolean;
};

const CALLOUTS: Callout[] = [
  { id: "print", kicker: "Premium", line: "Printed hard copy" },
  { id: "auth", kicker: "Handwritten", line: "By Naman Sir" },
  { id: "deliver", kicker: "Now delivering", line: "Pan-India", live: true },
];

export default function HeroCallouts() {
  const reduce = useReducedMotion();

  return (
    <ul className="ns-callouts" aria-hidden="true">
      {CALLOUTS.map((item, i) => {
        const delay = 0.74 + i * 0.12;
        return (
          <motion.li
            key={item.id}
            className={`ns-callout ns-callout--${item.id}`}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, delay, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="ns-callout-copy">
              <span className="ns-callout-kicker">
                {item.live && <span className="ns-callout-live" />}
                {item.kicker}
              </span>
              <span className="ns-callout-line">{item.line}</span>
            </span>
            <span className="ns-callout-leader">
              <motion.span
                className="ns-callout-stem"
                initial={reduce ? false : { scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={{ duration: 0.38, delay: delay + 0.04, ease: [0.22, 1, 0.36, 1] }}
              />
              <motion.span
                className="ns-callout-dot"
                initial={reduce ? false : { scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.28, delay: delay + 0.16, ease: [0.22, 1, 0.36, 1] }}
              />
            </span>
          </motion.li>
        );
      })}
    </ul>
  );
}
