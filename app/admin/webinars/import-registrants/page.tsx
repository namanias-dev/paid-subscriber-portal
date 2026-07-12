"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader, useAdminData, LoadingBlock } from "@/components/admin/ui";

interface WebinarLite {
  id: string;
  title: string;
  registrations?: number;
}
interface WebinarsResponse {
  ok: boolean;
  webinars: WebinarLite[];
}

interface Sample {
  name: string;
  phoneMasked: string;
  attended: boolean;
  willLink: boolean;
}
interface ImportResult {
  ok: boolean;
  mode?: "dry-run" | "apply";
  error?: string;
  totalParsed?: number;
  invalid?: number;
  duplicateInFile?: number;
  duplicateExisting?: number;
  newRows?: number;
  wouldLinkToEnrollment?: number;
  inserted?: number;
  sample?: Sample[];
}

export default function ImportRegistrantsPage() {
  const { data, loading } = useAdminData<WebinarsResponse>("/api/admin/webinars", "webinars-for-import");
  const [webinarId, setWebinarId] = useState("");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [applied, setApplied] = useState(false);

  const run = async (apply: boolean) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/admin/webinars/registrants-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webinarId, csv, apply }),
      });
      const j = (await r.json()) as ImportResult;
      setResult(j);
      if (apply && j.ok) setApplied(true);
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const onFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ""));
    reader.readAsText(f);
  };

  if (loading) return <LoadingBlock />;

  const webinars = data?.webinars || [];

  return (
    <div>
      <PageHeader
        title="Import historical registrants"
        subtitle="Recover aggregate-only webinar registrants from an original export (Zoom / Google Forms). Additive & insert-only — never duplicates existing rows. Preview first, then confirm."
        action={<Link href="/admin/webinars" className="btn btn-secondary text-sm">← Webinars</Link>}
      />

      <div className="card space-y-4 p-5">
        <div>
          <label className="mb-1 block text-sm font-semibold">Webinar</label>
          <select
            className="input w-full"
            value={webinarId}
            onChange={(e) => { setWebinarId(e.target.value); setResult(null); setApplied(false); }}
          >
            <option value="">Select a webinar…</option>
            {webinars.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title} {typeof w.registrations === "number" ? `(counter: ${w.registrations})` : ""} — {w.id}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">CSV</label>
          <p className="mb-2 text-xs text-muted">
            Header row required. Recognised columns: <code>name</code>, <code>phone</code> (10-digit), optional <code>email</code>, <code>attended</code> (yes/no). Extra columns are ignored.
          </p>
          <input type="file" accept=".csv,text/csv" className="mb-2 block text-sm" onChange={(e) => onFile(e.target.files?.[0] || null)} />
          <textarea
            className="input h-40 w-full font-mono text-xs"
            placeholder={"name,phone,attended\nRahul Kumar,9876543210,yes\n..."}
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setResult(null); setApplied(false); }}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary text-sm" disabled={busy || !webinarId || !csv.trim()} onClick={() => run(false)}>
            {busy ? "Working…" : "Preview (dry-run)"}
          </button>
          <button
            className="btn btn-primary text-sm"
            disabled={busy || !result?.ok || result?.mode !== "dry-run" || !result?.newRows || applied}
            onClick={() => run(true)}
          >
            {applied ? "Imported ✓" : `Confirm import${result?.newRows ? ` (${result.newRows} rows)` : ""}`}
          </button>
        </div>

        {result && !result.ok ? <p className="text-sm text-danger">Error: {result.error}</p> : null}

        {result && result.ok ? (
          <div className="rounded-lg border border-line bg-surface2 p-4 text-sm">
            <p className="mb-2 font-semibold">
              {result.mode === "apply" ? `Imported ${result.inserted} new registrant row(s).` : "Dry-run preview (nothing written yet)"}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div>Parsed rows: <b>{result.totalParsed}</b></div>
              <div>New rows: <b>{result.newRows}</b></div>
              <div>Would link to enrollment: <b>{result.wouldLinkToEnrollment}</b></div>
              <div>Duplicate (already present): <b>{result.duplicateExisting}</b></div>
              <div>Duplicate (in file): <b>{result.duplicateInFile}</b></div>
              <div>Invalid (bad name/phone): <b>{result.invalid}</b></div>
            </div>
            {result.sample && result.sample.length > 0 ? (
              <div className="mt-3">
                <p className="mb-1 text-xs text-muted">Sample of new rows:</p>
                <ul className="space-y-1 text-xs">
                  {result.sample.map((s, i) => (
                    <li key={i}>{s.name} · {s.phoneMasked} · {s.attended ? "attended" : "no-show"} {s.willLink ? "· will link ✓" : ""}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
