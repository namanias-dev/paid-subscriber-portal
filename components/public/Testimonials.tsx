"use client";

import { motion } from "framer-motion";

const ITEMS = [
  { name: "IAS Manu Verma", air: "AIR 434", quote: "Naman Sir's personal mentorship and daily content kept me consistent through the toughest months." },
  { name: "Aditi", air: "AIR 351", quote: "The small batch meant I never felt lost. Direct faculty access changed my preparation." },
  { name: "Shivani", air: "AIR 122", quote: "Best answer-writing feedback I've received. Genuinely personal guidance." },
  { name: "Vineet", air: "AIR 231", quote: "Chandigarh se bhi UPSC crack hota hai — Naman Sir proved it for me." },
  { name: "Gourav", air: "AIR 914", quote: "Affordable, sincere and effective. The test series was a game-changer." },
];

export default function Testimonials() {
  const doubled = [...ITEMS, ...ITEMS];
  return (
    <div className="no-scrollbar overflow-hidden">
      <motion.div
        className="flex gap-4"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        drag="x"
        dragConstraints={{ left: -1000, right: 0 }}
      >
        {doubled.map((t, i) => (
          <div key={i} className="card w-[300px] shrink-0 p-5">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-tint font-heading font-bold text-primary">
                {t.name.split(" ").pop()?.[0]}
              </div>
              <div>
                <p className="text-sm font-semibold">{t.name}</p>
                <p className="text-xs text-primary">{t.air}</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-ink2">“{t.quote}”</p>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
