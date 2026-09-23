/** Opens the sample reader mounted elsewhere on the same page. */
let openListener: (() => void) | null = null;
let pending = false;

export function requestNotesSample(): void {
  if (openListener) openListener();
  else pending = true;
}

export function bindNotesSample(listener: () => void): () => void {
  openListener = listener;
  if (pending) {
    pending = false;
    listener();
  }
  return () => {
    if (openListener === listener) openListener = null;
  };
}
