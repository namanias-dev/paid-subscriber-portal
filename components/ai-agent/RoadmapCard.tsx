"use client";

/** A structured, step-by-step roadmap / checklist card rendered in the chat. */
import type { RoadmapCardData } from "@/lib/ai-agent/providers/types";

export default function RoadmapCard({ data }: { data: RoadmapCardData }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <h4 className="font-heading text-sm font-bold text-ink">{data.title}</h4>
      {data.subtitle && <p className="mt-0.5 text-xs text-ink2">{data.subtitle}</p>}
      <ol className="mt-3 space-y-2.5">
        {data.steps.map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
              style={{ background: "var(--primary-tint)", color: "var(--primary)" }}
            >
              {i + 1}
            </span>
            <div>
              <p className="text-xs font-semibold text-ink">{s.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink2">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
