import PublicNav from "@/components/public/PublicNav";
import PublicFooter from "@/components/public/PublicFooter";
import { getSiteSettings } from "@/lib/dataProvider";
import { getStudentSession } from "@/lib/session";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSiteSettings();
  const session = await getStudentSession();
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
      />
      <main className="flex-1">{children}</main>
      <PublicFooter brand={settings.brand} />
    </div>
  );
}
