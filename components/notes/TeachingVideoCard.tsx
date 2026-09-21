"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { trackClient } from "@/lib/analytics/client";
import { teachingAspectRatio, type TeachingVideo } from "@/lib/store/teachingVideos";

type Mode = "poster" | "preview" | "playing";

function markInline(node: HTMLVideoElement) {
  node.setAttribute("playsinline", "");
  node.setAttribute("webkit-playsinline", "");
  node.playsInline = true;
}

export default function TeachingVideoCard({
  video,
  active,
  near,
  saveData,
  onSelect,
  onPlaybackChange,
}: {
  video: TeachingVideo;
  active: boolean;
  near: boolean;
  saveData: boolean;
  onSelect: () => void;
  onPlaybackChange: (playing: boolean) => void;
}) {
  const reduce = useReducedMotion();
  const previewRef = useRef<HTMLVideoElement>(null);
  const fullRef = useRef<HTMLVideoElement>(null);
  const marks = useRef(new Set<string>());
  const previewTracked = useRef(false);
  const [settled, setSettled] = useState(false);
  const [mode, setMode] = useState<Mode>("poster");
  const [previewReady, setPreviewReady] = useState(false);
  const [fullReady, setFullReady] = useState(false);
  const modeRef = useRef<Mode>("poster");
  modeRef.current = mode;

  useEffect(() => {
    if (reduce) {
      setSettled(true);
      return;
    }
    const id = window.setTimeout(() => setSettled(true), 640);
    return () => window.clearTimeout(id);
  }, [reduce, video.id]);

  useEffect(() => {
    if (active) return;
    const full = fullRef.current;
    full?.pause();
    if (modeRef.current === "playing") {
      if (full) {
        full.removeAttribute("src");
        full.controls = false;
        full.load();
      }
      setMode("poster");
      setFullReady(false);
    }
  }, [active, video.id]);

  useEffect(() => {
    const node = previewRef.current;
    const allowPreview = active && near && mode !== "playing" && !saveData && !reduce;
    if (!node) return;
    markInline(node);
    if (!allowPreview) {
      node.pause();
      if (mode !== "playing") {
        node.removeAttribute("src");
        node.load();
        setPreviewReady(false);
      }
      return;
    }
    if (node.getAttribute("src") !== video.previewSrc) {
      node.src = video.previewSrc;
    }
    node.muted = true;
    node.defaultMuted = true;
    node.loop = true;
    node.playsInline = true;
    const start = node.play();
    if (start) {
      start
        .then(() => {
          setPreviewReady(true);
          setMode((cur) => (cur === "playing" ? cur : "preview"));
          if (!previewTracked.current) {
            previewTracked.current = true;
            trackClient("notes_teaching_preview_started", { video_id: video.id });
          }
        })
        .catch(() => setPreviewReady(false));
    }
    return () => {
      node.pause();
    };
  }, [active, mode, near, reduce, saveData, video.id, video.previewSrc]);

  useEffect(() => {
    const node = fullRef.current;
    if (!node) return;
    const onFs = () => {
      const webkit = (node as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean }).webkitDisplayingFullscreen;
      if (document.fullscreenElement === node || webkit) {
        trackClient("notes_teaching_fullscreen_entered", { video_id: video.id });
      }
    };
    const onWebkit = () => trackClient("notes_teaching_fullscreen_entered", { video_id: video.id });
    node.addEventListener("fullscreenchange", onFs);
    node.addEventListener("webkitbeginfullscreen", onWebkit);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      node.removeEventListener("fullscreenchange", onFs);
      node.removeEventListener("webkitbeginfullscreen", onWebkit);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [mode, video.id]);

  const mark = (name: "notes_teaching_video_25" | "notes_teaching_video_50" | "notes_teaching_video_75" | "notes_teaching_video_completed") => {
    if (marks.current.has(name)) return;
    marks.current.add(name);
    trackClient(name, { video_id: video.id });
  };

  const startInlinePlay = async () => {
    if (!active) {
      onSelect();
      return;
    }
    const node = fullRef.current;
    if (!node) return;
    marks.current = new Set();
    markInline(node);
    if (node.getAttribute("src") !== video.fullSrc) {
      node.src = video.fullSrc;
    }
    node.loop = false;
    node.muted = false;
    node.defaultMuted = false;
    node.controls = true;
    node.playsInline = true;
    setMode("playing");
    onPlaybackChange(true);
    trackClient("notes_teaching_video_opened", { video_id: video.id });
    trackClient("notes_teaching_inline_play", { video_id: video.id });
    try {
      await node.play();
      setFullReady(true);
      trackClient("notes_teaching_sound_enabled", { video_id: video.id });
    } catch {
      try {
        node.muted = true;
        await node.play();
        setFullReady(true);
      } catch {
        setMode("preview");
        onPlaybackChange(false);
      }
    }
    previewRef.current?.pause();
  };

  const playing = mode === "playing";

  return (
    <motion.article
      className="ns-teach-slide"
      data-active={active}
      initial={reduce ? false : { opacity: 0, y: 18, rotateY: -7, rotateX: 2 }}
      animate={{
        opacity: active ? 1 : 0.72,
        y: active ? 0 : 8,
        scale: active ? 1 : 0.955,
        rotateY: 0,
        rotateX: 0,
      }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      style={{ ["--ns-teach-ratio" as string]: teachingAspectRatio(video) }}
      aria-roledescription="slide"
      aria-label={video.ariaLabel}
      aria-current={active ? "true" : undefined}
    >
      <div
        className={`ns-teach-frame ${settled ? "ns-teach-frame--settled" : ""} ${active ? "ns-teach-frame--active" : "ns-teach-frame--peek"}`}
      >
        <span className="ns-teach-bevel" aria-hidden="true" />
        <div className="ns-teach-media">
          <img src={video.posterSrc} alt="" width={video.width} height={video.height} />
          {active && near && !fullReady && !saveData && !reduce ? (
            <video
              ref={previewRef}
              className={previewReady ? "is-ready" : ""}
              muted
              loop
              playsInline
              preload="none"
              poster={video.posterSrc}
              aria-hidden="true"
              tabIndex={-1}
            />
          ) : null}
          <video
            ref={fullRef}
            className={`ns-teach-full ${playing && fullReady ? "is-ready" : ""}`}
            playsInline
            preload="none"
            controls={playing && fullReady}
            poster={video.posterSrc}
            aria-label={video.ariaLabel}
            style={{ pointerEvents: playing ? "auto" : "none" }}
            onPause={() => {
              if (!playing) return;
              onPlaybackChange(false);
              trackClient("notes_teaching_inline_pause", { video_id: video.id });
            }}
            onPlay={() => {
              if (!playing) return;
              onPlaybackChange(true);
            }}
            onVolumeChange={() => {
              const node = fullRef.current;
              if (node && !node.muted && node.volume > 0) {
                trackClient("notes_teaching_sound_enabled", { video_id: video.id });
              }
            }}
            onTimeUpdate={() => {
              const node = fullRef.current;
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
        {video.viewLabel ? (
          <span className="ns-teach-badge">
            <Play className="h-2.5 w-2.5" strokeWidth={2.2} fill="currentColor" />
            {video.viewLabel}
          </span>
        ) : null}
        {active && !playing ? (
          <button
            type="button"
            className="ns-teach-playbtn ca-focus"
            onClick={startInlinePlay}
            aria-label="Play teaching video"
          >
            <i>
              <Play className="h-6 w-6" strokeWidth={1.75} fill="currentColor" />
            </i>
          </button>
        ) : null}
        {!active ? (
          <button
            type="button"
            className="ns-teach-select ca-focus"
            onClick={onSelect}
            aria-label={`${video.ariaLabel}. Show this clip.`}
          />
        ) : null}
      </div>
    </motion.article>
  );
}
