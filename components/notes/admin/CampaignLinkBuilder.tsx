"use client";

import { useMemo, useState } from "react";
import { CAMPAIGN_TEMPLATES, buildNotesCampaignUrl } from "@/lib/analytics/notesCommerce";

export default function CampaignLinkBuilder() {
  const [destination, setDestination] = useState<"store" | "polity" | "economy">("store");
  const [source, setSource] = useState("instagram");
  const [medium, setMedium] = useState("story");
  const [campaign, setCampaign] = useState("notes_launch");
  const [content, setContent] = useState("polity_story_01");
  const [copied, setCopied] = useState(false);
  const url = useMemo(
    () => buildNotesCampaignUrl({ destination, source, medium, campaign, content }),
    [destination, source, medium, campaign, content],
  );

  return (
    <section className="rounded-2xl bg-white p-4">
      <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Campaign links</h2>
      <p className="mt-1 text-sm text-[var(--ca-navy)]/60">These URLs keep source, medium, campaign and content after the visitor leaves the first page.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {CAMPAIGN_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className="min-h-10 rounded-full border border-[var(--ca-navy)]/10 px-3 text-sm font-semibold text-[var(--ca-navy)]"
            onClick={() => {
              setDestination(template.destination);
              setSource(template.source);
              setMedium(template.medium);
              setContent(template.content);
            }}
          >
            {template.label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-sm text-[var(--ca-navy)]">Destination
          <select className="mt-1 min-h-11 w-full rounded-xl border px-3" value={destination} onChange={(e) => setDestination(e.target.value as "store" | "polity" | "economy")}>
            <option value="store">Notes Store</option>
            <option value="polity">Polity</option>
            <option value="economy">Economy</option>
          </select>
        </label>
        <label className="text-sm text-[var(--ca-navy)]">Source
          <input className="mt-1 min-h-11 w-full rounded-xl border px-3" value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label className="text-sm text-[var(--ca-navy)]">Medium
          <input className="mt-1 min-h-11 w-full rounded-xl border px-3" value={medium} onChange={(e) => setMedium(e.target.value)} />
        </label>
        <label className="text-sm text-[var(--ca-navy)]">Campaign
          <input className="mt-1 min-h-11 w-full rounded-xl border px-3" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
        </label>
        <label className="text-sm text-[var(--ca-navy)] sm:col-span-2">Content
          <input className="mt-1 min-h-11 w-full rounded-xl border px-3" value={content} onChange={(e) => setContent(e.target.value)} placeholder="reel_polity_01" />
        </label>
      </div>
      <p className="mt-3 break-all rounded-xl bg-[#f7f5ef] px-3 py-2 font-mono text-xs text-[var(--ca-navy)]">{url}</p>
      <button
        type="button"
        className="mt-3 min-h-11 rounded-full bg-[var(--ca-navy)] px-4 text-sm font-semibold text-white"
        onClick={() => {
          void navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </section>
  );
}
