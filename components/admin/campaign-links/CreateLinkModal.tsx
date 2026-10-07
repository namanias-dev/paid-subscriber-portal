"use client";

import { useEffect, useMemo, useState } from "react";
import { X, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import {
  composeRedirectUrl,
  normalizeShortCode,
  CAMPAIGN_SITE_URL,
} from "@/lib/marketing/campaignLink";
import type { CampaignLink, DestinationType } from "@/lib/marketing/campaignLinks";
import CopyButton from "./CopyButton";
import QrCode from "./QrCode";

interface Preset {
  id: string;
  label: string;
  source: string;
  medium: string;
  platform: string;
}
const PRESETS: Preset[] = [
  { id: "meta", label: "Meta Ad", source: "meta", medium: "paid_social", platform: "instagram" },
  { id: "ig_reel", label: "Instagram Reel", source: "instagram", medium: "organic_social", platform: "instagram" },
  { id: "ig_post", label: "Instagram Post", source: "instagram", medium: "organic_social", platform: "instagram" },
  { id: "ig_story", label: "Instagram Story", source: "instagram", medium: "organic_social", platform: "instagram" },
  { id: "facebook", label: "Facebook Ad", source: "facebook", medium: "paid_social", platform: "facebook" },
  { id: "google", label: "Google Ad", source: "google", medium: "cpc", platform: "google_search" },
  { id: "youtube", label: "YouTube", source: "youtube", medium: "video", platform: "youtube" },
  { id: "telegram", label: "Telegram", source: "telegram", medium: "social", platform: "telegram" },
  { id: "whatsapp", label: "WhatsApp", source: "whatsapp", medium: "direct_message", platform: "whatsapp" },
  { id: "email", label: "Email", source: "email", medium: "email", platform: "email" },
  { id: "influencer", label: "Influencer", source: "influencer", medium: "referral", platform: "other" },
];

interface DestOption { id: string; title: string; path: string }

const inputCls =
  "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none";
const labelCls = "text-xs font-medium text-muted";

export default function CreateLinkModal({ onClose, onCreated }: { onClose: () => void; onCreated: (l: CampaignLink) => void }) {
  const [destType, setDestType] = useState<DestinationType>("webinar");
  const [destId, setDestId] = useState<string>("");
  const [destUrl, setDestUrl] = useState<string>("");
  const [name, setName] = useState("");
  const [source, setSource] = useState("meta");
  const [medium, setMedium] = useState("paid_social");
  const [platform, setPlatform] = useState("instagram");
  const [campaign, setCampaign] = useState("");
  const [adset, setAdset] = useState("");
  const [ad, setAd] = useState("");
  const [creative, setCreative] = useState("");
  const [content, setContent] = useState("");
  const [term, setTerm] = useState("");
  const [placement, setPlacement] = useState("");
  const [campaignIdExt, setCampaignIdExt] = useState("");
  const [adsetIdExt, setAdsetIdExt] = useState("");
  const [adIdExt, setAdIdExt] = useState("");
  const [alias, setAlias] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showIds, setShowIds] = useState(false);

  const [webinars, setWebinars] = useState<DestOption[]>([]);
  const [courses, setCourses] = useState<DestOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CampaignLink | null>(null);

  useEffect(() => {
    fetch("/api/admin/campaign-links/destinations")
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setWebinars(d.webinars || []); setCourses(d.courses || []); } })
      .catch(() => {});
  }, []);

  // Resolve the clean destination path from the chosen type.
  const destination = useMemo(() => {
    if (destType === "webinar" || destType === "course") {
      const list = destType === "webinar" ? webinars : courses;
      return list.find((o) => o.id === destId)?.path || "";
    }
    if (destType === "notes") return destUrl || "/notes";
    return destUrl;
  }, [destType, destId, destUrl, webinars, courses]);

  const preview = useMemo(
    () =>
      composeRedirectUrl({
        destination: destination || "/",
        utm: { source, medium, campaign, content: content || creative, term },
        clid: normalizeShortCode(alias) || "auto",
      }),
    [destination, source, medium, campaign, content, creative, term, alias],
  );

  const shortPreview = `${CAMPAIGN_SITE_URL}/go/${normalizeShortCode(alias) || "auto-generated"}`;

  const applyPreset = (p: Preset) => {
    setSource(p.source);
    setMedium(p.medium);
    setPlatform(p.platform);
    const advanced = p.id === "meta" || p.id === "facebook" || p.id === "google";
    setShowAdvanced(advanced);
  };

  async function submit() {
    setError(null);
    if (!name.trim()) { setError("Give the link a name you'll recognise later."); return; }
    if (!destination) { setError("Choose or enter a destination."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/campaign-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, destination_url: destination, destination_type: destType, destination_id: destId || null,
          source, medium, platform, campaign, adset_name: adset, ad_name: ad, creative_name: creative,
          content: content || creative, term, placement,
          campaign_id_external: campaignIdExt, adset_id_external: adsetIdExt, ad_id_external: adIdExt,
          customAlias: alias || null,
        }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error || "Could not create link."); setSaving(false); return; }
      setCreated(d.link);
      onCreated(d.link);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const shortUrl = created ? `${CAMPAIGN_SITE_URL}/go/${created.short_code}` : "";

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onClick={onClose}>
      <div className="card my-4 w-full max-w-2xl p-0" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface p-4">
          <h2 className="font-heading text-lg font-bold">{created ? "Link ready" : "Create campaign link"}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
        </div>

        {created ? (
          <div className="space-y-4 p-4">
            <div className="rounded-2xl border border-line bg-surface2 p-4">
              <p className={labelCls}>Paste this into your ad / post</p>
              <p className="mt-1 break-all font-mono text-sm font-semibold text-ink">{shortUrl}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <CopyButton value={shortUrl} />
                <a href={shortUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink hover:bg-surface2">
                  <ExternalLink size={15} /> Open
                </a>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-start sm:gap-4">
              <QrCode value={shortUrl} />
              <dl className="grid flex-1 grid-cols-2 gap-2 text-sm">
                <div><dt className={labelCls}>Destination</dt><dd className="font-medium text-ink">{created.name}</dd></div>
                <div><dt className={labelCls}>Source</dt><dd className="font-medium capitalize text-ink">{created.source || "—"} / {created.platform || "—"}</dd></div>
                <div><dt className={labelCls}>Campaign</dt><dd className="font-medium text-ink">{created.campaign || "—"}</dd></div>
                <div><dt className={labelCls}>Creative</dt><dd className="font-medium text-ink">{created.creative_name || created.content || "—"}</dd></div>
              </dl>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setCreated(null); setName(""); setAlias(""); }} className="min-h-11 rounded-full border border-line px-4 text-sm font-semibold text-ink hover:bg-surface2">Create another</button>
              <button onClick={onClose} className="min-h-11 rounded-full bg-primary px-4 text-sm font-semibold text-white">Done</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            {/* Destination */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelCls}>Destination type
                <select className={inputCls} value={destType} onChange={(e) => { setDestType(e.target.value as DestinationType); setDestId(""); setDestUrl(""); }}>
                  <option value="webinar">Webinar</option>
                  <option value="course">Course</option>
                  <option value="notes">Notes Store</option>
                  <option value="demo">Demo / Class</option>
                  <option value="landing">Landing page</option>
                  <option value="custom">Custom URL</option>
                </select>
              </label>
              {destType === "webinar" || destType === "course" ? (
                <label className={labelCls}>Choose {destType}
                  <select className={inputCls} value={destId} onChange={(e) => setDestId(e.target.value)}>
                    <option value="">Select…</option>
                    {(destType === "webinar" ? webinars : courses).map((o) => (
                      <option key={o.id} value={o.id}>{o.title}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className={labelCls}>Destination path or URL
                  <input className={inputCls} value={destUrl} onChange={(e) => setDestUrl(e.target.value)} placeholder={destType === "notes" ? "/notes" : "/webinars/... or https://www.namanias.com/..."} />
                </label>
              )}
            </div>

            <label className={`block ${labelCls}`}>Link name <span className="text-danger">*</span>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Meta — October Webinar — Reel 1" />
            </label>

            {/* Presets */}
            <div>
              <p className={labelCls}>Quick preset</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" onClick={() => applyPreset(p)}
                    className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition ${source === p.source && medium === p.medium && platform === p.platform ? "border-primary bg-primary text-white" : "border-line bg-white text-ink hover:bg-surface2"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Core attribution */}
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={labelCls}>Source<input className={inputCls} value={source} onChange={(e) => setSource(e.target.value)} /></label>
              <label className={labelCls}>Medium<input className={inputCls} value={medium} onChange={(e) => setMedium(e.target.value)} /></label>
              <label className={labelCls}>Platform<input className={inputCls} value={platform} onChange={(e) => setPlatform(e.target.value)} /></label>
              <label className={`sm:col-span-3 ${labelCls}`}>Campaign<input className={inputCls} value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="upsc_oct_webinar" /></label>
            </div>

            {/* Advanced (creative hierarchy) */}
            <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
              {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Ad / creative details
            </button>
            {showAdvanced && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelCls}>Ad set name<input className={inputCls} value={adset} onChange={(e) => setAdset(e.target.value)} placeholder="beginners_2028" /></label>
                <label className={labelCls}>Ad name<input className={inputCls} value={ad} onChange={(e) => setAd(e.target.value)} placeholder="naman_reel_v3" /></label>
                <label className={labelCls}>Creative / content<input className={inputCls} value={creative} onChange={(e) => setCreative(e.target.value)} placeholder="ai_notes_hook" /></label>
                <label className={labelCls}>Placement<input className={inputCls} value={placement} onChange={(e) => setPlacement(e.target.value)} placeholder="feed / story / reels" /></label>
                <label className={labelCls}>Content (utm_content)<input className={inputCls} value={content} onChange={(e) => setContent(e.target.value)} placeholder="defaults to creative" /></label>
                <label className={labelCls}>Term (utm_term)<input className={inputCls} value={term} onChange={(e) => setTerm(e.target.value)} /></label>
              </div>
            )}

            {/* External IDs */}
            <button type="button" onClick={() => setShowIds((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
              {showIds ? <ChevronUp size={14} /> : <ChevronDown size={14} />} External platform IDs (optional)
            </button>
            {showIds && (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className={labelCls}>Meta campaign ID<input className={inputCls} value={campaignIdExt} onChange={(e) => setCampaignIdExt(e.target.value)} /></label>
                <label className={labelCls}>Meta ad set ID<input className={inputCls} value={adsetIdExt} onChange={(e) => setAdsetIdExt(e.target.value)} /></label>
                <label className={labelCls}>Meta ad ID<input className={inputCls} value={adIdExt} onChange={(e) => setAdIdExt(e.target.value)} /></label>
              </div>
            )}

            {/* Alias + preview */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelCls}>Custom alias (optional)
                <div className="mt-1 flex items-center rounded-xl border border-line bg-white px-3">
                  <span className="text-sm text-muted">/go/</span>
                  <input className="min-h-11 w-full bg-transparent px-1 text-sm text-ink focus:outline-none" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="officer-oct10" />
                </div>
              </label>
              <div className={labelCls}>Branded short link
                <p className="mt-1 break-all rounded-xl bg-surface2 px-3 py-2.5 font-mono text-xs text-ink">{shortPreview}</p>
              </div>
            </div>
            <div className={labelCls}>Redirects to
              <p className="mt-1 break-all rounded-xl bg-surface2 px-3 py-2 font-mono text-xs text-ink">{preview || "Choose a destination"}</p>
            </div>

            {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

            <div className="flex justify-end gap-2 pb-1">
              <button onClick={onClose} className="min-h-11 rounded-full border border-line px-4 text-sm font-semibold text-ink hover:bg-surface2">Cancel</button>
              <button onClick={submit} disabled={saving} className="min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? "Creating…" : "Generate link"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
