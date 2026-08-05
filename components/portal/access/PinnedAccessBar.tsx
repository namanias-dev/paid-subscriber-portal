"use client";

import { useEffect, useRef, useState } from "react";
import type { InstallmentProofPromptProps } from "@/lib/installmentProofTypes";
import AccessNotice from "./AccessNotice";
import { useInstallmentAccess } from "./InstallmentAccessShell";

/**
 * Sticky access bar — sibling-of-header behaviour via sticky + --header-h.
 * Intrinsic height only; ResizeObserver writes --access-bar-h.
 * Replaces the prior fixed + hardcoded top-14 / 3.5rem architecture.
 */
export default function PinnedAccessBar({ prompt }: { prompt: InstallmentProofPromptProps }) {
  const { snoozeExpiring } = useInstallmentAccess();
  const [compact, setCompact] = useState(false);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY.current;
        if (y < 80) setCompact(false);
        else if (delta > 8 && y > 200) setCompact(true);
        else if (delta < -8) setCompact(false);
        lastY.current = y;
        ticking.current = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AccessNotice
      variant="bar"
      prompt={prompt}
      compact={compact}
      onDismiss={prompt.state === "expiring" ? snoozeExpiring : undefined}
      measureHeight
    />
  );
}
