"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import SearchBar from "@/components/ui/SearchBar";
import { useToast } from "@/components/ui/Toast";
import { SUBJECTS } from "@/lib/config";
import type { Question } from "@/lib/types";

function stripHtml(html: string) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export default function QuestionsAdmin() {
  const { data: questions, loading, reload } = useAdminData<Question[]>("/api/admin/questions", "questions");
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState("all");
  const [status, setStatus] = useState("all");
  const [bulkOpen, setBulkOpen] = useState(false);

  const filtered = useMemo(() => {
    const list = questions || [];
    const query = q.trim().toLowerCase();
    return list.filter((item) => {
      if (subject !== "all" && item.subject !== subject) return false;
      if (status !== "all" && item.status !== status) return false;
      if (query && !stripHtml(item.question_html).toLowerCase().includes(query)) return false;
      return true;
    });
  }, [questions, q, subject, status]);

  async function del(id: string) {
    if (!confirm("Delete this question?")) return;
    await fetch(`/api/admin/questions/${id}`, { method: "DELETE" });
    toast("Question deleted", "success");
    reload();
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="Question Bank"
        subtitle={`${filtered.length} questions`}
        action={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setBulkOpen(true)} className="btn btn-secondary text-sm">⬆ Bulk Import</button>
            <Link href="/admin/questions/new" className="btn btn-primary text-sm">+ New Question</Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-[200px] flex-1"><SearchBar value={q} onChange={setQ} placeholder="Search question text" /></div>
        <select value={subject} onChange={(e) => setSubject(e.target.value)} className="input max-w-[180px]">
          <option value="all">All subjects</option>
          {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input max-w-[160px]">
          <option value="all">All status</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-10 text-center text-muted">No questions yet. Create one or bulk-import.</div>
      ) : (
        <TableShell headers={["Question", "Subject", "Topic", "Difficulty", "Answer", "Status", ""]}>
          {filtered.map((item) => (
            <tr key={item.id} className="border-b border-line last:border-0 hover:bg-surface2">
              <td className="max-w-md px-4 py-3"><span className="line-clamp-2">{stripHtml(item.question_html)}</span></td>
              <td className="px-4 py-3">{item.subject || "—"}</td>
              <td className="px-4 py-3">{item.topic || "—"}</td>
              <td className="px-4 py-3">{item.difficulty}</td>
              <td className="px-4 py-3 font-semibold text-primary">{item.correct_option}</td>
              <td className="px-4 py-3"><span className={`pill ${item.status === "published" ? "pill-green" : item.status === "archived" ? "pill-gray" : "pill-amber"}`}>{item.status}</span></td>
              <td className="whitespace-nowrap px-4 py-3">
                <Link href={`/admin/questions/${item.id}/edit`} className="text-primary">Edit</Link>
                <button onClick={() => del(item.id)} className="ml-3 text-danger">Delete</button>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <BulkImportModal open={bulkOpen} onClose={() => setBulkOpen(false)} onImported={reload} />
    </div>
  );
}

interface PreviewRow {
  index: number;
  question_html: string;
  correct_option: string;
  subject: string | null;
  valid: boolean;
  duplicate: boolean;
  error?: string;
}

function BulkImportModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [publish, setPublish] = useState(false);
  const [approve, setApprove] = useState(true);

  async function preview() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/questions/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", text }),
      });
      const data = await res.json();
      if (data.ok) setRows(data.rows);
      else toast(data.error || "Preview failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/questions/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", text, publish, approve, skipDuplicates: true }),
      });
      const data = await res.json();
      if (data.ok) {
        toast(`Imported ${data.imported} of ${data.total} (${data.errors?.length || 0} skipped)`, "success");
        setText("");
        setRows(null);
        onImported();
        onClose();
      } else {
        toast(data.error || "Import failed", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  const validCount = rows?.filter((r) => r.valid && !r.duplicate).length || 0;

  return (
    <Modal open={open} onClose={onClose} title="Bulk import questions" maxWidth="max-w-2xl">
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Paste questions in this format (blank line between questions):<br />
          <code>Q1. ...?</code> → <code>A. ..</code> <code>B. ..</code> <code>C. ..</code> <code>D. ..</code> → <code>Answer: B</code> → <code>Explanation: ..</code> → <code>Subject: ..</code> <code>Topic: ..</code> <code>Difficulty: ..</code> <code>Tags: ..</code>
        </p>
        <textarea className="input min-h-[180px] font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={"Q1. Which Article ...?\nA. ..\nB. ..\nC. ..\nD. ..\nAnswer: C\nExplanation: ..\nSubject: Polity"} />

        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} /> Mark approved</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Publish immediately</label>
        </div>

        {rows && (
          <div className="max-h-60 overflow-y-auto rounded-xl border border-line">
            {rows.map((r) => (
              <div key={r.index} className="flex items-start gap-2 border-b border-line px-3 py-2 text-xs last:border-0">
                <span className={`pill ${r.valid && !r.duplicate ? "pill-green" : r.duplicate ? "pill-amber" : "pill-red"}`}>
                  {r.duplicate ? "Dup" : r.valid ? "OK" : "Err"}
                </span>
                <div className="flex-1">
                  <p className="line-clamp-1">{stripHtml(r.question_html) || "(no question text)"}</p>
                  {r.error && <p className="text-danger">{r.error}</p>}
                </div>
                <span className="text-muted">{r.correct_option}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={preview} disabled={busy || !text.trim()} className="btn btn-secondary text-sm">Preview</button>
          <button onClick={doImport} disabled={busy || !rows || validCount === 0} className="btn btn-primary text-sm">
            Import {validCount > 0 ? `${validCount} valid` : ""}
          </button>
        </div>
      </div>
    </Modal>
  );
}
