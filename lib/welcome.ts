/**
 * Trigger the premium per-login welcome overlay (see components/ui/WelcomeOverlay).
 * Sets a one-shot sessionStorage flag (survives a hard navigation) AND dispatches
 * an event (handles soft client navigation). Client-only; safe no-op on the server.
 */
export function triggerWelcome(name?: string | null): void {
  if (typeof window === "undefined") return;
  const n = (name || "").trim();
  try {
    sessionStorage.setItem("nsa_welcome", JSON.stringify({ name: n, at: Date.now() }));
  } catch { /* ignore */ }
  try {
    window.dispatchEvent(new CustomEvent("nsa:welcome", { detail: { name: n } }));
  } catch { /* ignore */ }
}
