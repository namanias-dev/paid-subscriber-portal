import Link from "next/link";
import NotFoundTracker from "@/components/analytics/NotFoundTracker";

export default function NotFound() {
  return (
    <div className="container-wide py-16 text-center">
      <NotFoundTracker reason="app_not_found" />
      <h1 className="font-heading text-3xl font-bold">Page not found</h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-[var(--ca-slate-700)]">
        This link may be outdated. Browse upcoming webinars or courses instead.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/webinars" className="btn btn-primary">
          Upcoming webinars
        </Link>
        <Link href="/courses" className="btn btn-secondary">
          Browse courses
        </Link>
        <Link href="/" className="btn btn-ghost">
          Home
        </Link>
      </div>
    </div>
  );
}
