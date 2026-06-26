import LoginForm from "@/components/layout/LoginForm";
import Reveal from "@/components/ui/Reveal";

export const metadata = { title: "Login — Naman Sharma IAS Academy" };

export default function LoginPage({ searchParams }: { searchParams?: { expired?: string } }) {
  const expired = searchParams?.expired === "1";
  return (
    <div className="lp-shell section">
      <div className="lp-glow lp-glow-1" aria-hidden />
      <div className="lp-glow lp-glow-2" aria-hidden />
      <div className="container-x">
        <Reveal>
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--navy)] sm:text-4xl">Welcome back</h1>
            <p className="mt-2 text-ink2">Login to access your dashboard, courses and study material.</p>
          </div>
        </Reveal>
        {expired && (
          <div className="mx-auto mb-5 max-w-md rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-center text-sm font-medium text-amber-800 backdrop-blur">
            Your session timed out for security. Please log in again — your progress is saved.
          </div>
        )}
        <LoginForm />
      </div>
    </div>
  );
}
