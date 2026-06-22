import PortalLoginForm from "@/components/portal/PortalLoginForm";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Portal Login — Naman Sharma IAS Academy",
  robots: { index: false, follow: false },
};

export default function PortalLoginPage() {
  return (
    <div className="container-wide section">
      <div className="mx-auto max-w-md text-center">
        <p className="pill pill-blue mb-3">Your Portal</p>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Access what you purchased</h1>
        <p className="mt-2 text-ink2">Log in with your mobile number and the login code from your payment receipt.</p>
      </div>
      <div className="mt-8">
        <PortalLoginForm />
      </div>
    </div>
  );
}
