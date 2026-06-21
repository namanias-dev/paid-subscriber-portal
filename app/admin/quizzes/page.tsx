"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import SearchBar from "@/components/ui/SearchBar";
import { useToast } from "@/components/ui/Toast";
import type { Quiz } from "@/lib/types";

export default function QuizzesAdmin() {
  const { data: quizzes, loading, reload } = useAdminData<Quiz[]>("/api/admin/quizzes", "quizzes");
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  const filtered = useMemo(() => {
    const list = quizzes || [];
    const query = q.trim().toLowerCase();
    return list.filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (query && !item.title.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [quizzes, q, status]);

  async function del(id: string) {
    if (!confirm("Delete this quiz? Past attempts keep their snapshots.")) return;
    await fetch(`/api/admin/quizzes/${id}`, { method: "DELETE" });
    toast("Quiz deleted", "success");
    reload();
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="Quizzes / Tests"
        subtitle={`${filtered.length} quizzes`}
        action={<Link href="/admin/quizzes/new" className="btn btn-primary text-sm">+ New Quiz</Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-[200px] flex-1"><SearchBar value={q} onChange={setQ} placeholder="Search quizzes" /></div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input max-w-[160px]">
          <option value="all">All status</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="scheduled">Scheduled</option>
          <option value="archived">Archived</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-10 text-center text-muted">No quizzes yet. Create one to get started.</div>
      ) : (
        <TableShell headers={["Title", "Type", "Subject", "Access", "Status", ""]}>
          {filtered.map((item) => (
            <tr key={item.id} className="border-b border-line last:border-0 hover:bg-surface2">
              <td className="px-4 py-3"><span className="font-medium">{item.title}</span><span className="block text-xs text-muted">/{item.slug}</span></td>
              <td className="px-4 py-3">{item.type}</td>
              <td className="px-4 py-3">{item.subject || "—"}</td>
              <td className="px-4 py-3">{item.is_public ? <span className="pill pill-green">Public</span> : item.requires_payment ? <span className="pill pill-amber">Paid</span> : <span className="pill pill-blue">Login</span>}</td>
              <td className="px-4 py-3"><span className={`pill ${item.status === "published" ? "pill-green" : item.status === "disabled" || item.status === "archived" ? "pill-gray" : "pill-amber"}`}>{item.status}</span></td>
              <td className="whitespace-nowrap px-4 py-3">
                {item.is_public && item.status === "published" && <Link href={`/quizzes/${item.slug}`} target="_blank" className="text-primary">View</Link>}
                <Link href={`/admin/quizzes/${item.id}/edit`} className="ml-3 text-primary">Edit</Link>
                <button onClick={() => del(item.id)} className="ml-3 text-danger">Delete</button>
              </td>
            </tr>
          ))}
        </TableShell>
      )}
    </div>
  );
}
