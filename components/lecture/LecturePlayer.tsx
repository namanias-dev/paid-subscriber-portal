"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Loader2, AlertTriangle } from "lucide-react";

/**
 * Premium mobile-first HTML5 lecture player. Streams DIRECTLY from a short-lived
 * R2 signed URL (fetched on mount via /play, which re-checks access server-side —
 * the URL is never in the initial HTML). Native controls give play/seek/fullscreen;
 * we add speed control, resume-from-last-position, periodic progress saving, and a
 * subtle anti-piracy watermark. Respects prefers-reduced-motion.
 */
const SPEEDS = [1, 1.25, 1.5, 2];
const SAVE_EVERY_MS = 20000;

export default function LecturePlayer({
  recordingId,
  title,
  subject,
  topic,
  dateLabel,
  durationSeconds,
  initialPosition,
  notesUrl,
  backHref,
  watermark,
}: {
  recordingId: string;
  title: string;
  subject: string | null;
  topic: string | null;
  dateLabel: string | null;
  durationSeconds: number | null;
  initialPosition: number;
  notesUrl: string | null;
  backHref: string;
  watermark: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const resumed = useRef(false);
  const lastSaved = useRef(0);

  // Anti-piracy watermark: student identity + live IST clock, repositioned every
  // few seconds so it can't be cropped out and so a DevTools delete is re-applied
  // on the next tick (React re-renders the node from state). pointer-events:none
  // keeps it from blocking the controls.
  const [wm, setWm] = useState<{ top: number; left: number; clock: string }>({ top: 50, left: 50, clock: "" });
  useEffect(() => {
    if (!watermark) return;
    const tick = () => {
      setWm({
        top: 14 + Math.random() * 64, // keep the (center-anchored) label inside the frame
        left: 16 + Math.random() * 60,
        clock: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      });
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, [watermark]);

  // Fetch the signed URL on mount (access re-checked server-side).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/lectures/${recordingId}/play`);
        const data = await res.json();
        if (!alive) return;
        if (!res.ok || !data.ok) { setError(data?.access?.reason === "login" ? "Please log in to watch." : "This lecture isn't available right now."); return; }
        setUrl(data.url);
      } catch {
        if (alive) setError("Network error — please retry.");
      }
    })();
    return () => { alive = false; };
  }, [recordingId]);

  const save = useCallback((completed = false) => {
    const v = videoRef.current;
    if (!v) return;
    const position = Math.floor(v.currentTime || 0);
    const isDone = completed || (v.duration ? v.currentTime / v.duration >= 0.95 : false);
    const payload = JSON.stringify({ position, completed: isDone });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`/api/lectures/${recordingId}/progress`, new Blob([payload], { type: "application/json" }));
      } else {
        fetch(`/api/lectures/${recordingId}/progress`, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
      }
    } catch { /* ignore */ }
  }, [recordingId]);

  // Periodic + lifecycle progress saving.
  useEffect(() => {
    const id = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused) save();
    }, SAVE_EVERY_MS);
    const onHide = () => save();
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => { clearInterval(id); window.removeEventListener("pagehide", onHide); window.removeEventListener("beforeunload", onHide); save(); };
  }, [save]);

  const onLoadedMeta = () => {
    const v = videoRef.current;
    if (!v || resumed.current) return;
    resumed.current = true;
    if (initialPosition > 5 && (!v.duration || initialPosition < v.duration - 5)) v.currentTime = initialPosition;
  };

  const setRate = (r: number) => {
    setSpeed(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  };

  return (
    <div className="mt-4">
      <div className="overflow-hidden rounded-2xl border border-line bg-black">
        <div className="relative aspect-video w-full bg-black">
          {error ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/80">
              <AlertTriangle size={28} /> <p className="text-sm">{error}</p>
            </div>
          ) : !url ? (
            <div className="flex h-full w-full items-center justify-center text-white/70">
              <Loader2 size={28} className="animate-spin motion-reduce:animate-none" />
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                src={url}
                controls
                controlsList="nodownload noplaybackrate noremoteplayback"
                disablePictureInPicture
                disableRemotePlayback
                playsInline
                preload="metadata"
                className="h-full w-full"
                onContextMenu={(e) => e.preventDefault()}
                onLoadedMetadata={onLoadedMeta}
                onPause={() => save()}
                onEnded={() => save(true)}
                onTimeUpdate={() => {
                  const now = Date.now();
                  if (now - lastSaved.current > SAVE_EVERY_MS) { lastSaved.current = now; }
                }}
              />
              {watermark && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute z-10 select-none whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-white/30"
                  style={{
                    top: `${wm.top}%`,
                    left: `${wm.left}%`,
                    transform: "translate(-50%, -50%) rotate(-18deg)",
                    textShadow: "0 1px 4px rgba(0,0,0,0.7)",
                    transition: "top 1s ease, left 1s ease",
                  }}
                >
                  {watermark}{wm.clock ? ` · ${wm.clock}` : ""}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Controls + meta */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-xl font-bold leading-tight">{title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-ink2">
            {subject && <span>{subject}</span>}
            {topic && <span>· {topic}</span>}
            {dateLabel && <span>· {dateLabel}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-line bg-surface p-1">
            {SPEEDS.map((r) => (
              <button
                key={r}
                onClick={() => setRate(r)}
                className={`min-h-[36px] rounded-full px-2.5 text-xs font-bold transition ${speed === r ? "bg-[var(--ca-gold)] text-[#1a1304]" : "text-ink2 hover:text-ink"}`}
              >
                {r}x
              </button>
            ))}
          </div>
          {notesUrl && (
            <a href={notesUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary text-sm">
              <FileText size={14} /> Notes
            </a>
          )}
          <Link href={backHref} className="btn btn-ghost text-sm">Back to hub</Link>
        </div>
      </div>
    </div>
  );
}
