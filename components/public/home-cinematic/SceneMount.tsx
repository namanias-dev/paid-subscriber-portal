"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCapability } from "./CapabilityProvider";

/**
 * Shared lifecycle gate for every WebGL scene on the preview.
 *
 * Responsibilities, in the order they matter for performance:
 *
 *   1. NEVER mount during SSR or first paint. The capability provider reports
 *      tier D until hydration, so the hero's text and CTAs are always painted
 *      and interactive before any WebGL module is even requested.
 *   2. Defer the dynamic import until the browser is idle (`requestIdleCallback`,
 *      with a timeout fallback), so three.js never competes with LCP.
 *   3. Only mount when the host element is actually near the viewport
 *      (IntersectionObserver with a rootMargin pre-roll).
 *   4. Pause the render loop when the scene leaves the viewport OR the tab is
 *      hidden (`visibilitychange`) — a paused loop is `frameloop="never"`, which
 *      costs nothing.
 *   5. Unmount entirely once the scene is far away, which triggers each scene's
 *      disposer and returns GPU memory.
 *
 * Tier D never mounts anything: `children` is simply never rendered, and the
 * caller's static fallback stays visible.
 */
export interface SceneMountProps {
  /** Receives `active` so the scene can flip `frameloop`. */
  children: (args: { active: boolean; particles: number; dprCap: number; reduced: boolean }) => ReactNode;
  /** Static, always-server-rendered visual shown until/unless WebGL mounts. */
  fallback?: ReactNode;
  /** How early to start loading, as a CSS margin for IntersectionObserver. */
  rootMargin?: string;
  className?: string;
  /** Scale the tier particle budget for cheaper scenes. */
  particleScale?: number;
}

export default function SceneMount({
  children,
  fallback,
  rootMargin = "200px",
  className,
  particleScale = 1,
}: SceneMountProps) {
  const cap = useCapability();
  const host = useRef<HTMLDivElement>(null);
  const [idle, setIdle] = useState(false);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(true);
  const [onScreen, setOnScreen] = useState(false);

  // (2) Wait for idle before we are willing to load anything heavy.
  useEffect(() => {
    if (!cap.resolved || !cap.webgl) return;
    type IdleWin = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as IdleWin;
    let idleId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (typeof w.requestIdleCallback === "function") {
      idleId = w.requestIdleCallback(() => setIdle(true), { timeout: 2500 });
    } else {
      timer = setTimeout(() => setIdle(true), 1200);
    }
    return () => {
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
      if (timer) clearTimeout(timer);
    };
  }, [cap.resolved, cap.webgl]);

  // (3)+(5) Proximity drives mount/unmount; (4) intersection drives pause.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const preload = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin });
    const inView = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.01 });
    preload.observe(el);
    inView.observe(el);
    return () => {
      preload.disconnect();
      inView.disconnect();
    };
  }, [rootMargin]);

  // (4) Hidden tabs never render.
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    onVis();
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const mounted = cap.resolved && cap.webgl && idle && near;
  const active = mounted && onScreen && visible;

  return (
    <div ref={host} className={className}>
      {fallback}
      {mounted
        ? children({
            active,
            particles: Math.max(24, Math.round(cap.particles * particleScale)),
            dprCap: cap.dprCap,
            reduced: cap.reducedMotion,
          })
        : null}
    </div>
  );
}
