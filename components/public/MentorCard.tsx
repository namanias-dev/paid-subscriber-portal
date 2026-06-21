import Image from "next/image";
import RichContent from "./RichContent";
import type { LandingMentor } from "@/lib/landingView";

export default function MentorCard({ mentor, title = "Meet your mentor" }: { mentor?: LandingMentor | null; title?: string }) {
  if (!mentor) return null;
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-extrabold">{title}</h2>
      <div className="card mt-4 flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        {mentor.image_url && (
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-surface2">
            <Image src={mentor.image_url} alt={mentor.name || "Mentor"} fill sizes="96px" className="object-cover" />
          </div>
        )}
        <div className="min-w-0">
          {mentor.name && <p className="font-heading text-lg font-bold text-ink">{mentor.name}</p>}
          {mentor.credentials && <p className="text-sm font-medium text-primary">{mentor.credentials}</p>}
          {mentor.bioHtml && <RichContent html={mentor.bioHtml} className="mt-2 text-sm" />}
        </div>
      </div>
    </section>
  );
}
