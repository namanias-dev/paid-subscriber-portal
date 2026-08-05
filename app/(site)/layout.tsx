import PublicNav from "@/components/public/PublicNav";
import PublicFooter from "@/components/public/PublicFooter";
import FloatingWhatsApp from "@/components/public/FloatingWhatsApp";
import AiCounselorMount from "@/components/ai-agent/AiCounselorMount";
import { mergeSiteSettings } from "@/lib/homeDefaults";
import { getStudentSession, getBuyerSession } from "@/lib/session";
import { resolveNavTabs } from "@/lib/navConfig";
import { whatsappLink } from "@/lib/phone";

/**
 * SEV1 CPU rule: the public layout must NEVER touch Postgres.
 * Site chrome uses static defaults; live site_settings / webinars / What's New
 * are fetched only on pages that need them (home / webinars), under ISR.
 * Sessions are JWT cookie verifies — buyer version check is fail-open and rare.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const settings = mergeSiteSettings(null);
  const [session, buyerSession] = await Promise.all([
    getStudentSession().catch(() => null),
    getBuyerSession().catch(() => null),
  ]);
  const userName = session?.name || buyerSession?.name || null;
  const waLink = whatsappLink(
    settings.brand.whatsapp || settings.brand.support_phone,
    "Hi, I have a question about your courses / webinars."
  );
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicNav
        logoUrl={settings.logo_url}
        logoAlt={settings.logo_alt}
        logoHeight={settings.content.logo_height}
        showWordmark={settings.content.show_wordmark}
        wordmark={settings.content.wordmark}
        wordmarkSub={settings.content.wordmark_sub}
        isLoggedIn={!!session}
        portalLoggedIn={!!buyerSession}
        userName={userName}
        links={resolveNavTabs(settings.nav)}
        hasUpcomingWebinars={false}
        announcements={[]}
      />
      <main className="flex-1">{children}</main>
      <PublicFooter brand={settings.brand} />
      <FloatingWhatsApp waLink={waLink} />
      <AiCounselorMount waLink={waLink} />
    </div>
  );
}
