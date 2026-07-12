"use client";

import { createContext, useCallback, useContext, useState } from "react";
import DrillPanel from "@/components/neural/DrillPanel";

type DrillTarget = { domain: string; metric: string; label: string };
type DrillCtx = { openDrill: (t: DrillTarget) => void };

const Ctx = createContext<DrillCtx | null>(null);

/**
 * App-wide drill host: renders ONE shared drill panel (the existing read-only record view)
 * so any summary card, KPI, funnel bar, or attention flag anywhere in AIVA can open the
 * records behind a number via useDrill().openDrill(...). Mounted once in the /aiva layout.
 */
export default function DrillProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<DrillTarget | null>(null);
  const openDrill = useCallback((t: DrillTarget) => setTarget(t), []);
  return (
    <Ctx.Provider value={{ openDrill }}>
      {children}
      {target ? (
        <DrillPanel domain={target.domain} metric={target.metric} label={target.label} onClose={() => setTarget(null)} />
      ) : null}
    </Ctx.Provider>
  );
}

/** Returns the drill opener, or a no-op when rendered outside a provider (defensive). */
export function useDrill(): DrillCtx {
  return useContext(Ctx) ?? { openDrill: () => {} };
}
