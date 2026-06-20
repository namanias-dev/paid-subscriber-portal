"use client";

import { PageHeader, useAdminData, LoadingBlock } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import type { Webinar, Course } from "@/lib/types";

export default function RegistrationsAdmin() {
  const { data: webinars, loading: lw } = useAdminData<Webinar[]>("/api/admin/webinars", "webinars");
  const { data: courses, loading: lc } = useAdminData<Course[]>("/api/admin/courses", "courses");
  const { toast } = useToast();

  function copy(path: string) {
    navigator.clipboard.writeText(`${window.location.origin}${path}`);
    toast("Link copied", "success");
  }

  if (lw || lc) return <LoadingBlock />;

  const pages = [
    ...(webinars || []).map((w) => ({ title: w.title, type: "Webinar", path: `/webinars/${w.slug}`, sub: `${w.registrations} registered` })),
    ...(courses || []).filter((c) => c.status === "published").map((c) => ({ title: c.title, type: "Course Launch", path: `/courses/${c.slug}`, sub: c.category })),
    { title: "Free Counselling", type: "Lead Page", path: `/demo`, sub: "Counselling funnel" },
    { title: "1-Week Demo", type: "Lead Page", path: `/demo`, sub: "Demo funnel" },
  ];

  return (
    <div>
      <PageHeader title="Landing Pages" subtitle="Auto-generated public pages — copy & share, registrants flow into CRM" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pages.map((p, i) => (
          <div key={i} className="card p-5">
            <span className="pill pill-blue">{p.type}</span>
            <h3 className="mt-3 text-base leading-snug">{p.title}</h3>
            <p className="mt-1 text-xs text-muted">{p.sub}</p>
            <p className="mt-2 truncate text-xs text-primary">{p.path}</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => copy(p.path)} className="btn btn-secondary flex-1 text-xs">Copy link</button>
              <a href={p.path} target="_blank" rel="noopener noreferrer" className="btn btn-ghost text-xs">Open ↗</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
