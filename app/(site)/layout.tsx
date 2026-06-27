import PublicNav from "@/components/public/PublicNav";
import PublicFooter from "@/components/public/PublicFooter";
import FloatingWhatsApp from "@/components/public/FloatingWhatsApp";
import { getSiteSettings, getWebinars } from "@/lib/dataProvider";
import { getStudentSession, getBuyerSession } from "@/lib/session";
import { resolveNavTabs } from "@/lib/navConfig";
import { whatsappLink } from "@/lib/phone";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSiteSettings();
  const [session, buyerSession, webinars] = await Promise.all([
    getStudentSession(),
    getBuyerSession(),
    getWebinars(),
  ]);
  const userName = session?.name || buyerSession?.name || null;
  // Auto NEW badge on the Webinars nav item when any webinar is scheduled (not completed).
  const nowMs = Date.now();
  const hasUpcomingWebinars = webinars.some(
    (w) => w.status !== "completed" && (!w.datetime || new Date(w.datetime).getTime() > nowMs),
  );
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
        hasUpcomingWebinars={hasUpcomingWebinars}
      />
      <main className="flex-1">{children}</main>
      <PublicFooter brand={settings.brand} />
      <FloatingWhatsApp waLink={waLink} />
    </div>
  );
}
