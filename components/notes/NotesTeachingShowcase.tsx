"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { trackClient } from "@/lib/analytics/client";
import { listEnabledTeachingVideos } from "@/lib/store/teachingVideos";
import TeachingVideoCard from "./TeachingVideoCard";
import TeachingVideoLightbox from "./TeachingVideoLightbox";

function saveDataPreferred(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !!conn?.saveData;
}

export default function NotesTeachingShowcase() {
  const videos = listEnabledTeachingVideos();
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { once: true, margin: "-18% 0px" });
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const viewed = useRef(false);

  useEffect(() => {
    setSaveData(saveDataPreferred());
  }, []);

  useEffect(() => {
    if (!inView || viewed.current || !videos.length) return;
    viewed.current = true;
    trackClient("notes_teaching_section_viewed", { video_count: videos.length });
  }, [inView, videos.length]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || videos.length < 2) return;
    const onScroll = () => {
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
        trackClient("notes_teaching_video_changed", { video_id: videos[next]?.id, from_video_id: videos[cur]?.id });
        return next;
      });
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => rail.removeEventListener("scroll", onScroll);
  }, [videos]);

  if (!videos.length) return null;
  const active = videos[index] ?? videos[0];
  const multi = videos.length > 1;
  const enter = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 },
          transition: { duration: 0.72, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  const go = (next: number) => {
    const bounded = (next + videos.length) % videos.length;
    setIndex(bounded);
    const slide = railRef.current?.querySelectorAll<HTMLElement>(".ns-teach-slide")[bounded];
    slide?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", inline: "center", block: "nearest" });
    trackClient("notes_teaching_video_changed", { video_id: videos[bounded]?.id, from_video_id: active.id });
  };

  return (
    <section ref={sectionRef} className="ns-teach" id="naman-sir-teaches" aria-labelledby="ns-teach-heading">
      <div className="container-wide ns-teach-grid">
        <div className="ns-teach-copy">
          <motion.p className="ca-eyebrow text-[var(--ca-gold-dark)]" {...enter(0)}>
            From the classroom
          </motion.p>
          <motion.h2 id="ns-teach-heading" className="ns-teach-title font-heading" {...enter(0.08)}>
            See How Naman Sir
            <br />
            Makes UPSC Simple.
          </motion.h2>
          <motion.p className="ns-teach-support" {...enter(0.16)}>
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
        </div>

        <div className="ns-teach-stage-wrap">
          <div>
            <div
              ref={railRef}
              className={`ns-teach-rail ns-hide-scrollbar ${multi ? "" : "ns-teach-rail--single"}`}
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
              {videos.map((video, i) => (
                <TeachingVideoCard
                  key={video.id}
                  video={video}
                  active={i === index && inView}
                  saveData={saveData}
                  onOpen={() => {
                    setIndex(i);
                    setOpen(true);
                    trackClient("notes_teaching_video_opened", { video_id: video.id });
                  }}
                />
              ))}
            </div>
            {multi ? (
              <>
                <div className="ns-teach-progress" aria-hidden="true">
                  {videos.map((video, i) => (
                    <i key={video.id} data-active={i === index} />
                  ))}
                </div>
                <p className="ns-teach-hint">Swipe to explore</p>
              </>
            ) : null}
          </div>
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
          className="mt-4 inline-flex text-sm font-semibold text-[var(--ca-navy)] underline-offset-4 hover:underline"
          onClick={() => trackClient("notes_shop_after_teaching_clicked", { video_id: active.id })}
        >
          Shop by Subject
        </Link>
      </div>

      {open ? <TeachingVideoLightbox video={active} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}
