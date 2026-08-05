"use client";

import dynamic from "next/dynamic";
import InstallmentAccessShell from "./access/InstallmentAccessShell";

const InstallmentProofPopup = dynamic(() => import("./InstallmentProofPopup"), { ssr: false });

/**
 * Portal access notice shell: pinned bar (primary) + on-demand upload sheet.
 * Auto-opening the notice modal was removed so it cannot compete with the bar.
 */
export default function InstallmentProofPopupLazy() {
  return (
    <InstallmentAccessShell>
      <InstallmentProofPopup />
    </InstallmentAccessShell>
  );
}
