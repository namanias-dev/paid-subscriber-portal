"use client";

/** Retained as a non-default fallback. Primary playback is inline on TeachingVideoCard. */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { trackClient } from "@/lib/analytics/client";
import type { TeachingVideo } from "@/lib/store/teachingVideos";

export default function TeachingVideoLightbox({
  video,
  onClose,
}: {
  video: TeachingVideo;
  onClose: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const marks = useRef(new Set<string>());

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    marks.current = new Set();
    const play = async () => {
      try {
        node.muted = false;
        await node.play();
        trackClient("notes_teaching_sound_enabled", { video_id: video.id });
      } catch {
        node.muted = true;
        void node.play().catch(() => {});
      }
    };
    void play();
  }, [video.id]);

  const mark = (name: "notes_teaching_video_25" | "notes_teaching_video_50" | "notes_teaching_video_75" | "notes_teaching_video_completed") => {
    if (marks.current.has(name)) return;
    marks.current.add(name);
    trackClient(name, { video_id: video.id });
  };

  return createPortal(
    <div className="ns-teach-lightbox" role="dialog" aria-modal="true" aria-label={video.ariaLabel}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close video" onClick={onClose} />
      <div className="ns-teach-lightbox-panel">
        <button type="button" className="ns-teach-close ca-focus" onClick={onClose} aria-label="Close video">
          <X className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <video
          ref={ref}
          src={video.fullSrc}
          poster={video.posterSrc}
          controls
          playsInline
          preload="metadata"
          onVolumeChange={() => {
            if (ref.current && !ref.current.muted && ref.current.volume > 0) {
              trackClient("notes_teaching_sound_enabled", { video_id: video.id });
            }
          }}
          onTimeUpdate={() => {
            const node = ref.current;
            if (!node || !node.duration) return;
            const p = node.currentTime / node.duration;
            if (p >= 0.25) mark("notes_teaching_video_25");
            if (p >= 0.5) mark("notes_teaching_video_50");
            if (p >= 0.75) mark("notes_teaching_video_75");
          }}
          onEnded={() => mark("notes_teaching_video_completed")}
        >
          {video.captionsSrc ? <track kind="captions" src={video.captionsSrc} srcLang="en" label="Captions" /> : null}
        </video>
      </div>
    </div>,
    document.body,
  );
}
