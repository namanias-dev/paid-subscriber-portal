import { redirect } from "next/navigation";
import { pageSession } from "@/lib/guard";
import { flags } from "@/lib/flags";
import AppNav from "@/components/AppNav";
import SwRegister from "@/components/SwRegister";
import DrillProvider from "@/components/drill/DrillProvider";

export const dynamic = "force-dynamic";

export default async function AivaLayout({ children }: { children: React.ReactNode }) {
  if (!flags.enabled) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <h1 className="font-heading text-xl font-bold text-white">AIVA is disabled</h1>
          <p className="text-muted">Set AIVA_ENABLED=true to enable the command center.</p>
        </div>
      </main>
    );
  }
  const session = await pageSession();
  if (!session?.is_super) redirect("/login");

  return (
    <DrillProvider>
      <div className="flex min-h-screen flex-col md:flex-row">
        <SwRegister />
        <AppNav name={session.name || session.username} />
        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </DrillProvider>
  );
}
