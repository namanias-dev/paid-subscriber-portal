"use client";

import { useEffect, useState } from "react";
import { isDemoMode } from "@/lib/config";

const KEY = "naman_demo_banner_dismissed";

export default function DemoBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isDemoMode && localStorage.getItem(KEY) !== "1") {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  return (
    <div
      className="flex items-center justify-center gap-3 px-4 py-2 text-center text-xs font-semibold sm:text-sm"
      style={{
        background: "linear-gradient(90deg, rgba(201,168,76,0.18), rgba(232,201,106,0.18))",
        borderBottom: "1px solid var(--border)",
        color: "var(--gold-light)",
      }}
    >
      <span>🚧 Demo Mode — add your keys in Vercel to go live.</span>
      <button
        aria-label="Dismiss"
        onClick={() => {
          localStorage.setItem(KEY, "1");
          setShow(false);
        }}
        className="ml-1 rounded px-2 py-0.5 text-base leading-none hover:bg-white/10"
      >
        ×
      </button>
    </div>
  );
}
