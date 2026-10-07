"use client";

import { useMemo, useState } from "react";
import { SectionCard } from "./Shared";
import {
  buildCampaignUrl,
  CHANNEL_PRESETS,
  DESTINATION_PRESETS,
  type ChannelPreset,
} from "@/lib/marketing/campaignLink";

/**
 * General-purpose UTM link generator. Prefills from a channel preset, lets the
 * marketer name the exact content piece (reel / story / post), and produces a
 * clean trackable URL the site's first-party attribution already understands.
 */
export default function CampaignLinkStudio() {
  const [destination, setDestination] = useState("/webinar");
  const [source, setSource] = useState("instagram");
  const [medium, setMedium] = useState("reel");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [term, setTerm] = useState("");
  const [contentHint, setContentHint] = useState("ai_notes_risk_reel");
  const [copied, setCopied] = useState(false);

  const { url, warnings } = useMemo(
    () => buildCampaignUrl({ destination, source, medium, campaign, content, term }),
    [destination, source, medium, campaign, content, term],
  );

  const applyPreset = (p: ChannelPreset) => {
    setSource(p.source);
    setMedium(p.medium);
    setContentHint(p.contentHint);
  };

  const inputCls =
    "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none";

  return (
    <SectionCard title="Campaign link generator">
      <p className="mb-3 text-xs text-muted">
        Give every Instagram reel, post, story and channel its <strong>own</strong> link so you can
        finally see which exact piece drives registrations, admissions and orders. Pick a channel,
        name the content, copy the link into your bio / caption / DM.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {CHANNEL_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p)}
            className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition ${
              source === p.source && medium === p.medium
                ? "border-primary bg-primary text-white"
                : "border-line bg-white text-ink hover:bg-surface2"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-muted">
          Destination
          <input
            className={inputCls}
            list="link-destinations"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="/webinar/my-webinar-slug"
          />
          <datalist id="link-destinations">
            {DESTINATION_PRESETS.map((d) => (
              <option key={d.id} value={d.path}>
                {d.label}
              </option>
            ))}
          </datalist>
        </label>
        <label className="text-xs font-medium text-muted">
          Campaign <span className="text-danger">*</span>
          <input
            className={inputCls}
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            placeholder="ai_notes_launch"
          />
        </label>
        <label className="text-xs font-medium text-muted">
          Source <span className="text-danger">*</span>
          <input className={inputCls} value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-muted">
          Medium <span className="text-danger">*</span>
          <input className={inputCls} value={medium} onChange={(e) => setMedium(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-muted">
          Content (the exact reel / post / story)
          <input
            className={inputCls}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={contentHint}
          />
        </label>
        <label className="text-xs font-medium text-muted">
          Term (optional)
          <input className={inputCls} value={term} onChange={(e) => setTerm(e.target.value)} />
        </label>
      </div>

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {warnings.map((w) => (
            <li key={w} className="text-xs text-warning">
              • {w}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 break-all rounded-xl bg-surface2 px-3 py-2 font-mono text-xs text-ink">
        {url || "Fill in the required fields to generate a link."}
      </div>

      <button
        type="button"
        disabled={!url}
        className="mt-3 min-h-11 rounded-full bg-primary px-4 text-sm font-semibold text-white disabled:opacity-40"
        onClick={() => {
          if (!url) return;
          void navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </SectionCard>
  );
}
