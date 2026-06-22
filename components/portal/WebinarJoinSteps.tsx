"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

type Phase = "upcoming" | "live" | "ended";
type Device = "ios" | "android" | "desktop";

interface Props {
  sessionType: "live" | "recorded";
  startISO: string | null;
  endISO: string | null;
  hasZoomLink: boolean;
  joinNote?: string | null;
  waLink: string | null;
}

const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000;

const ZOOM_LINKS = {
  ios: "https://apps.apple.com/app/zoom-workplace/id546505307",
  android: "https://play.google.com/store/apps/details?id=us.zoom.videomeetings",
  desktop: "https://zoom.us/download",
};

function computePhase(now: number, start: number | null, end: number | null, sessionType: string): Phase {
  if (sessionType === "recorded") return "ended";
  if (start === null) return "live";
  if (now < start) return "upcoming";
  if (end !== null && now > end) return "ended";
  return "live";
}

function detectDevice(): Device {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

/** Official-style Zoom mark (blue rounded square + white video camera). */
function ZoomMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${className}`} style={{ background: "#2D8CFF" }} aria-hidden>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
        <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h7A2.5 2.5 0 0 1 15 8.5v7A2.5 2.5 0 0 1 12.5 18h-7A2.5 2.5 0 0 1 3 15.5v-7Z" fill="#fff" />
        <path d="M16 10.2l3.4-2.2c.5-.32 1.1.04 1.1.62v6.76c0 .58-.6.94-1.1.62L16 13.8v-3.6Z" fill="#fff" />
      </svg>
    </span>
  );
}

function StoreButton({
  device,
  label,
  sub,
  href,
  highlight,
}: {
  device: Device;
  label: string;
  sub: string;
  href: string;
  highlight: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
        highlight ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-line hover:border-primary/50"
      }`}
    >
      <span className="text-lg">{device === "ios" ? "🍎" : device === "android" ? "🤖" : "💻"}</span>
      <span className="leading-tight">
        <span className="block text-[10px] uppercase tracking-wide text-muted">{sub}</span>
        <span className="block text-sm font-semibold">{label}</span>
      </span>
      {highlight && <span className="ml-auto pill pill-blue text-[10px]">For you</span>}
    </a>
  );
}

export default function WebinarJoinSteps({ sessionType, startISO, endISO, hasZoomLink, joinNote, waLink }: Props) {
  const reduce = useReducedMotion();
  const start = startISO ? new Date(startISO).getTime() : null;
  const end = endISO ? new Date(endISO).getTime() : start !== null ? start + DEFAULT_DURATION_MS : null;

  const [now, setNow] = useState<number>(() => Date.now());
  const [device, setDevice] = useState<Device>("desktop");
  useEffect(() => {
    setDevice(detectDevice());
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  const phase = computePhase(now, start, end, sessionType);

  const fade = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-40px" },
          transition: { duration: 0.4, delay: i * 0.08 },
        };

  const NoteAndHelp = (
    <>
      {joinNote?.trim() && (
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span aria-hidden>📌</span>
          <span>{joinNote.trim()}</span>
        </div>
      )}
      {waLink && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-sm text-ink2">
            <span className="font-semibold">Still can&apos;t join?</span> We&apos;re here to help.
          </p>
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 0 1 8.413 3.488 11.82 11.82 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.51 5.26l-.999 3.648 3.978-1.045zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
            </svg>
            WhatsApp us
          </a>
        </div>
      )}
    </>
  );

  // Recorded / ended → no Zoom app needed.
  if (sessionType === "recorded" || phase === "ended") {
    return (
      <section className="mt-6 rounded-2xl border border-line p-5">
        <h2 className="text-lg font-bold">How to watch</h2>
        <div className="mt-3 flex items-start gap-3 rounded-xl bg-surface p-4">
          <span className="text-2xl" aria-hidden>▶️</span>
          <p className="text-sm text-ink2">
            <span className="font-semibold text-ink">No app needed.</span> Just click <b>Watch Recording</b> above — it plays right
            here in your browser, on phone or laptop.
          </p>
        </div>
        {NoteAndHelp}
      </section>
    );
  }

  const isLive = phase === "live";

  const steps = [
    {
      icon: <ZoomMark />,
      title: "Download Zoom",
      body: (
        <>
          <p className="text-sm text-ink2">Get the free Zoom app on your phone or laptop. It only takes a minute.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <StoreButton device="ios" sub="iPhone / iPad" label="App Store" href={ZOOM_LINKS.ios} highlight={device === "ios"} />
            <StoreButton device="android" sub="Android" label="Google Play" href={ZOOM_LINKS.android} highlight={device === "android"} />
            <StoreButton device="desktop" sub="Windows / Mac" label="Desktop app" href={ZOOM_LINKS.desktop} highlight={device === "desktop"} />
          </div>
        </>
      ),
    },
    {
      icon: <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-lg">👤</span>,
      title: "Open & sign in",
      body: (
        <p className="text-sm text-ink2">
          Open Zoom and sign in, or just continue as a guest. <b>A free account is enough</b> — no payment needed.
        </p>
      ),
    },
    {
      icon: <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-lg">👆</span>,
      title: isLive ? "Click ‘Attend Live Class’ now" : "Tap ‘Attend Live Class’",
      body: (
        <p className="text-sm text-ink2">
          {isLive ? (
            <>It&apos;s live! Tap the <b>Attend Live Class</b> button above — your webinar opens automatically in Zoom.</>
          ) : (
            <>When it&apos;s time, tap the <b>Attend Live Class</b> button above — the webinar opens automatically in Zoom.</>
          )}
        </p>
      ),
      emphasize: isLive,
    },
  ];

  return (
    <section className="mt-6 rounded-2xl border border-line p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">How to join this webinar</h2>
        {isLive ? (
          <span className="pill pill-blue text-xs">Live now</span>
        ) : (
          <span className="text-xs text-muted">Takes ~2 minutes to set up</span>
        )}
      </div>
      {!hasZoomLink && !isLive && (
        <p className="mt-1 text-xs text-muted">The join button will appear above before the session starts.</p>
      )}

      <ol className="mt-5 space-y-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:space-y-0">
        {steps.map((s, i) => (
          <motion.li
            key={i}
            {...fade(i)}
            className={`relative rounded-2xl border p-4 ${
              s.emphasize ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-line bg-white"
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  s.emphasize ? "bg-primary text-white" : "bg-ink text-white"
                } ${s.emphasize && !reduce ? "animate-pulse" : ""}`}
              >
                {i + 1}
              </span>
              {s.icon}
              <h3 className="text-sm font-bold leading-tight">{s.title}</h3>
            </div>
            <div className="mt-3">{s.body}</div>
          </motion.li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>💡 Join 5 minutes early</span>
        <span>🎧 Use headphones for the best audio</span>
        <span>🔇 Keep your mic muted</span>
      </div>

      {NoteAndHelp}
    </section>
  );
}
