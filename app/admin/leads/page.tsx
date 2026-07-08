"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import Modal from "@/components/ui/Modal";
import JourneyTimeline from "@/components/admin/JourneyTimeline";
import SendSmsButton from "@/components/admin/sms/SendSmsButton";
import SearchBar from "@/components/ui/SearchBar";
import GroupedTimeline, { type TimelineGroup } from "@/components/admin/GroupedTimeline";
import SortControl from "@/components/admin/SortControl";
import TimeframeFilter from "@/components/admin/TimeframeFilter";
import { useToast } from "@/components/ui/Toast";
import { usePersistentState } from "@/lib/usePersistentState";
import { formatINR, formatISTDateTime, istYMD, istTodayYMD, istYMDToMs, resolveTimeframe, type TimeframeValue } from "@/lib/dates";
import type { Lead, LeadStatus, LeadSourceTouch } from "@/lib/types";

const DAY_MS = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const LeadsBarChart = dynamic(() => import("@/components/admin/RegistrationsBarChart"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-shimmer rounded-xl bg-surface2" />,
});

const STAGES: LeadStatus[] = ["New", "Contacted", "Demo Booked", "Demo Attended", "Negotiation", "Admitted", "Lost"];
const SOURCES = ["Instagram", "Meta Form", "Webinar", "Demo", "Website", "WhatsApp", "Referral", "home_popup"];

type LeadSort = "recent" | "activity" | "name";
const LEAD_SORTS: { value: LeadSort; label: string }[] = [
  { value: "recent", label: "Most recent activity" },
  { value: "activity", label: "Most activity" },
  { value: "name", label: "Name (A → Z)" },
];

const TEMP_DOT: Record<string, string> = {
  Interested: "bg-success",
  Warm: "bg-amber-500",
  Cold: "bg-ink2",
  Junk: "bg-danger",
};

function waLink(phone: string, text: string) {
  const cleaned = phone.replace(/\D/g, "");
  const withCountry = cleaned.length === 10 ? `91${cleaned}` : cleaned;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}`;
}

interface LeadAccount { id: string; name: string | null; phone: string; login_code: string; created_at: string }

export default function LeadsPage() {
  const { data: leads, loading, reload } = useAdminData<Lead[]>("/api/admin/leads", "leads");
  const { data: leadAccounts } = useAdminData<LeadAccount[]>("/api/admin/leads/accounts", "leads");
  const { toast } = useToast();
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [sort, setSort] = usePersistentState<LeadSort>("nsa.leads.sort", "recent");
  const [q, setQ] = useState("");
  const [source, setSource] = useState("all");
  const [tf, setTf] = usePersistentState<TimeframeValue>("nsa.leads.tf", { mode: "all" });
  const [showChart, setShowChart] = usePersistentState<boolean>("nsa.leads.chart", true);
  const [addOpen, setAddOpen] = useState(false);
  const [active, setActive] = useState<Lead | null>(null);

  const { fromMs, toMs } = useMemo(() => resolveTimeframe(tf), [tf]);

  const filtered = useMemo(() => {
    const list = leads || [];
    const query = q.trim().toLowerCase();
    return list.filter((l) => {
      if (source !== "all" && l.source !== source) return false;
      if (query && !(`${l.name} ${l.phone} ${l.city ?? ""}`.toLowerCase().includes(query))) return false;
      const ms = new Date(l.created_at).getTime();
      if (Number.isFinite(fromMs) && !(ms >= fromMs && ms < toMs)) return false;
      return true;
    });
  }, [leads, q, source, fromMs, toMs]);

  // Group the (already filtered) leads by PERSON (phone) — purely presentational.
  // Multiple submissions for one phone stack as a timeline; one-off leads render
  // compact. No lead is dropped or merged; every row appears as a node.
  const leadGroups = useMemo((): TimelineGroup[] => {
    const byPhone = new Map<string, Lead[]>();
    for (const l of filtered) {
      const key = (l.phone || "").trim() || `id:${l.id}`;
      const arr = byPhone.get(key);
      if (arr) arr.push(l); else byPhone.set(key, [l]);
    }
    const rows = [...byPhone.entries()].map(([key, list]) => {
      const sorted = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const latest = sorted[0];
      const name = (sorted.find((l) => l.name)?.name || latest.name || "—").trim() || "—";
      const flags = (l: Lead) => [
        l.demo_booked ? "Demo booked" : null,
        l.demo_attended ? "Demo attended" : null,
        l.webinar_registered ? "Webinar reg." : null,
        l.admitted ? "Admitted" : null,
      ].filter(Boolean).join(" · ");
      const nodes = sorted.map((l) => ({
        id: l.id,
        dot: TEMP_DOT[l.temperature] || "bg-ink2",
        title: (
          <button onClick={() => setActive(l)} className="text-left font-medium text-ink hover:text-primary">
            {l.source}{l.course_interest ? ` · ${l.course_interest}` : ""}
          </button>
        ),
        subtitle: [l.counsellor ? `Counsellor: ${l.counsellor}` : null, flags(l) || null, l.city || null].filter(Boolean).join(" · ") || undefined,
        datetime: l.created_at,
        badge: (
          <span className="flex items-center gap-1.5">
            <span className="pill pill-blue">{l.status}</span>
            <span className={`pill ${l.temperature === "Interested" ? "pill-green" : l.temperature === "Warm" ? "pill-amber" : l.temperature === "Junk" ? "pill-red" : "pill-gray"}`}>{l.temperature}</span>
          </span>
        ),
      }));
      return { key, name, phone: (latest.phone || "").trim(), latestAt: new Date(latest.created_at).getTime(), count: sorted.length, latestStatus: latest.status, nodes };
    });

    rows.sort((a, b) => {
      if (sort === "activity") return b.count - a.count || b.latestAt - a.latestAt;
      if (sort === "name") return a.name.localeCompare(b.name);
      return b.latestAt - a.latestAt;
    });

    return rows.map((r): TimelineGroup => ({
      id: r.key,
      name: r.name,
      phone: r.phone || undefined,
      summary: (
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted">{r.count} {r.count === 1 ? "touchpoint" : "touchpoints"}</span>
          <span className="pill pill-blue">{r.latestStatus}</span>
        </span>
      ),
      nodes: r.nodes,
    }));
  }, [filtered, sort]);

  const matchOpenIds = useMemo(
    () => (q.trim() ? new Set(leadGroups.map((g) => g.id)) : undefined),
    [q, leadGroups],
  );

  async function setStatus(lead: Lead, status: LeadStatus) {
    await fetch(`/api/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, admitted: status === "Admitted" }),
    });
    reload();
  }

  function exportCsv() {
    const rows = [
      ["Name", "Phone", "Email", "City", "State", "Source", "Status", "Course Interest", "Counsellor", "Follow-up", "Created"],
      ...filtered.map((l) => [l.name, l.phone, l.email ?? "", l.city ?? "", l.state ?? "", l.source, l.status, l.course_interest ?? "", l.counsellor ?? "", l.follow_up_date ?? "", l.created_at ?? ""]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast("Exported leads.csv", "success");
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="Lead CRM"
        subtitle={`${filtered.length} sales-pipeline leads`}
        action={
          <div className="flex flex-wrap gap-2">
            <button onClick={exportCsv} className="btn btn-secondary text-sm">⬇ Export CSV</button>
            <button onClick={() => setAddOpen(true)} className="btn btn-primary text-sm">+ Add Lead</button>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="min-w-[200px] flex-1"><SearchBar value={q} onChange={setQ} placeholder="Search name / phone / city" /></div>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="input max-w-[180px]">
          <option value="all">All sources</option>
          {SOURCES.map((s) => <option key={s}>{s}</option>)}
        </select>
        {view === "list" && <SortControl value={sort} onChange={setSort} options={LEAD_SORTS} />}
        <div className="flex overflow-hidden rounded-xl border border-line">
          <button onClick={() => setView("kanban")} className="px-3 py-2 text-sm" style={{ background: view === "kanban" ? "var(--primary)" : "#fff", color: view === "kanban" ? "#fff" : "var(--ink2)" }}>Kanban</button>
          <button onClick={() => setView("list")} className="px-3 py-2 text-sm" style={{ background: view === "list" ? "var(--primary)" : "#fff", color: view === "list" ? "#fff" : "var(--ink2)" }}>Stacked</button>
        </div>
      </div>

      {/* Timeframe filter — scopes BOTH the list/kanban and the trend chart. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <TimeframeFilter value={tf} onChange={setTf} size="sm" />
        <button onClick={() => setShowChart(!showChart)} className="btn btn-secondary text-xs">
          {showChart ? "Hide trend" : "Show trend"}
        </button>
      </div>

      {showChart && (
        <div className="card mb-4 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Leads by day{source !== "all" ? ` · ${source}` : ""}</p>
            <span className="text-sm text-muted">Total: <span className="font-bold text-ink">{filtered.length}</span></span>
          </div>
          <div className="h-64 w-full">
            <LeadsTrendChart leads={filtered} fromMs={fromMs} toMs={toMs} />
          </div>
        </div>
      )}

      {/* Portal lead accounts (quiz/marketing leads with a login code — never in seats/finance). */}
      <details className="card mb-4 p-0">
        <summary className="flex cursor-pointer items-center justify-between gap-2 p-4">
          <span className="font-semibold">
            Portal login-code leads
            <span className="ml-2 pill pill-blue">{leadAccounts?.length ?? 0}</span>
          </span>
          <span className="text-xs text-muted">Self-service quiz/marketing signups (can log in) · distinct from the sales pipeline below · never in seats &amp; finance</span>
        </summary>
        <div className="border-t border-line p-0">
          {leadAccounts && leadAccounts.length > 0 ? (
            <TableShell headers={["Name", "Phone", "Login code", "Created", ""]}>
              {leadAccounts.map((b) => (
                <tr key={b.id} className="border-b border-line last:border-0 hover:bg-surface2">
                  <td className="px-4 py-3 font-medium">{b.name || "—"}</td>
                  <td className="px-4 py-3">{b.phone}</td>
                  <td className="px-4 py-3 font-mono text-xs">{b.login_code}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-muted">{b.created_at ? new Date(b.created_at).toLocaleDateString("en-IN") : "—"}</td>
                  <td className="px-4 py-3"><a href={waLink(b.phone, `Hi ${b.name || ""}, this is Naman IAS Academy. `)} target="_blank" rel="noopener noreferrer" className="text-primary">WhatsApp</a></td>
                </tr>
              ))}
            </TableShell>
          ) : (
            <p className="p-4 text-sm text-muted">No lead accounts yet.</p>
          )}
        </div>
      </details>

      {view === "kanban" ? (
        <div className="no-scrollbar flex gap-3 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const items = filtered.filter((l) => l.status === stage);
            return (
              <div key={stage} className="w-72 shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold">{stage}</span>
                  <span className="pill pill-gray">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((l) => (
                    <button key={l.id} onClick={() => setActive(l)} className="card card-hover w-full p-3 text-left">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{l.name}</span>
                        <span className={`pill ${l.temperature === "Interested" ? "pill-green" : l.temperature === "Warm" ? "pill-amber" : l.temperature === "Junk" ? "pill-red" : "pill-gray"}`}>{l.temperature}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted">{l.phone} · {l.city}</p>
                      <p className="mt-1 line-clamp-1 text-xs text-ink2">{l.course_interest}</p>
                      <p className="mt-1 text-[11px] text-muted">{l.source} · {l.counsellor}</p>
                    </button>
                  ))}
                  {items.length === 0 && <div className="rounded-xl border border-dashed border-line py-6 text-center text-xs text-muted">Empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <p className="mb-2 px-1 text-xs text-muted">
            Showing {filtered.length} {filtered.length === 1 ? "lead" : "leads"} · {leadGroups.length} {leadGroups.length === 1 ? "person" : "people"}
          </p>
          <GroupedTimeline groups={leadGroups} forceOpenIds={matchOpenIds} emptyText="No leads match these filters." />
        </>
      )}

      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={reload} />
      {active && (
        <LeadDetail
          lead={active}
          onClose={() => setActive(null)}
          onChanged={() => { reload(); }}
          setStatus={setStatus}
          waLink={waLink}
        />
      )}
    </div>
  );
}

/**
 * Leads time-series bar chart. Reuses the Payments/Finance RegistrationsBarChart
 * (recharts) body. Buckets the already-filtered leads by IST day within the
 * selected window; spans > ~92 days roll up into monthly buckets so the chart
 * stays readable. Totals always match the list above (same filtered set).
 */
function LeadsTrendChart({ leads, fromMs, toMs }: { leads: Lead[]; fromMs: number; toMs: number }) {
  const { chartData, dense } = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const l of leads) { const ymd = istYMD(l.created_at); if (ymd) byDay.set(ymd, (byDay.get(ymd) || 0) + 1); }

    let startYMD: string;
    let endYMD: string;
    const today = istTodayYMD();
    if (!Number.isFinite(fromMs)) {
      const days = [...byDay.keys()].sort();
      startYMD = days[0] || today;
      endYMD = today;
    } else {
      startYMD = istYMD(new Date(fromMs)) || today;
      endYMD = istYMD(new Date(toMs - 1)) || today;
    }
    const startMs = istYMDToMs(startYMD);
    const endMs = istYMDToMs(endYMD);
    const dayCount = Math.round((endMs - startMs) / DAY_MS) + 1;

    if (dayCount > 92) {
      // monthly buckets
      const byMonth = new Map<string, number>();
      for (const [ymd, c] of byDay) byMonth.set(ymd.slice(0, 7), (byMonth.get(ymd.slice(0, 7)) || 0) + c);
      const out: { label: string; ymd: string; count: number }[] = [];
      const [sy, sm] = startYMD.split("-").map(Number);
      const [ey, em] = endYMD.split("-").map(Number);
      let y = sy, m = sm;
      while (y < ey || (y === ey && m <= em)) {
        const key = `${y}-${String(m).padStart(2, "0")}`;
        out.push({ label: `${MONTHS[m - 1]} ${String(y).slice(2)}`, ymd: key, count: byMonth.get(key) || 0 });
        if (m === 12) { m = 1; y++; } else m++;
      }
      return { chartData: out, dense: out.length > 14 };
    }

    const out: { label: string; ymd: string; count: number }[] = [];
    for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
      const ymd = istYMD(new Date(ms)) || "";
      const [, mo, d] = ymd.split("-");
      out.push({ label: `${d}/${mo}`, ymd, count: byDay.get(ymd) || 0 });
    }
    return { chartData: out, dense: out.length > 14 };
  }, [leads, fromMs, toMs]);

  if (chartData.length === 0) return <div className="flex h-full items-center justify-center text-sm text-muted">No leads in this timeframe.</div>;
  return <LeadsBarChart chartData={chartData} denseTicks={dense} />;
}

function AddLeadModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", phone: "", city: "", source: "Website", course_interest: "" });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name || !/^\d{10}$/.test(form.phone)) { toast("Name and 10-digit phone required", "error"); return; }
    setSaving(true);
    await fetch("/api/admin/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setSaving(false);
    toast("Lead added", "success");
    setForm({ name: "", phone: "", city: "", source: "Website", course_interest: "" });
    onAdded();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Lead">
      <div className="space-y-3">
        <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" placeholder="Phone (10-digit)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
        <input className="input" placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <select className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
          {SOURCES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input className="input" placeholder="Course interest" value={form.course_interest} onChange={(e) => setForm({ ...form, course_interest: e.target.value })} />
        <button onClick={save} disabled={saving} className="btn btn-primary w-full">{saving ? "Saving..." : "Add Lead"}</button>
      </div>
    </Modal>
  );
}

function LeadDetail({
  lead,
  onClose,
  onChanged,
  setStatus,
  waLink,
}: {
  lead: Lead;
  onClose: () => void;
  onChanged: () => void;
  setStatus: (l: Lead, s: LeadStatus) => void;
  waLink: (p: string, t: string) => string;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [status, setLocalStatus] = useState<LeadStatus>(lead.status);
  const [showJourney, setShowJourney] = useState(false);

  async function addNote() {
    if (!note.trim()) return;
    await fetch(`/api/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _activity: { type: "note", note: note.trim(), counsellor: lead.counsellor } }),
    });
    setNote("");
    toast("Note added", "success");
  }

  return (
    <Modal open onClose={onClose} title={lead.name} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Info label="Phone" value={lead.phone} />
          <Info label="Email" value={lead.email || "—"} />
          <Info label="City" value={lead.city || "—"} />
          <Info label="Source (latest)" value={lead.source} />
          <Info label="Counsellor" value={lead.counsellor || "—"} />
          <Info label="Interest" value={lead.course_interest || "—"} />
          <Info label="Target" value={lead.target_year ? String(lead.target_year) : "—"} />
          {lead.admitted && <Info label="Fee" value={formatINR(lead.total_fee || 0)} />}
          {lead.admitted && <Info label="Pending" value={formatINR(lead.pending_balance || 0)} />}
        </div>

        <SourceHistory lead={lead} />

        <div>
          <label className="label">Pipeline stage</label>
          <select className="input" value={status} onChange={(e) => { const s = e.target.value as LeadStatus; setLocalStatus(s); setStatus(lead, s); onChanged(); }}>
            {STAGES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex gap-2">
          <a href={waLink(lead.phone, `Hi ${lead.name}, this is Naman IAS Academy team. `)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary flex-1 text-sm">💬 WhatsApp</a>
          <a href={`tel:${lead.phone}`} className="btn btn-secondary flex-1 text-sm">📞 Call</a>
          <SendSmsButton phone={lead.phone} name={lead.name} className="btn btn-secondary flex-1 justify-center text-sm" label="📱 SMS" />
        </div>

        <div>
          <label className="label">Add activity / note</label>
          <div className="flex gap-2">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Called, sent brochure..." />
            <button onClick={addNote} className="btn btn-primary text-sm">Log</button>
          </div>
        </div>

        <div className="border-t border-line pt-3">
          <button onClick={() => setShowJourney((v) => !v)} className="text-sm font-semibold text-primary hover:underline">
            {showJourney ? "Hide customer journey" : "View customer journey"}
          </button>
          {showJourney && <div className="mt-3"><JourneyTimeline phone={lead.phone} /></div>}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Source / touchpoint history for a (possibly de-duplicated) lead. Shows the
 * first-touch and latest-touch attribution plus the full chronological list of
 * every source the person arrived through.
 */
function SourceHistory({ lead }: { lead: Lead }) {
  const touches: LeadSourceTouch[] = Array.isArray(lead.sources) && lead.sources.length
    ? lead.sources
    : [{ source: lead.source, campaign: lead.campaign, course_interest: lead.course_interest, at: lead.created_at }];
  const ordered = [...touches].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const fmtSrc = (t: LeadSourceTouch) => [t.source || "—", t.campaign ? `(${t.campaign})` : ""].filter(Boolean).join(" ");

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Source history</p>
        <span className="pill pill-gray text-[10px]">{ordered.length} touchpoint{ordered.length === 1 ? "" : "s"}{lead.merged_count ? ` · ${lead.merged_count} merged` : ""}</span>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-muted">First touch: </span><span className="font-medium text-ink">{lead.first_source || first.source || "—"}{lead.first_campaign ? ` (${lead.first_campaign})` : first.campaign ? ` (${first.campaign})` : ""}</span></div>
        <div><span className="text-muted">Last touch: </span><span className="font-medium text-ink">{fmtSrc(last)}</span></div>
      </div>
      <ol className="max-h-40 space-y-1.5 overflow-y-auto border-t border-line pt-2 text-xs">
        {ordered.map((t, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              <span className="font-medium text-ink">{t.source || "—"}</span>
              {t.campaign && <span className="text-muted"> · {t.campaign}</span>}
              {t.course_interest && <span className="text-muted"> · {t.course_interest}</span>}
            </span>
            <span className="shrink-0 text-muted">{formatISTDateTime(t.at)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="text-ink">{value}</p>
    </div>
  );
}
