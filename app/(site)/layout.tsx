import PublicNav from "@/components/public/PublicNav";
import PublicFooter from "@/components/public/PublicFooter";
import FloatingWhatsApp from "@/components/public/FloatingWhatsApp";
import AiCounselorMount from "@/components/ai-agent/AiCounselorMount";
import { mergeSiteSettings } from "@/lib/homeDefaults";
import { resolveNavTabs } from "@/lib/navConfig";
import { whatsappLink } from "@/lib/phone";

/**
 * SEV1 CPU rule: the public layout must NEVER touch Postgres OR cookies().
 * Reading sessions here forced every public page dynamic and defeated ISR.
 * Auth chrome hydrates client-side in PublicNav when a session cookie exists.
 * Site chrome uses static defaults; live site_settings / webinars / What's New
 * are fetched only on pages that need them (home / webinars), under ISR.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const settings = mergeSiteSettings(null);
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
        isLoggedIn={false}
        portalLoggedIn={false}
        userName={null}
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
