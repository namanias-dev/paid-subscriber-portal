/** Tiny event bus for installment proof UI (avoid circular imports). */

export function requestInstallmentProofUpload(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("ipp:open-upload"));
}

export function requestInstallmentProofView(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("ipp:open-view"));
}

export function requestInstallmentAccessRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("ipp:refresh"));
}
