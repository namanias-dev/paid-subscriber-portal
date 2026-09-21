/**
 * Teaching-video playback helpers. Keep the user-gesture → play() path
 * synchronous: no awaits before HTMLVideoElement.play().
 */

export const TEACHING_FULL_WARM_BYTES = 256 * 1024;
export const TEACHING_HOVER_WARM_MS = 220;
export const TEACHING_SLOW_START_MS = 160;

type WebkitVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
  webkitSupportsFullscreen?: boolean;
};

export function markTeachingVideoInline(node: HTMLVideoElement): void {
  node.setAttribute("playsinline", "");
  node.setAttribute("webkit-playsinline", "");
  node.playsInline = true;
}

export function attachTeachingSource(
  node: HTMLVideoElement,
  src: string,
  preload: "none" | "metadata" | "auto",
): boolean {
  markTeachingVideoInline(node);
  const changed = node.getAttribute("src") !== src;
  if (changed) node.src = src;
  node.preload = preload;
  return changed;
}

export function stopTeachingBuffering(node: HTMLVideoElement, dropSource: boolean): void {
  node.pause();
  node.preload = "none";
  if (dropSource) {
    node.removeAttribute("src");
    node.load();
  }
}

/** First ~256KB covers the faststart `moov` (~148KB) plus a little media. */
export function warmTeachingSource(
  url: string,
  bytes = TEACHING_FULL_WARM_BYTES,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!url) return Promise.resolve(false);
  return fetch(url, {
    method: "GET",
    headers: { Range: `bytes=0-${Math.max(0, bytes - 1)}` },
    credentials: "omit",
    cache: "force-cache",
    mode: "same-origin",
    signal,
  })
    .then((res) => res.ok || res.status === 206)
    .catch(() => false);
}

/**
 * Call from a click/tap handler. Mutates the existing node and invokes
 * play() in the same turn so iOS keeps the user-gesture token.
 */
export function prepareTeachingPlayback(node: HTMLVideoElement, src: string): void {
  markTeachingVideoInline(node);
  if (node.getAttribute("src") !== src) node.src = src;
  node.loop = false;
  node.muted = false;
  node.defaultMuted = false;
  node.controls = true;
  node.playsInline = true;
}

export async function playTeachingVideo(node: HTMLVideoElement): Promise<"playing" | "paused"> {
  try {
    await node.play();
    return "playing";
  } catch {
    node.controls = true;
    try {
      node.pause();
    } catch {
      /* ignore */
    }
    return "paused";
  }
}

export function isTeachingFullscreen(node: HTMLVideoElement): boolean {
  const webkit = node as WebkitVideo;
  if (typeof document !== "undefined" && document.fullscreenElement === node) return true;
  return !!webkit.webkitDisplayingFullscreen;
}

export async function enterTeachingFullscreen(node: HTMLVideoElement): Promise<boolean> {
  const webkit = node as WebkitVideo;
  try {
    if (typeof node.requestFullscreen === "function") {
      await node.requestFullscreen();
      return true;
    }
  } catch {
    /* fall through to webkit */
  }
  if (typeof webkit.webkitEnterFullscreen === "function") {
    try {
      webkit.webkitEnterFullscreen();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function exitTeachingFullscreen(node: HTMLVideoElement): Promise<void> {
  const webkit = node as WebkitVideo;
  try {
    if (typeof document !== "undefined" && document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
      return;
    }
  } catch {
    /* fall through */
  }
  if (typeof webkit.webkitExitFullscreen === "function") {
    try {
      webkit.webkitExitFullscreen();
    } catch {
      /* ignore */
    }
  }
}
