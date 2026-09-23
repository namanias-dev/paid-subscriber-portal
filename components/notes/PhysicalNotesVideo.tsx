"use client";

import { useEffect, useRef, useState } from "react";
import { trackClient } from "@/lib/analytics/client";
import type { EventName } from "@/lib/analytics/events";
import {
  PHYSICAL_NOTES_VIDEO,
  proofAttribution,
  type NotesProofProduct,
} from "@/lib/store/notesProof";
import {
  attachTeachingSource,
  markTeachingVideoInline,
  playTeachingVideo,
  prepareTeachingPlayback,
  warmTeachingSource,
} from "@/lib/store/teachingPlayer";

const MARKS: Array<[number, EventName]> = [
  [0.25, "notes_physical_video_25"],
  [0.5, "notes_physical_video_50"],
  [0.75, "notes_physical_video_75"],
];

export default function PhysicalNotesVideo({
  product,
  placement,
  onPlayed,
}: {
  product: NotesProofProduct | null;
  placement: "landing" | "pdp";
  onPlayed?: () => void;
}) {
  const video = PHYSICAL_NOTES_VIDEO;
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLVideoElement>(null);
  const marks = useRef(new Set<string>());
  const played = useRef(false);
  const impressed = useRef(false);
  const [near, setNear] = useState(false);
  const [phase, setPhase] = useState<"poster" | "starting" | "playing" | "paused" | "error">("poster");
  const userPlayback = phase === "starting" || phase === "playing" || phase === "paused";

  const props = proofAttribution(product, { video_id: video.id, placement });

  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNear(true);
        if (!impressed.current && entry.intersectionRatio >= 0.45) {
          impressed.current = true;
          trackClient("notes_physical_video_impression", props);
        }
      },
      { rootMargin: "160px", threshold: [0.2, 0.45] },
    );
    io.observe(root);
    return () => io.disconnect();
    // Attribution is stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || !near || userPlayback) return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    markTeachingVideoInline(node);
    attachTeachingSource(node, video.fullSrc, "metadata");
    node.muted = true;
    node.controls = false;
    if (saveData) return;
    const ac = new AbortController();
    void warmTeachingSource(video.fullSrc, undefined, ac.signal);
    return () => ac.abort();
  }, [near, userPlayback, video.fullSrc]);

  function play() {
    const node = nodeRef.current;
    if (!node || phase === "starting") return;
    if (node.error) node.load();
    prepareTeachingPlayback(node, video.fullSrc);
    setPhase("starting");
    void playTeachingVideo(node).then((result) => {
      if (result === "playing") {
        setPhase("playing");
        if (!played.current) {
          played.current = true;
          trackClient("notes_physical_video_play", props);
          onPlayed?.();
        }
      } else {
        setPhase("error");
      }
    });
  }

  function onTime(node: HTMLVideoElement) {
    if (!node.duration || !Number.isFinite(node.duration)) return;
    const ratio = node.currentTime / node.duration;
    for (const [mark, name] of MARKS) {
      if (ratio >= mark && !marks.current.has(name)) {
        marks.current.add(name);
        trackClient(name, props);
      }
    }
  }

  if (!video.enabled || !video.fullSrc) return null;

  return (
    <div ref={wrapRef} className="ns-proof-video" style={{ aspectRatio: `${video.width} / ${video.height}` }}>
      <video
        ref={nodeRef}
        poster={video.posterSrc}
        playsInline
        preload="none"
        className="h-full w-full bg-[var(--ca-navy)] object-cover"
        aria-label={video.ariaLabel}
        onPlaying={() => setPhase("playing")}
        onPause={() => setPhase((cur) => (cur === "playing" ? "paused" : cur))}
        onEnded={() => {
          setPhase("paused");
          if (!marks.current.has("notes_physical_video_completed")) {
            marks.current.add("notes_physical_video_completed");
            trackClient("notes_physical_video_completed", props);
          }
        }}
        onTimeUpdate={(e) => onTime(e.currentTarget)}
        onError={() => setPhase("error")}
      />
      {!userPlayback && (
        <button type="button" className="ns-proof-play ca-focus" onClick={play} aria-label="Play the printed notes walkthrough">
          <span className="ns-proof-play-disc" aria-hidden="true">
            ▶
          </span>
          <span>Watch the printed copy</span>
        </button>
      )}
      {phase === "starting" && (
        <p className="ns-proof-starting" role="status">
          Starting…
        </p>
      )}
      {phase === "error" && (
        <p className="ns-proof-video-error" role="alert">
          This walkthrough did not start. You can still preview the notes.
        </p>
      )}
    </div>
  );
}
