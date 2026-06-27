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
    window.dispatchEvent(new CustomEvent("nsa:welcome", { detail: { name: n, variant: "welcome" } }));
  } catch { /* ignore */ }
}

/**
 * Play the FAREWELL variant of the same overlay (reuses WelcomeOverlay — no second
 * animation system). Returns a promise that resolves when the overlay finishes
 * (auto-dismiss, tap-to-skip, or reduced-motion), with a hard 3s safety cap so it
 * can NEVER block/delay an in-flight logout. Client-only.
 */
export function triggerFarewell(name?: string | null): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("nsa:overlay-done", finish);
      resolve();
    };
    window.addEventListener("nsa:overlay-done", finish, { once: true });
    setTimeout(finish, 3000); // safety: never hang logout
    try {
      window.dispatchEvent(new CustomEvent("nsa:welcome", { detail: { name: (name || "").trim(), variant: "farewell" } }));
    } catch {
      finish();
    }
  });
}

/**
 * Ask the global LogoutFlow (mounted in the root layout) to show the logout
 * confirmation and, on confirm, run the farewell animation + true logout.
 * `endpoint` is the logout API to POST; `dest` is where to hard-navigate after.
 */
export function requestLogout(endpoint: string, dest: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("nsa:logout-request", { detail: { endpoint, dest } }));
  } catch { /* ignore */ }
}
