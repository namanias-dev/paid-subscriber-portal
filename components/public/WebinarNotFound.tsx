"use client";

import NotFoundTracker from "@/components/analytics/NotFoundTracker";

/** Soft webinar-not-found UI with recovery links + GA event. */
export default function WebinarNotFound({ reason = "webinar_not_found" }: { reason?: string }) {
  return (
    <div className="container-wide py-16 text-center">
      <NotFoundTracker reason={reason} />
      <h1 className="font-heading text-2xl font-bold">Webinar not found</h1>
      <p className="mt-2 text-sm text-[var(--ca-slate-700)]">
        This session may have ended or the link is outdated. Join an upcoming masterclass instead.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <a href="/webinars" className="btn btn-primary inline-flex">
          Upcoming webinars
        </a>
        <a href="/courses" className="btn btn-secondary inline-flex">
          Browse courses
        </a>
      </div>
    </div>
  );
}
