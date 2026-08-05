"use client";

import dynamic from "next/dynamic";
import InstallmentAccessShell from "./access/InstallmentAccessShell";

const InstallmentProofPopup = dynamic(() => import("./InstallmentProofPopup"), { ssr: false });

/**
 * Wraps portal page content so the sticky AccessNotice bar is the first in-flow
 * child (before route children) — never mounted after the page.
 */
export default function PortalAccessChrome({ children }: { children: React.ReactNode }) {
  return (
    <InstallmentAccessShell>
      {children}
      <InstallmentProofPopup />
    </InstallmentAccessShell>
  );
}
