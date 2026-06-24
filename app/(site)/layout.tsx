import PublicNav from "@/components/public/PublicNav";
import PublicFooter from "@/components/public/PublicFooter";
import FloatingWhatsApp from "@/components/public/FloatingWhatsApp";
import { getSiteSettings } from "@/lib/dataProvider";
import { getStudentSession, getBuyerSession } from "@/lib/session";
import { resolveNavTabs } from "@/lib/navConfig";
import { whatsappLink } from "@/lib/phone";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSiteSettings();
  const [session, buyerSession] = await Promise.all([getStudentSession(), getBuyerSession()]);
  const userName = session?.name || buyerSession?.name || null;
  const waLink = whatsappLink(
    settings.brand.whatsapp || settings.brand.support_phone,
    "Hi, I have a question about your courses / webinars."
  );
  return (
    <div className="flex min-h-screen flex-col">
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
      />
      <main className="flex-1">{children}</main>
      <PublicFooter brand={settings.brand} />
      <FloatingWhatsApp waLink={waLink} />
    </div>
  );
}
