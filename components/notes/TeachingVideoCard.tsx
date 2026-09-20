"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Volume2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { trackClient } from "@/lib/analytics/client";
import { teachingAspectRatio, type TeachingVideo } from "@/lib/store/teachingVideos";

export default function TeachingVideoCard({
  video,
  active,
  onOpen,
  saveData,
}: {
  video: TeachingVideo;
  active: boolean;
  onOpen: () => void;
  saveData: boolean;
}) {
  const reduce = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [settled, setSettled] = useState(false);
  const [canPreview, setCanPreview] = useState(false);

  useEffect(() => {
    if (reduce) {
      setSettled(true);
      return;
    }
    const id = window.setTimeout(() => setSettled(true), 720);
    return () => window.clearTimeout(id);
  }, [reduce, video.id]);

  useEffect(() => {
    const node = videoRef.current;
    if (!node) return;
    if (!active || saveData || reduce) {
      node.pause();
      node.removeAttribute("src");
      node.load();
      setCanPreview(false);
      return;
    }
    if (node.getAttribute("src") !== video.previewSrc) {
      node.src = video.previewSrc;
    }
    node.muted = true;
    node.defaultMuted = true;
    const start = node.play();
    if (start) {
      start
        .then(() => {
          setCanPreview(true);
          trackClient("notes_teaching_preview_started", { video_id: video.id });
        })
        .catch(() => setCanPreview(false));
    }
    return () => {
      node.pause();
    };
  }, [active, reduce, saveData, video.id, video.previewSrc]);

  return (
    <motion.article
      className="ns-teach-slide"
      initial={reduce ? false : { opacity: 0, y: 18, rotateY: -8 }}
      animate={{ opacity: active ? 1 : 0.96, y: 0, rotateY: 0 }}
      transition={{ duration: 0.78, ease: [0.22, 1, 0.36, 1] }}
      style={{ ["--ns-teach-ratio" as string]: teachingAspectRatio(video) }}
    >
      <button
        type="button"
        className={`ns-teach-frame ca-focus ${settled ? "ns-teach-frame--settled" : ""} ${active ? "" : "ns-teach-frame--peek"}`}
        onClick={onOpen}
        aria-label={`${video.ariaLabel}. Open with sound.`}
      >
        <span className="ns-teach-bevel" aria-hidden="true" />
        <span className="ns-teach-media">
          <img src={video.posterSrc} alt="" width={video.width} height={video.height} />
          {active && !saveData && !reduce ? (
            <video
              ref={videoRef}
              className={`absolute inset-0 ${canPreview ? "opacity-100" : "opacity-0"}`}
              muted
              loop
              playsInline
              preload="none"
              poster={video.posterSrc}
              aria-hidden="true"
            />
          ) : null}
        </span>
        {video.viewLabel ? (
          <span className="ns-teach-badge">
            <Play className="h-2.5 w-2.5" strokeWidth={2.2} fill="currentColor" />
            {video.viewLabel}
          </span>
        ) : null}
        <span className="ns-teach-caption">
          <span>
            <p>Naman Sir · UPSC Faculty</p>
            <small>{video.title || "Tap to watch with sound"}</small>
          </span>
          <span className="ns-teach-play" aria-hidden="true">
            <Volume2 className="h-4 w-4" strokeWidth={1.75} />
          </span>
        </span>
      </button>
    </motion.article>
  );
}
