import LoginForm from "@/components/layout/LoginForm";
import Reveal from "@/components/ui/Reveal";

export const metadata = { title: "Login — Naman Sharma IAS Academy" };

export default function LoginPage({ searchParams }: { searchParams?: { expired?: string } }) {
  const expired = searchParams?.expired === "1";
  return (
    <div className="container-x section">
      <Reveal>
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold sm:text-4xl">Welcome back</h1>
          <p className="mt-2 text-ink2">Login to access your dashboard, courses and study material.</p>
        </div>
      </Reveal>
      {expired && (
        <div className="mx-auto mb-5 max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-800">
          Your session timed out for security. Please log in again — your progress is saved.
        </div>
      )}
      <LoginForm />
    </div>
  );
}
