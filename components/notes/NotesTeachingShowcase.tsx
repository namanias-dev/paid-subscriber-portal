"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { trackClient } from "@/lib/analytics/client";
import { listEnabledTeachingVideos } from "@/lib/store/teachingVideos";
import TeachingVideoCard from "./TeachingVideoCard";

function saveDataPreferred(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !!conn?.saveData;
}

function centerSlide(rail: HTMLElement, slide: HTMLElement, instant: boolean) {
  const railBox = rail.getBoundingClientRect();
  const slideBox = slide.getBoundingClientRect();
  const left = rail.scrollLeft + (slideBox.left - railBox.left) - (rail.clientWidth - slide.offsetWidth) / 2;
  rail.scrollTo({ left: Math.max(0, left), behavior: instant ? "auto" : "smooth" });
}

export default function NotesTeachingShowcase() {
  const videos = listEnabledTeachingVideos();
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { once: true, margin: "-18% 0px" });
  const [index, setIndex] = useState(0);
  const [saveData, setSaveData] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const viewed = useRef(false);
  const suppressScroll = useRef(false);

  useEffect(() => {
    setSaveData(saveDataPreferred());
    try {
      if (sessionStorage.getItem("ns-teach-swiped") === "1") setShowHint(false);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!inView || viewed.current || !videos.length) return;
    viewed.current = true;
    trackClient("notes_teaching_section_viewed", { video_count: videos.length });
  }, [inView, videos.length]);

  const markSwiped = useCallback(() => {
    setShowHint(false);
    try {
      sessionStorage.setItem("ns-teach-swiped", "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || videos.length < 2) return;
    let frame = 0;
    const onScroll = () => {
      if (suppressScroll.current) return;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const slides = [...rail.querySelectorAll<HTMLElement>(".ns-teach-slide")];
        if (!slides.length) return;
        const mid = rail.scrollLeft + rail.clientWidth / 2;
        let next = 0;
        let best = Number.POSITIVE_INFINITY;
        slides.forEach((slide, i) => {
          const center = slide.offsetLeft + slide.offsetWidth / 2;
          const dist = Math.abs(center - mid);
          if (dist < best) {
            best = dist;
            next = i;
          }
        });
        setIndex((cur) => {
          if (cur === next) return cur;
          markSwiped();
          setPlaying(false);
          trackClient("notes_teaching_video_changed", { video_id: videos[next]?.id, from_video_id: videos[cur]?.id });
          return next;
        });
      });
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      rail.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [markSwiped, videos]);

  const go = useCallback(
    (next: number, fromUser = true) => {
      if (!videos.length) return;
      const bounded = (next + videos.length) % videos.length;
      setIndex(bounded);
      setPlaying(false);
      const rail = railRef.current;
      const slide = rail?.querySelectorAll<HTMLElement>(".ns-teach-slide")[bounded];
      if (rail && slide) {
        suppressScroll.current = true;
        centerSlide(rail, slide, !!reduce);
        window.setTimeout(() => {
          suppressScroll.current = false;
        }, reduce ? 20 : 420);
      }
      if (fromUser) {
        markSwiped();
        trackClient("notes_teaching_video_changed", { video_id: videos[bounded]?.id, from_video_id: videos[index]?.id });
      }
    },
    [index, markSwiped, reduce, videos],
  );

  useEffect(() => {
    const rail = railRef.current;
    const slide = rail?.querySelectorAll<HTMLElement>(".ns-teach-slide")[0];
    if (rail && slide) centerSlide(rail, slide, true);
  }, [videos.length]);

  if (!videos.length) return null;
  const active = videos[index] ?? videos[0];
  const multi = videos.length > 1;
  const enter = (delay: number, extraY = 14) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: extraY },
          animate: inView ? { opacity: 1, y: 0 } : { opacity: 0, y: extraY },
          transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <section ref={sectionRef} className="ns-teach" id="naman-sir-teaches" aria-labelledby="ns-teach-heading">
      <div className="container-wide ns-teach-grid">
        <header className="ns-teach-copy">
          <motion.p className="ca-eyebrow ns-teach-eyebrow" {...enter(0, 10)}>
            From the classroom
          </motion.p>
          <motion.h2 id="ns-teach-heading" className="ns-teach-title font-heading" {...enter(0.08, 16)}>
            See How Naman Sir
            <br />
            Makes UPSC Simple.
          </motion.h2>
          <motion.p className="ns-teach-support" {...enter(0.16, 12)}>
            Learn from the same teaching approach behind his handwritten notes.
          </motion.p>
          {multi ? (
            <div className="ns-teach-nav">
              <button type="button" className="ca-focus" aria-label="Previous teaching clip" onClick={() => go(index - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" className="ca-focus" aria-label="Next teaching clip" onClick={() => go(index + 1)}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </header>

        <div className="ns-teach-stage">
          <div
            ref={railRef}
            className={`ns-teach-viewport ns-hide-scrollbar ${multi ? "" : "ns-teach-viewport--single"}`}
            role={multi ? "region" : undefined}
            aria-roledescription={multi ? "carousel" : undefined}
            aria-label="Naman Sir teaching clips"
            tabIndex={multi ? 0 : undefined}
            onKeyDown={(e) => {
              if (!multi) return;
              if (e.key === "ArrowRight") go(index + 1);
              if (e.key === "ArrowLeft") go(index - 1);
            }}
          >
            <div className="ns-teach-track">
              {videos.map((video, i) => (
                <TeachingVideoCard
                  key={video.id}
                  video={video}
                  active={i === index}
                  near={inView}
                  saveData={saveData}
                  onSelect={() => go(i)}
                  onPlaybackChange={(next) => {
                    if (i === index) setPlaying(next);
                  }}
                />
              ))}
            </div>
          </div>

          <div className="ns-teach-meta" aria-live="polite">
            <p>Naman Sir · UPSC Faculty</p>
            {active.title ? <small>{active.title}</small> : <small>Teaching clip {index + 1}</small>}
            {!playing ? <span>Tap to play with sound</span> : null}
          </div>

          {multi ? (
            <>
              <div className="ns-teach-progress" aria-hidden="true">
                {videos.map((video, i) => (
                  <button
                    key={video.id}
                    type="button"
                    aria-label={`Show teaching clip ${i + 1}`}
                    data-active={i === index}
                    onClick={() => go(i)}
                  />
                ))}
              </div>
              {showHint ? (
                <p className="ns-teach-hint">
                  Swipe to explore
                  <span aria-hidden="true"> →</span>
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <div className="container-wide ns-teach-bridge">
        <h3 className="font-heading">
          What You See Him Teach.
          <br />
          Now in Your Hands.
        </h3>
        <p className="ns-teach-proofs">Concept Clarity · Handwritten Structure · Revision Focused</p>
        <Link
          href="#catalogue"
          className="ns-teach-shop ca-focus"
          onClick={() => trackClient("notes_shop_after_teaching_clicked", { video_id: active.id })}
        >
          Shop by Subject
        </Link>
      </div>
    </section>
  );
}
