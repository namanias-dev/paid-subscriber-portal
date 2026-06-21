"use client";

import { useRef, useState } from "react";
import { PageHeader, useAdminData, TableShell } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import type { ImportJob } from "@/lib/types";

interface PreviewRow { index: number; question_html: string; correct_option: string; valid: boolean; duplicate: boolean; error?: string }
interface PreviewState { rows: PreviewRow[]; summary: { total: number; valid: number; invalid: number; duplicates: number } }

function strip(html: string) { return (html || "").replace(/<[^>]*>/g, " ").trim(); }

function PreviewTable({ preview }: { preview: PreviewState }) {
  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        <span className="pill pill-gray">Total {preview.summary.total}</span>
        <span className="pill pill-green">Valid {preview.summary.valid}</span>
        <span className="pill pill-amber">Duplicates {preview.summary.duplicates}</span>
        <span className="pill pill-red">Invalid {preview.summary.invalid}</span>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
        {preview.rows.map((r) => (
          <div key={r.index} className="flex items-start gap-2 border-b border-line px-3 py-2 text-xs last:border-0">
            <span className={`pill ${r.valid && !r.duplicate ? "pill-green" : r.duplicate ? "pill-amber" : "pill-red"}`}>{r.duplicate ? "Dup" : r.valid ? "OK" : "Err"}</span>
            <div className="flex-1"><p className="line-clamp-1">{strip(r.question_html) || "(empty)"}</p>{r.error && <p className="text-danger">{r.error}</p>}</div>
            <span className="text-muted">{r.correct_option}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function QuizImportsAdmin() {
  const { data: jobs, reload } = useAdminData<ImportJob[]>("/api/admin/quiz-imports", "jobs");
  const { toast } = useToast();
  const [tab, setTab] = useState<"file" | "sheet">("file");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [approve, setApprove] = useState(true);
  const [publish, setPublish] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheetUrl, setSheetUrl] = useState("");

  async function fileAction(action: "preview" | "import") {
    const file = fileRef.current?.files?.[0];
    if (!file) return toast("Choose a CSV or XLSX file", "error");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("action", action);
      fd.append("approve", String(approve));
      fd.append("publish", String(publish));
      const res = await fetch("/api/admin/questions/csv-import", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.ok) return toast(data.error || "Failed", "error");
      if (action === "preview") setPreview({ rows: data.rows, summary: data.summary });
      else { toast(`Imported ${data.imported}/${data.total} (${data.errors?.length || 0} skipped)`, "success"); setPreview(null); reload(); }
    } finally { setBusy(false); }
  }

  async function sheetAction(action: "preview" | "import") {
    if (!sheetUrl.trim()) return toast("Paste a Google Sheet URL", "error");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/questions/google-sheet", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, url: sheetUrl, approve, publish }),
      });
      const data = await res.json();
      if (!data.ok) return toast(data.error || "Failed", "error");
      if (action === "preview") setPreview({ rows: data.rows, summary: data.summary });
      else { toast(`Imported ${data.imported}/${data.total}`, "success"); setPreview(null); reload(); }
    } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="Question Imports" subtitle="Bulk-load the question bank from CSV/XLSX or a Google Sheet." />

      <div className="card p-5">
        <div className="mb-4 flex gap-1 border-b border-line">
          <button onClick={() => { setTab("file"); setPreview(null); }} className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === "file" ? "border-primary text-primary" : "border-transparent text-ink2"}`}>CSV / XLSX upload</button>
          <button onClick={() => { setTab("sheet"); setPreview(null); }} className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === "sheet" ? "border-primary text-primary" : "border-transparent text-ink2"}`}>Google Sheet</button>
        </div>

        <p className="mb-3 text-xs text-muted">
          Columns: <code>questionText, optionA, optionB, optionC, optionD, correctOption, explanation, subject, topic, subtopic, difficulty, tags, currentAffairsDate, quizDate, source, isPYQ, pyqYear</code>
        </p>

        {tab === "file" ? (
          <input ref={fileRef} type="file" accept=".csv,.tsv,.xlsx,.xls" className="input" />
        ) : (
          <>
            <input className="input" placeholder="https://docs.google.com/spreadsheets/d/…" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
            <p className="mt-1 text-xs text-muted">Share the sheet as &quot;Anyone with the link can view&quot; (or Publish to web). Private sheets via service account = TODO.</p>
          </>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} /> Mark approved</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Publish immediately</label>
        </div>

        {preview && <PreviewTable preview={preview} />}

        <div className="mt-4 flex justify-end gap-2">
          <button disabled={busy} onClick={() => (tab === "file" ? fileAction("preview") : sheetAction("preview"))} className="btn btn-secondary text-sm">Preview</button>
          <button disabled={busy || !preview || preview.summary.valid === 0} onClick={() => (tab === "file" ? fileAction("import") : sheetAction("import"))} className="btn btn-primary text-sm">Import {preview ? `${preview.summary.valid} valid` : ""}</button>
        </div>
      </div>

      <h2 className="mb-3 mt-8 font-heading text-lg font-bold">Recent imports</h2>
      {(jobs || []).length === 0 ? (
        <div className="card p-8 text-center text-muted">No imports yet.</div>
      ) : (
        <TableShell headers={["Type", "Status", "Total", "Success", "Errors", "When"]}>
          {(jobs || []).map((j) => (
            <tr key={j.id} className="border-b border-line last:border-0">
              <td className="px-4 py-3">{j.type}</td>
              <td className="px-4 py-3"><span className="pill pill-green">{j.status}</span></td>
              <td className="px-4 py-3">{j.total_rows}</td>
              <td className="px-4 py-3 text-success">{j.success_count}</td>
              <td className="px-4 py-3 text-danger">{j.error_count}</td>
              <td className="px-4 py-3 text-muted">{new Date(j.created_at).toLocaleString("en-IN")}</td>
            </tr>
          ))}
        </TableShell>
      )}
    </div>
  );
}
