import PublicNav from "@/components/public/PublicNav";
import PublicFooter from "@/components/public/PublicFooter";
import { getSiteSettings } from "@/lib/dataProvider";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSiteSettings();
  return (
    <div className="flex min-h-screen flex-col">
      <PublicNav logoUrl={settings.logo_url} logoAlt={settings.logo_alt} />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
