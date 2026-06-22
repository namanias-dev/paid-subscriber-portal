"use client";

import { useEffect, useState } from "react";
import type { RecordingEmbed } from "@/lib/recordingEmbed";

type Phase = "upcoming" | "live" | "ended";

interface Props {
  startISO: string | null;
  endISO: string | null;
  sessionType: "live" | "recorded";
  zoomLink: string | null;
  recording: RecordingEmbed | null;
}

/** Default assumed live duration when no explicit end time is set. */
const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000;

function computePhase(now: number, start: number | null, end: number | null, sessionType: string): Phase {
  if (sessionType === "recorded") return "ended";
  if (start === null) return "live";
  if (now < start) return "upcoming";
  if (end !== null && now > end) return "ended";
  return "live";
}

function CountdownPills({ ms }: { ms: number }) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const cells: [number, string][] = [
    [d, "days"],
    [h, "hrs"],
    [m, "min"],
    [s, "sec"],
  ];
  return (
    <div className="flex gap-2">
      {cells.map(([val, label]) => (
        <div key={label} className="min-w-[58px] rounded-xl bg-ink px-2 py-2 text-center text-white">
          <div className="font-mono text-xl font-bold tabular-nums">{String(val).padStart(2, "0")}</div>
          <div className="text-[10px] uppercase tracking-wide text-white/60">{label}</div>
        </div>
      ))}
    </div>
  );
}

function RecordingPlayer({ recording }: { recording: RecordingEmbed }) {
  if (recording.embedUrl) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-soft">
        <iframe
          src={recording.embedUrl}
          title="Recording"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      </div>
    );
  }
  return (
    <a href={recording.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
      ▶ Watch Recording
    </a>
  );
}

export default function WebinarAccess({ startISO, endISO, sessionType, zoomLink, recording }: Props) {
  const start = startISO ? new Date(startISO).getTime() : null;
  const end = endISO
    ? new Date(endISO).getTime()
    : start !== null
    ? start + DEFAULT_DURATION_MS
    : null;

  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const phase = computePhase(now, start, end, sessionType);

  // Recorded session: straight to the player.
  if (sessionType === "recorded") {
    return (
      <div className="space-y-4">
        <span className="pill pill-blue">Recorded session</span>
        {recording ? (
          <RecordingPlayer recording={recording} />
        ) : (
          <div className="rounded-xl bg-surface p-4 text-sm text-ink2">The recording will be available here soon.</div>
        )}
      </div>
    );
  }

  // Live session lifecycle.
  if (phase === "upcoming") {
    return (
      <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
        <div className="text-sm font-semibold text-muted">Webinar starts in</div>
        {start !== null && <CountdownPills ms={start - now} />}
        {zoomLink ? (
          <a href={zoomLink} target="_blank" rel="noopener noreferrer" className="btn btn-primary w-full sm:w-auto">
            Attend Live Class →
          </a>
        ) : (
          <div className="text-sm text-ink2">The join link will appear here before the session begins.</div>
        )}
      </div>
    );
  }

  if (phase === "live") {
    return (
      <div className="space-y-4 rounded-2xl border-2 border-red-200 bg-red-50 p-5">
        <div className="flex items-center gap-2 text-sm font-bold text-red-600">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
          </span>
          LIVE NOW
        </div>
        {zoomLink ? (
          <a href={zoomLink} target="_blank" rel="noopener noreferrer" className="btn btn-primary w-full sm:w-auto">
            Attend Live Class →
          </a>
        ) : (
          <div className="text-sm text-ink2">The session is live. The join link will appear here shortly.</div>
        )}
      </div>
    );
  }

  // Ended → recording if available, else "soon".
  return (
    <div className="space-y-4">
      <span className="pill pill-gray">Webinar ended</span>
      {recording ? (
        <RecordingPlayer recording={recording} />
      ) : (
        <div className="rounded-xl bg-surface p-4 text-sm text-ink2">
          📼 Recording will be available soon. Check back shortly — we&apos;re processing it.
        </div>
      )}
    </div>
  );
}
