"use client";

/**
 * AiCounselorWidget — the floating launcher + page-aware trigger logic.
 *
 * Rendered ONLY when AI_AGENT_PUBLIC_WIDGET is true (the server mount gates this;
 * see AiCounselorMount). It is lazy and NEVER blocks page load: the heavy chat
 * sheet is code-split via next/dynamic(ssr:false) and only loaded on open.
 *
 * Trigger rules (conversationPolicy.TRIGGER_POLICY):
 *  - NEVER auto-open on initial paint.
 *  - Auto-open after 8–15s OR at 30% scroll, whichever comes first.
 *  - At most once per session; suppressed for 24h after a manual dismiss.
 *  - Excluded entirely from private / payment-internal routes.
 *
 * Positioned to avoid the WhatsApp button, mobile sticky payment CTAs, and the
 * bottom nav (raised offset on mobile, below the WhatsApp z-index).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { ensureSession } from "@/lib/analytics/client";
import { isWidgetAllowedPath, flowForPath, TRIGGER_POLICY } from "@/lib/ai-agent/conversationPolicy";
import { trackAgentEvent } from "./agentAnalytics";

const AiChatSheet = dynamic(() => import("./AiChatSheet"), { ssr: false });

const { minDelayMs, maxDelayMs, scrollFraction, dismissSuppressMs, storageKeys } = TRIGGER_POLICY;

/**
 * Launcher glyph selection. Flip this single constant to swap the premium mark:
 *  - "compass"  → elegant compass (guidance / direction)  [DEFAULT]
 *  - "northstar" → four-point north-star (aspiration / clarity)
 * Purely visual; no behaviour changes either way.
 */
const LAUNCHER_VARIANT: "compass" | "northstar" = "compass";

/** Deep-navy tone derived from the --primary token (no new palette colors). */
const NAVY_DEEP = "color-mix(in srgb, var(--primary) 55%, #000)";

/** Minimal, gold-on-navy brand mark rendered inside the launcher badge. */
function LauncherGlyph() {
  if (LAUNCHER_VARIANT === "northstar") {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true" style={{ color: "var(--gold)" }}>
        <path
          d="M12 3 L13.9 10.1 L21 12 L13.9 13.9 L12 21 L10.1 13.9 L3 12 L10.1 10.1 Z"
          fill="currentColor"
        />
        <path d="M18.4 4.4 L19 6.4 L21 7 L19 7.6 L18.4 9.6 L17.8 7.6 L15.8 7 L17.8 6.4 Z" fill="currentColor" opacity="0.85" />
      </svg>
    );
  }
  // Default: compass.
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true" style={{ color: "var(--gold)" }}>
      <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M12 3.1v1.7M12 19.2v1.7M20.9 12h-1.7M4.8 12H3.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path d="M15.6 8.4 11.1 11.1 8.4 15.6 12.9 12.9 Z" fill="currentColor" />
      <circle cx="12" cy="12" r="1.05" fill={NAVY_DEEP} />
    </svg>
  );
}

function safeLocalGet(key: string): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}
function safeLocalSet(key: string, value: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export default function AiCounselorWidget({ waLink }: { waLink: string | null }) {
  const pathname = usePathname() || "";
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const autoTriggered = useRef(false);

  const allowed = useMemo(() => isWidgetAllowedPath(pathname), [pathname]);
  const initialFlow = useMemo(() => flowForPath(pathname), [pathname]);

  // Resolve a session id (reuses the site's rolling nsa_sid cookie).
  useEffect(() => {
    const s = ensureSession();
    if (s?.id) setSessionId(s.id);
  }, []);

  const openSheet = useCallback(() => {
    setOpen(true);
    safeLocalSet(storageKeys.openedSession, "1");
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
    safeLocalSet(storageKeys.dismissedAt, String(Date.now()));
    if (sessionId) trackAgentEvent(sessionId, "ai_widget_dismissed", { path: pathname });
  }, [sessionId, pathname]);

  // Auto-open trigger (time + scroll), gated by session + dismiss suppression.
  useEffect(() => {
    if (!allowed || open || autoTriggered.current) return;

    // Suppression checks.
    const openedThisSession = safeLocalGet(storageKeys.openedSession) === "1";
    if (openedThisSession) return;
    const dismissedAt = Number(safeLocalGet(storageKeys.dismissedAt) || 0);
    if (dismissedAt && Date.now() - dismissedAt < dismissSuppressMs) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const trigger = () => {
      if (autoTriggered.current) return;
      autoTriggered.current = true;
      cleanup();
      openSheet();
    };

    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      if (scrollable <= 0) return;
      if (doc.scrollTop / scrollable >= scrollFraction) trigger();
    };

    const delay = minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
    timer = setTimeout(trigger, delay);
    window.addEventListener("scroll", onScroll, { passive: true });

    function cleanup() {
      if (timer) clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    }
    return cleanup;
  }, [allowed, open, openSheet]);

  if (!allowed) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={openSheet}
          aria-label="Chat with a Naman IAS counsellor"
          className="group fixed right-4 z-40 flex items-center gap-2.5 rounded-full py-2 pl-2 pr-2.5 text-sm font-semibold text-white outline-none transition-[transform,box-shadow] duration-200 ease-out shadow-[0_4px_10px_-2px_rgba(0,18,54,0.35),0_12px_30px_-8px_rgba(0,40,120,0.5)] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-transparent motion-safe:hover:-translate-y-0.5 motion-safe:hover:scale-[1.03] motion-safe:active:scale-95 motion-safe:hover:shadow-[0_8px_16px_-2px_rgba(0,18,54,0.45),0_20px_44px_-8px_rgba(0,50,140,0.6),0_0_22px_-2px_rgba(201,162,39,0.45)] sm:pl-2.5 sm:pr-4"
          style={{
            bottom: "5rem",
            background: "linear-gradient(145deg, var(--primary) 0%, color-mix(in srgb, var(--primary) 55%, #000) 100%)",
            border: "1px solid color-mix(in srgb, var(--gold) 70%, transparent)",
            marginBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full"
            style={{
              background: "color-mix(in srgb, var(--primary) 55%, #000)",
              border: "1px solid color-mix(in srgb, var(--gold) 55%, transparent)",
              boxShadow: "inset 0 1px 2px rgba(255,255,255,0.12)",
            }}
          >
            <LauncherGlyph />
          </span>
          <span className="hidden pr-0.5 sm:inline">Ask a counsellor</span>
        </button>
      )}

      {open && sessionId && (
        <AiChatSheet
          sessionId={sessionId}
          waLink={waLink}
          initialFlow={initialFlow}
          pageContext={{ pagePath: pathname, offerId: null, offerType: null }}
          onClose={dismiss}
        />
      )}
    </>
  );
}
