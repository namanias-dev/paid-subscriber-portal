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
import { getSiteSettings } from "@/lib/dataProvider";
import { whatsappLink } from "@/lib/phone";
import AiCounselorWidget from "./AiCounselorWidget";

export default async function AiCounselorMount() {
  const cfg = getAiAgentConfig();
  if (!cfg.publicWidget) return null;

  let waLink: string | null = null;
  try {
    const settings = await getSiteSettings();
    waLink = whatsappLink(
      settings.brand.whatsapp || settings.brand.support_phone,
      "Hi, I'd like some guidance on UPSC preparation.",
    );
  } catch {
    waLink = null;
  }

  return <AiCounselorWidget waLink={waLink} />;
}
