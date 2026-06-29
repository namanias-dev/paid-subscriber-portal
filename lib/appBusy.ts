"use client";

/**
 * Tiny shared "is the user mid-task?" flag used by the deploy auto-refresh so we
 * never reload someone in the middle of something important (e.g. taking a quiz).
 * When busy, ClientHealth defers the refresh to a subtle "New version" banner
 * instead of reloading automatically.
 */
declare global {
  interface Window {
    __APP_BUSY__?: number;
  }
}

/** Mark the app busy/idle. Reference-counted so nested busy states are safe. */
export function setAppBusy(busy: boolean): void {
  if (typeof window === "undefined") return;
  const cur = window.__APP_BUSY__ || 0;
  window.__APP_BUSY__ = Math.max(0, cur + (busy ? 1 : -1));
}

export function isAppBusy(): boolean {
  if (typeof window === "undefined") return false;
  return (window.__APP_BUSY__ || 0) > 0;
}
