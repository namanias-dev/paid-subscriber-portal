"use client";

import dynamic from "next/dynamic";

const InstallmentProofPopup = dynamic(() => import("./InstallmentProofPopup"), { ssr: false });

export default function InstallmentProofPopupLazy() {
  return <InstallmentProofPopup />;
}
