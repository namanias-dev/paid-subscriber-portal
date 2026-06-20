import LoginForm from "@/components/layout/LoginForm";
import Reveal from "@/components/ui/Reveal";

export const metadata = { title: "Login — Naman Sharma IAS Academy" };

export default function LoginPage() {
  return (
    <div className="container-x section">
      <Reveal>
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold sm:text-4xl">Welcome back</h1>
          <p className="mt-2 text-ink2">Login to access your dashboard, courses and study material.</p>
        </div>
      </Reveal>
      <LoginForm />
    </div>
  );
}
