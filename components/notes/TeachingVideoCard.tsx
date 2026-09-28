"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { trackClient } from "@/lib/analytics/client";
import { teachingAspectRatio, type TeachingVideo } from "@/lib/store/teachingVideos";
import {
  attachTeachingSource,
  isTeachingFullscreen,
  markTeachingVideoInline,
  playTeachingVideo,
  prepareTeachingPlayback,
  stopTeachingBuffering,
  TEACHING_HOVER_WARM_MS,
  TEACHING_SLOW_START_MS,
  warmTeachingSource,
} from "@/lib/store/teachingPlayer";

type Phase = "poster" | "preview" | "starting" | "playing" | "paused" | "error";

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
  const userActivated = useRef(false);
  const retried = useRef(false);
  const playSession = useRef(0);
  const hoverTimer = useRef(0);
  const slowTimer = useRef(0);
  const warmAbort = useRef<AbortController | null>(null);
  const [settled, setSettled] = useState(false);
  const [phase, setPhase] = useState<Phase>("poster");
  const [previewReady, setPreviewReady] = useState(false);
  const [fullReady, setFullReady] = useState(false);
  const [slowStart, setSlowStart] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const phaseRef = useRef<Phase>("poster");
  phaseRef.current = phase;

  const userPlayback = phase === "starting" || phase === "playing" || phase === "paused";
  const showPreview = active && near && !saveData && !reduce && (phase === "poster" || phase === "preview");

  useEffect(() => {
    if (reduce) {
      setSettled(true);
      return;
    }
    const id = window.setTimeout(() => setSettled(true), 640);
    return () => window.clearTimeout(id);
  }, [reduce, video.id]);

  useEffect(() => {
    const node = fullRef.current;
    if (!node) return;
    markTeachingVideoInline(node);

    const allowFull = active && near && !saveData;
    if (!allowFull) {
      const keep = userActivated.current && node.currentTime > 0.15;
      node.pause();
      stopTeachingBuffering(node, !keep);
      if (!keep) {
        userActivated.current = false;
        setFullReady(false);
        if (phaseRef.current === "playing" || phaseRef.current === "starting" || phaseRef.current === "paused") {
          setPhase("poster");
        }
      } else {
        node.controls = false;
        setPhase((cur) => (cur === "playing" || cur === "starting" ? "paused" : cur));
      }
      onPlaybackChange(false);
      return;
    }

    attachTeachingSource(node, video.fullSrc, "auto");
    if (!userActivated.current) {
      node.muted = true;
      node.defaultMuted = true;
      node.loop = false;
      node.controls = false;
    }

    warmAbort.current?.abort();
    const ac = new AbortController();
    warmAbort.current = ac;
    void warmTeachingSource(video.fullSrc, undefined, ac.signal);

    return () => {
      ac.abort();
    };
    // Parent passes a fresh onPlaybackChange each render; do not re-warm on that identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, near, saveData, video.fullSrc, video.id]);

  useEffect(() => {
    const node = previewRef.current;
    const allowPreview =
      active && near && !userActivated.current && phase !== "starting" && phase !== "playing" && phase !== "paused" && !saveData && !reduce;
    if (!node) return;
    markTeachingVideoInline(node);
    if (!allowPreview) {
      node.pause();
      if (!userActivated.current) {
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
    node.preload = "auto";
    const start = node.play();
    if (start) {
      start
        .then(() => {
          setPreviewReady(true);
          setPhase((cur) => (cur === "poster" ? "preview" : cur));
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
  }, [active, near, phase, reduce, saveData, video.id, video.previewSrc]);

  useEffect(() => {
    const node = fullRef.current;
    if (!node) return;
    const onFs = () => {
      if (isTeachingFullscreen(node)) {
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
  }, [video.id]);

  useEffect(() => {
    return () => {
      window.clearTimeout(hoverTimer.current);
      window.clearTimeout(slowTimer.current);
      warmAbort.current?.abort();
      previewRef.current?.pause();
      fullRef.current?.pause();
    };
  }, []);

  const mark = (name: "notes_teaching_video_25" | "notes_teaching_video_50" | "notes_teaching_video_75" | "notes_teaching_video_completed") => {
    if (marks.current.has(name)) return;
    marks.current.add(name);
    trackClient(name, { video_id: video.id });
  };

  const armSlowStart = () => {
    window.clearTimeout(slowTimer.current);
    setSlowStart(false);
    slowTimer.current = window.setTimeout(() => setSlowStart(true), TEACHING_SLOW_START_MS);
  };

  const startInlinePlay = () => {
    if (!active) {
      onSelect();
      return;
    }
    const node = fullRef.current;
    if (!node) return;
    marks.current = new Set();
    retried.current = false;
    playSession.current += 1;
    const session = playSession.current;
    userActivated.current = true;
    prepareTeachingPlayback(node, video.fullSrc);
    previewRef.current?.pause();
    armSlowStart();
    setPhase("starting");
    setBuffering(false);
    onPlaybackChange(true);
    void playTeachingVideo(node).then((result) => {
      if (session !== playSession.current) return;
      if (result === "paused") {
        window.clearTimeout(slowTimer.current);
        setSlowStart(false);
        setPhase("paused");
        onPlaybackChange(false);
      }
    });
  };

  const retryLoad = () => {
    const node = fullRef.current;
    if (!node) return;
    setPhase("starting");
    attachTeachingSource(node, video.fullSrc, "auto");
    prepareTeachingPlayback(node, video.fullSrc);
    armSlowStart();
    onPlaybackChange(true);
    void playTeachingVideo(node).then((result) => {
      if (result === "paused") {
        window.clearTimeout(slowTimer.current);
        setSlowStart(false);
        setPhase("paused");
        onPlaybackChange(false);
      }
    });
  };

  const showOverlay = active && (phase === "poster" || phase === "preview" || phase === "starting" || phase === "error");
  const framePlaying = phase === "playing" || phase === "starting" || phase === "paused";

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
      onPointerEnter={() => {
        if (!active || saveData) return;
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => {
          const node = fullRef.current;
          if (node) attachTeachingSource(node, video.fullSrc, "auto");
          void warmTeachingSource(video.fullSrc);
        }, TEACHING_HOVER_WARM_MS);
      }}
      onPointerLeave={() => window.clearTimeout(hoverTimer.current)}
    >
      <div
        className={`ns-teach-frame ${settled ? "ns-teach-frame--settled" : ""} ${active ? "ns-teach-frame--active" : "ns-teach-frame--peek"} ${framePlaying ? "is-playing" : ""}`}
      >
        <span className="ns-teach-bevel" aria-hidden="true" />
        <div className="ns-teach-media">
          <img src={video.posterSrc} alt="" width={video.width} height={video.height} />
          {showPreview ? (
            <video
              ref={previewRef}
              className={previewReady ? "is-ready" : ""}
              muted
              loop
              playsInline
              preload="metadata"
              poster={video.posterSrc}
              aria-hidden="true"
              tabIndex={-1}
            />
          ) : null}
          <video
            ref={fullRef}
            className={`ns-teach-full ${fullReady && (phase === "playing" || phase === "paused" || phase === "starting") ? "is-ready" : ""}`}
            playsInline
            preload={active && near && !saveData ? "auto" : "none"}
            controls={active && userPlayback}
            poster={video.posterSrc}
            aria-label={video.ariaLabel}
            style={{ pointerEvents: active && userPlayback ? "auto" : "none" }}
            onLoadedData={() => {
              if (userActivated.current) setFullReady(true);
            }}
            onCanPlay={() => {
              if (userActivated.current) setFullReady(true);
            }}
            onPlaying={() => {
              window.clearTimeout(slowTimer.current);
              setSlowStart(false);
              setBuffering(false);
              setFullReady(true);
              const fromTap = phaseRef.current === "starting";
              setPhase("playing");
              onPlaybackChange(true);
              if (fromTap) {
                trackClient("notes_teaching_video_opened", { video_id: video.id });
                trackClient("notes_teaching_inline_play", { video_id: video.id });
                const node = fullRef.current;
                if (node && !node.muted && node.volume > 0) {
                  trackClient("notes_teaching_sound_enabled", { video_id: video.id });
                }
              }
            }}
            onPause={() => {
              const node = fullRef.current;
              if (!userActivated.current || !node || node.seeking) return;
              onPlaybackChange(false);
              setPhase((cur) => (cur === "error" ? cur : "paused"));
              trackClient("notes_teaching_inline_pause", { video_id: video.id });
            }}
            onWaiting={() => {
              if (userActivated.current) setBuffering(true);
            }}
            onStalled={() => {
              if (userActivated.current) setBuffering(true);
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
            onEnded={() => {
              mark("notes_teaching_video_completed");
              setPhase("paused");
              onPlaybackChange(false);
            }}
            onError={() => {
              const node = fullRef.current;
              if (!userActivated.current && phaseRef.current !== "starting") return;
              if (!retried.current && node) {
                retried.current = true;
                node.load();
                void playTeachingVideo(node);
                return;
              }
              window.clearTimeout(slowTimer.current);
              setSlowStart(false);
              setPhase("error");
              onPlaybackChange(false);
            }}
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
        {showOverlay ? (
          <button
            type="button"
            className="ns-teach-playbtn ca-focus"
            data-loading={phase === "starting" && slowStart ? "true" : undefined}
            onClick={phase === "error" ? retryLoad : startInlinePlay}
            aria-label={phase === "error" ? "Retry teaching video" : "Play teaching video"}
          >
            {phase === "error" ? (
              <span className="ns-teach-error">Unable to load video. Tap to retry.</span>
            ) : (
              <i>
                <Play className="h-6 w-6" strokeWidth={1.75} fill="currentColor" />
              </i>
            )}
          </button>
        ) : null}
        {phase === "playing" && buffering ? <span className="ns-teach-wait" aria-hidden="true" /> : null}
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
