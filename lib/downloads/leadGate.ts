/**
 * SMART, LOW-FRICTION LEAD GATE for the public free Downloads surface.
 *
 * UX contract: the FIRST free download in a browser session is always
 * frictionless (no form). Once the visitor has taken enough free downloads we
 * show ONE short lead form before the next download, then deliver the file.
 * After the visitor submits once, we never ask again for the rest of the
 * session. All state is session-scoped (sessionStorage) — this is purely a
 * client-side UX nudge; the real access gates (paid/login/requires_lead) stay
 * SERVER-enforced in the download API and are untouched.
 *
 * TUNING: change the single constant below.
 *   FREE_DOWNLOADS_BEFORE_LEAD_GATE = 1  → the 2nd download prompts the form.
 *   = 2 → the 3rd download prompts, and so on. 0 would prompt on the very first
 *   download (not recommended — defeats the frictionless-first goal).
 */

/** Free downloads allowed before the lead form appears. 1 ⇒ the 2nd prompts. */
export const FREE_DOWNLOADS_BEFORE_LEAD_GATE = 1;

const COUNT_KEY = "nsa_dl_free_count";
const DONE_KEY = "nsa_dl_lead_done";

function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** True once the visitor has submitted the lead form this session. */
export function leadAlreadyCaptured(): boolean {
  return store()?.getItem(DONE_KEY) === "1";
}

/** Remember that the lead form was submitted (so we never prompt again). */
export function markLeadCaptured(): void {
  try {
    store()?.setItem(DONE_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** How many free downloads have completed this session. */
export function getFreeDownloadCount(): number {
  const raw = store()?.getItem(COUNT_KEY);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Record one completed free download. */
export function incFreeDownloadCount(): void {
  try {
    store()?.setItem(COUNT_KEY, String(getFreeDownloadCount() + 1));
  } catch {
    /* ignore */
  }
}

/** Should the lead form be shown BEFORE the download the visitor just clicked? */
export function shouldGateDownload(): boolean {
  if (leadAlreadyCaptured()) return false;
  return getFreeDownloadCount() >= FREE_DOWNLOADS_BEFORE_LEAD_GATE;
}
