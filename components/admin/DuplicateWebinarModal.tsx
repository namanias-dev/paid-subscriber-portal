"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";

/**
 * FEATURE 2 — Duplicate Webinar modal. All content/media is copied by reference
 * server-side (no R2 binaries duplicated); admin only sets the new schedule,
 * slug, publish state, and a few choices. Times are entered as IST wall-clock.
 */
export default function DuplicateWebinarModal({
  webinar,
  onClose,
  onDone,
}: {
  webinar: { id: string; title: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [datetime, setDatetime] = useState("");
  const [endDatetime, setEndDatetime] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "LIVE">("DRAFT");
  const [copyZoomLink, setCopyZoomLink] = useState(false);
  const [markOldEnded, setMarkOldEnded] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!datetime) {
      setError("Pick a new date & time (IST).");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/webinars/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: webinar.id,
          datetime,
          end_datetime: endDatetime || undefined,
          slug: slug.trim() || undefined,
          status,
          copyZoomLink,
          markOldEnded,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Could not duplicate.");
        setSaving(false);
        return;
      }
      toast(`Duplicated as “${data.webinar?.title}” (${status === "LIVE" ? "Live" : "Draft"})`, "success");
      onDone();
    } catch {
      setError("Something went wrong.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Duplicate webinar</h2>
        <p className="mt-1 text-sm text-muted">
          Copies all content, media, price &amp; settings from <b>{webinar.title}</b> — no files are re-uploaded. Set the new
          session details below.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-ink2">New date &amp; time (IST) *</span>
            <input type="datetime-local" className="input mt-1" value={datetime} onChange={(e) => setDatetime(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink2">End time (IST, optional)</span>
            <input type="datetime-local" className="input mt-1" value={endDatetime} onChange={(e) => setEndDatetime(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink2">Slug (optional — auto-generated if blank)</span>
            <input className="input mt-1" placeholder="auto: title-ddmmyyyy" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink2">Publish state</span>
            <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value as "DRAFT" | "LIVE")}>
              <option value="DRAFT">Draft (hidden — finish editing first)</option>
              <option value="LIVE">Live (public &amp; accepting registrations)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={copyZoomLink} onChange={(e) => setCopyZoomLink(e.target.checked)} />
            Copy the Zoom / joining link
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={markOldEnded} onChange={(e) => setMarkOldEnded(e.target.checked)} />
            Mark the original as ended (stops new payments) &amp; link it to this one
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary text-sm" disabled={saving}>Cancel</button>
          <button onClick={submit} className="btn btn-primary text-sm" disabled={saving}>
            {saving ? "Duplicating…" : "Duplicate webinar"}
          </button>
        </div>
      </div>
    </div>
  );
}
