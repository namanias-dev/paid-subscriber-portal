/**
 * AiCounselorMount — SERVER-side gate for the public AI counsellor widget.
 *
 * SHIP DARK: renders NOTHING (and ships no client JS for the widget) unless
 * AI_AGENT_PUBLIC_WIDGET is true. The flag is read at request time via
 * getAiAgentConfig() (computed env access, not build-inlined) so it can be flipped
 * per-environment in Vercel WITHOUT a rebuild — set it on the Preview scope only
 * to safely preview, never on Production.
 *
 * When enabled, it resolves the support WhatsApp deep link server-side (from the
 * admin-editable site settings — never hardcoded) and hands it to the client
 * widget for the counsellor-handoff WhatsApp action (wa.me click-to-chat only).
 */
import { getAiAgentConfig } from "@/lib/ai-agent/config";
import AiCounselorWidget from "./AiCounselorWidget";

/**
 * `waLink` is resolved once in the public layout (from the admin-editable site
 * settings) and passed in, so we don't re-fetch settings here. Falls back to null.
 */
export default function AiCounselorMount({ waLink = null }: { waLink?: string | null }) {
  const cfg = getAiAgentConfig();
  if (!cfg.publicWidget) return null;
  return <AiCounselorWidget waLink={waLink} />;
}
