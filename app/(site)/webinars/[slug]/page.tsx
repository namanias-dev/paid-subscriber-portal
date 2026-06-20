import { notFound } from "next/navigation";
import Countdown from "@/components/public/Countdown";
import WebinarRegister from "@/components/public/WebinarRegister";
import { getWebinarBySlug } from "@/lib/dataProvider";
import { formatINR } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function WebinarDetail({ params }: { params: { slug: string } }) {
  const w = await getWebinarBySlug(params.slug);
  if (!w) notFound();

  const completed = w.status === "completed";

  return (
    <div className="container-wide section">
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2">
            <span className={`pill ${completed ? "pill-gray" : "pill-green"}`}>{completed ? "Recording" : "Upcoming"}</span>
            <span className="pill pill-blue">{w.price === 0 ? "Free" : formatINR(w.price)}</span>
          </div>
          <h1 className="mt-4 text-3xl font-extrabold sm:text-4xl">{w.title}</h1>
          <p className="mt-3 text-ink2">{w.description}</p>
          <p className="mt-4 text-sm text-muted">
            🗓 {new Date(w.datetime).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}
          </p>
          <p className="mt-1 text-sm text-muted">👥 {w.registrations.toLocaleString("en-IN")} registered</p>

          {!completed && (
            <div className="mt-6">
              <p className="mb-2 text-sm font-medium text-ink2">Starts in</p>
              <Countdown to={w.datetime} />
            </div>
          )}

          {completed && w.recording_link && (
            <a href={w.recording_link} target="_blank" rel="noopener noreferrer" className="btn btn-primary mt-6">
              ▶ Watch Recording
            </a>
          )}
        </div>

        <div>
          <div className="card p-6 lg:sticky lg:top-24">
            <h3 className="text-lg">{completed ? "Watch the recording" : "Reserve your spot"}</h3>
            <p className="mt-1 text-sm text-ink2">{completed ? "Register to get the recording link." : "Free registration — limited seats."}</p>
            <div className="mt-4">
              <WebinarRegister webinarId={w.id} webinarSlug={w.slug} price={w.price} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
