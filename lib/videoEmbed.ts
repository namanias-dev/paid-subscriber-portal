/**
 * Parse YouTube / Instagram URLs into safe embed information for public pages.
 */

export type VideoKind = "youtube" | "instagram" | "unknown";

export interface ParsedVideo {
  kind: VideoKind;
  /** Original URL (trimmed). */
  url: string;
  /** Safe iframe src for YouTube (privacy-enhanced domain). */
  embedUrl?: string;
  /** Thumbnail URL when derivable (YouTube). */
  thumbnail?: string;
  /** YouTube video id when applicable. */
  id?: string;
}

function youtubeId(url: string): string | null {
  // youtu.be/<id>
  let m = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (m) return m[1];
  // youtube.com/watch?v=<id>
  m = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (m) return m[1];
  // youtube.com/embed/<id> or /shorts/<id>
  m = url.match(/youtube\.com\/(?:embed|shorts)\/([A-Za-z0-9_-]{6,})/);
  if (m) return m[1];
  return null;
}

export function parseVideo(rawUrl: string | null | undefined): ParsedVideo | null {
  const url = (rawUrl || "").trim();
  if (!url) return null;

  const ytId = youtubeId(url);
  if (ytId) {
    return {
      kind: "youtube",
      url,
      id: ytId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${ytId}`,
      thumbnail: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
    };
  }

  if (/instagram\.com\/(reel|reels|p|tv)\//i.test(url)) {
    return { kind: "instagram", url };
  }

  return { kind: "unknown", url };
}
