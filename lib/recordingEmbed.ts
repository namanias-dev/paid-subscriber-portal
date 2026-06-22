import { parseVideo } from "./videoEmbed";

export interface RecordingEmbed {
  kind: "youtube" | "drive" | "link";
  url: string;
  /** iframe src for YouTube / Google Drive when embeddable. */
  embedUrl?: string;
}

/** Extract a Google Drive file id from common share URL shapes. */
function driveFileId(url: string): string | null {
  const m =
    url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m?.[1] || null;
}

/**
 * Resolve a recording link into an embeddable form.
 * Supports YouTube (via parseVideo) and Google Drive (/preview iframe).
 * Falls back to a plain external link for anything else.
 */
export function parseRecording(rawUrl: string | null | undefined): RecordingEmbed | null {
  const url = (rawUrl || "").trim();
  if (!url) return null;

  const yt = parseVideo(url);
  if (yt?.kind === "youtube" && yt.embedUrl) {
    return { kind: "youtube", url, embedUrl: yt.embedUrl };
  }

  if (/drive\.google\.com|docs\.google\.com/i.test(url)) {
    const id = driveFileId(url);
    if (id) return { kind: "drive", url, embedUrl: `https://drive.google.com/file/d/${id}/preview` };
    return { kind: "drive", url };
  }

  return { kind: "link", url };
}
