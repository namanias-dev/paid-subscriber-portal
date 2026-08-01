"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, LoadingBlock, TableShell } from "@/components/admin/ui";
import { formatISTDateTime } from "@/lib/dates";
import { ADMIN_ACTIVITY_LABELS } from "@/lib/adminActivity";

interface Row {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  action_label: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
}

function entityHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  if (type === "student") return `/admin/students/${id}`;
  if (type === "payment") return `/admin/payments?q=${encodeURIComponent(id)}`;
  if (type === "enrollment") return `/admin/students`;
  return null;
}

function entitySummary(r: Row): string {
  const m = r.metadata || {};
  const name = (m.student_name as string) || (m.audience_name as string) || null;
  const parts = [r.entity_type, name, r.entity_id].filter(Boolean);
  return parts.join(" · ") || "—";
}

export default function ActivityLogClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (actor) params.set("actor", actor);
      if (action) params.set("action", action);
      if (entityType) params.set("entityType", entityType);
      if (from) params.set("from", new Date(`${from}T00:00:00+05:30`).toISOString());
      if (to) params.set("to", new Date(`${to}T00:00:00+05:30`).toISOString());
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/admin/activity?${params}`);
      const data = await res.json();
      if (data.ok) {
        setRows(data.rows || []);
        setTotal(data.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [page, actor, action, entityType, from, to, q]);

  useEffect(() => { void load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-4 pb-16">
      <PageHeader title="Activity Log" subtitle="Append-only audit of admin actions (Super Admin only)." />

      <div className="card grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <input className="input" placeholder="Search name / phone" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} />
        <input className="input" placeholder="Actor id" value={actor} onChange={(e) => { setPage(1); setActor(e.target.value); }} />
        <select className="input" value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }}>
          <option value="">All actions</option>
          {Object.entries(ADMIN_ACTIVITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" value={entityType} onChange={(e) => { setPage(1); setEntityType(e.target.value); }}>
          <option value="">All entities</option>
          <option value="payment">payment</option>
          <option value="enrollment">enrollment</option>
          <option value="student">student</option>
          <option value="leads">leads</option>
          <option value="audience">audience</option>
          <option value="settings">settings</option>
        </select>
        <input type="date" className="input" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value); }} />
        <input type="date" className="input" value={to} onChange={(e) => { setPage(1); setTo(e.target.value); }} />
      </div>

      {loading ? <LoadingBlock /> : (
        <TableShell headers={["Time (IST)", "Actor", "Action", "Entity"]}>
          {rows.map((r) => {
            const href = entityHref(r.entity_type, r.entity_id);
            const open = expanded === r.id;
            return (
              <Fragment key={r.id}>
                <tr
                  className="cursor-pointer border-b border-line/70 hover:bg-surface2/60"
                  onClick={() => setExpanded(open ? null : r.id)}
                >
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums text-ink2">{formatISTDateTime(r.created_at)}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-ink">{r.actor_name || r.actor_user_id || "—"}</div>
                    <div className="text-xs text-muted">{r.actor_role || "—"}</div>
                  </td>
                  <td className="px-4 py-2 font-medium text-ink">{r.action_label}</td>
                  <td className="px-4 py-2 text-ink2">
                    {href ? (
                      <Link href={href} className="text-primary underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
                        {entitySummary(r)}
                      </Link>
                    ) : entitySummary(r)}
                  </td>
                </tr>
                {open && (
                  <tr className="border-b border-line bg-surface2/40">
                    <td colSpan={4} className="px-4 py-3">
                      <pre className="overflow-x-auto rounded-lg bg-ink/5 p-3 text-xs text-ink2">{JSON.stringify(r.metadata, null, 2)}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">No activity yet.</td></tr>
          )}
        </TableShell>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{total} events · page {page} of {pages}</span>
        <div className="flex gap-2">
          <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <button className="btn btn-secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
