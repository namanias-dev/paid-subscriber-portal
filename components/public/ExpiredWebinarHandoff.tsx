"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { ga4Event } from "@/lib/analytics/ga4";
import { trackClient } from "@/lib/analytics/client";
import { HANDOFF_DELAY_MS, HANDOFF_HISTORY_MODE, handoffUrl } from "@/lib/webinarRecovery";

export interface RecoveryAnalyticsContext {
  expired_webinar_id: string;
  expired_webinar_slug: string;
  expired_webinar_date: string | null;
  next_webinar_id: string | null;
  next_webinar_slug: string | null;
  next_webinar_date: string | null;
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"] as const;
const CLICK_KEYS = ["fbclid", "gclid", "wbraid", "gbraid"] as const;

function utmProps(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) out[key] = value.slice(0, 100);
    }
    for (const key of CLICK_KEYS) {
      const value = params.get(key);
      if (value) out[key] = value.slice(0, 100);
    }
    const source = params.get("utm_source");
    const medium = params.get("utm_medium");
    const campaign = params.get("utm_campaign");
    if (source) out.source = source.slice(0, 100);
    if (medium) out.medium = medium.slice(0, 100);
    if (campaign) out.campaign = campaign.slice(0, 100);
  } catch {
    /* ignore */
  }
  return out;
}

function emit(name: "expired_webinar_viewed" | "expired_webinar_cta_clicked" | "expired_webinar_auto_forwarded", context: RecoveryAnalyticsContext, beacon = false) {
  const props = { ...context, ...utmProps() };
  ga4Event(name, props, beacon ? { beacon: true } : undefined);
  trackClient(name, props);
  try {
    const ph = (window as unknown as { posthog?: { capture?: (event: string, properties: Record<string, unknown>) => void } }).posthog;
    ph?.capture?.(name, props);
  } catch {
    /* PostHog is optional and already loaded by the site when consented. */
  }
}

/**
 * Client island for the ended-webinar handoff.
 * The CTA is a real link (works without JavaScript). Auto-forward uses
 * router.replace so Back does not return to a page that redirects again.
 * The countdown mounts only after hydration, so it never mismatches the server.
 */
export default function ExpiredWebinarHandoff({
  nextPath,
  ctaLabel,
  ctaMeta,
  context,
}: {
  nextPath: string | null;
  ctaLabel: string;
  ctaMeta: string | null;
  context: RecoveryAnalyticsContext;
}) {
  const router = useRouter();
  const [showHandoff, setShowHandoff] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(HANDOFF_DELAY_MS / 1000);
  const [href, setHref] = useState(nextPath || "");
  const cancelled = useRef(false);
  const left = useRef(false);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    emit("expired_webinar_viewed", contextRef.current);
  }, [context.expired_webinar_id, context.expired_webinar_slug, context.next_webinar_id, context.next_webinar_slug]);

  useEffect(() => {
    if (!nextPath) return;
    setHref(handoffUrl(nextPath, window.location.search));
    setShowHandoff(true);
    const started = Date.now();
    const tick = window.setInterval(() => {
      if (cancelled.current) return;
      const remaining = Math.max(0, Math.ceil((HANDOFF_DELAY_MS - (Date.now() - started)) / 1000));
      setSecondsLeft(remaining);
    }, 250);
    const forward = window.setTimeout(() => {
      if (cancelled.current || left.current) return;
      left.current = true;
      const dest = handoffUrl(nextPath, window.location.search);
      emit("expired_webinar_auto_forwarded", contextRef.current, true);
      if (HANDOFF_HISTORY_MODE === "replace") router.replace(dest);
    }, HANDOFF_DELAY_MS);

    const stop = () => {
      cancelled.current = true;
      setShowHandoff(false);
    };
    window.addEventListener("pointerdown", stop);
    window.addEventListener("keydown", stop);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(forward);
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", stop);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
    };
  }, [nextPath, router]);

  if (!nextPath) return null;

  return (
    <div className="mt-6">
      <a
        href={href || nextPath}
        className="ca-btn ca-btn-gold ca-focus wh-cta inline-flex min-h-12 w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-5 py-3 text-center text-base font-bold sm:w-auto"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          if (left.current) return;
          left.current = true;
          cancelled.current = true;
          const dest = handoffUrl(nextPath, window.location.search);
          emit("expired_webinar_cta_clicked", contextRef.current, true);
          if (HANDOFF_HISTORY_MODE === "replace") router.replace(dest);
        }}
      >
        <span>{ctaLabel}</span>
        {ctaMeta ? <span className="text-sm font-semibold opacity-80">{ctaMeta}</span> : null}
        <ArrowRight size={18} aria-hidden="true" />
      </a>
      {showHandoff ? (
        <div className="mt-4 max-w-sm">
          <p className="wh-forward-live text-sm text-[var(--ca-slate-600)]" aria-live="polite">
            Opening the next masterclass in {secondsLeft}…
          </p>
          <p className="wh-forward-still text-sm text-[var(--ca-slate-600)]">
            Taking you to the next live masterclass…
          </p>
          <div className="wh-bar-track mt-2 h-px w-full overflow-hidden bg-[var(--ca-slate-200)]" aria-hidden="true">
            <div className="wh-bar h-px w-full bg-[var(--ca-gold-dark)]" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
