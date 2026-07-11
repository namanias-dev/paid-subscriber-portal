import { redirect } from "next/navigation";
import { pageSession } from "@/lib/guard";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await pageSession();
  if (session?.is_super) redirect("/aiva");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 h-14 w-14 rounded-2xl bg-gradient-to-br from-gold-bright to-royal shadow-goldglow" />
          <h1 className="font-heading text-2xl font-extrabold text-white">AIVA</h1>
          <p className="text-sm text-muted">Aman&apos;s Intelligent Virtual Assistant</p>
          <p className="mt-1 text-xs text-muted">Private CEO Command Center · Super Admin only</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
