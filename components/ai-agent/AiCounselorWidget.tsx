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
          className="fixed right-4 z-40 flex items-center gap-2 rounded-full py-2.5 pl-3 pr-4 text-sm font-semibold text-white shadow-lg transition hover:scale-[1.03]"
          style={{
            bottom: "5rem",
            background: "var(--primary)",
            marginBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full text-base" style={{ background: "var(--gold, #d4af37)", color: "var(--primary)" }}>
            🎓
          </span>
          <span className="hidden sm:inline">Ask a counsellor</span>
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
