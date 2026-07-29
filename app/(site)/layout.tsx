import PublicNav from "@/components/public/PublicNav";
import PublicFooter from "@/components/public/PublicFooter";
import FloatingWhatsApp from "@/components/public/FloatingWhatsApp";
import AiCounselorMount from "@/components/ai-agent/AiCounselorMount";
import { getSiteSettings, hasUpcomingWebinars } from "@/lib/dataProvider";
import { mergeSiteSettings } from "@/lib/homeDefaults";
import { getStudentSession, getBuyerSession } from "@/lib/session";
import { resolveNavTabs } from "@/lib/navConfig";
import { whatsappLink } from "@/lib/phone";
import { getWhatsNew } from "@/lib/announcements";

async function withBudget<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * SEV1: layout runs on EVERY public page. It must never wait on a saturated DB
 * long enough to 504 the route. Budget all shell data; fall back to defaults.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const emptyWhatsNew = { barItems: [] as Awaited<ReturnType<typeof getWhatsNew>>["barItems"] };
  const settings = await withBudget(getSiteSettings(), 1500, mergeSiteSettings(null));

  const [session, buyerSession, upcomingWebinars, whatsNew] = await withBudget(
    Promise.all([
      getStudentSession().catch(() => null),
      getBuyerSession().catch(() => null),
      hasUpcomingWebinars().catch(() => false),
      getWhatsNew().catch(() => emptyWhatsNew),
    ]),
    2000,
    [null, null, false, emptyWhatsNew] as [
      Awaited<ReturnType<typeof getStudentSession>>,
      Awaited<ReturnType<typeof getBuyerSession>>,
      boolean,
      typeof emptyWhatsNew,
    ],
  );
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
        hasUpcomingWebinars={upcomingWebinars}
        announcements={whatsNew.barItems}
      />
      <main className="flex-1">{children}</main>
      <PublicFooter brand={settings.brand} />
      <FloatingWhatsApp waLink={waLink} />
      {/* AI counsellor widget — renders ONLY when AI_AGENT_PUBLIC_WIDGET=true (ship dark). */}
      <AiCounselorMount waLink={waLink} />
    </div>
  );
}
