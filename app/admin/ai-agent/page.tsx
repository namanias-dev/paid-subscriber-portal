"use client";

/**
 * Admin → AI Counsellor. Eight tabs: Overview, Conversations, Leads, Hot Leads,
 * Follow-ups, Settings, Offer Awareness, Security/Privacy Logs.
 *
 * Every data fetch hits an admin API route that enforces
 * requirePermission('manage_ai_agent') server-side; the page-level gate below is
 * only for UX (hide the section for staff without the permission). Reads of lead
 * PII and settings changes are audited server-side to ai_security_audit.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, KpiCard, TableShell, LoadingBlock } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { whatsappLink } from "@/lib/phone";

type Tab =
  | "overview"
  | "conversations"
  | "leads"
  | "hot"
  | "followups"
  | "settings"
  | "offers"
  | "security";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "conversations", label: "Conversations" },
  { id: "leads", label: "Leads" },
  { id: "hot", label: "Hot Leads" },
  { id: "followups", label: "Follow-ups" },
  { id: "settings", label: "Settings" },
  { id: "offers", label: "Offer Awareness" },
  { id: "security", label: "Security / Privacy" },
];

interface Lead {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  target_year: number | null;
  score: number;
  temperature: string;
  status: string;
  source: string | null;
  notes: string | null;
  last_seen_at: string;
  created_at: string;
}

function isSuper(p: Record<string, boolean> | undefined): boolean {
  return !!p && p.manage_roles === true && p.manage_staff === true && p.view_revenue === true;
}

function tempPill(t: string): string {
  return t === "hot" ? "pill-red" : t === "warm" ? "pill-amber" : "pill-gray";
}

export default function AiAgentAdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((d) =>
        setAllowed(
          !!d?.ok &&
            (d?.admin?.permissions?.manage_ai_agent === true ||
              d?.admin?.permissions === undefined ||
              isSuper(d?.admin?.permissions)),
        ),
      )
      .catch(() => setAllowed(false));
  }, []);

  if (allowed === false) {
    return (
      <div className="card p-8 text-center">
        <p className="font-heading text-lg font-bold">No access</p>
        <p className="mt-1 text-sm text-ink2">You don&apos;t have permission to manage the AI Counsellor.</p>
      </div>
    );
  }
  if (allowed === null) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        title="AI Counsellor"
        subtitle="Guided-flow lead counsellor — leads, conversations, follow-ups, offers & privacy."
      />

      <div className="mb-6 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`-mb-px border-b-2 px-3.5 py-2 text-sm font-semibold transition ${
              tab === t.id ? "border-primary text-primary" : "border-transparent text-ink2 hover:text-ink"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "conversations" && <ConversationsTab />}
      {tab === "leads" && <LeadsTab />}
      {tab === "hot" && <HotLeadsTab />}
      {tab === "followups" && <FollowupsTab />}
      {tab === "settings" && <SettingsTab />}
      {tab === "offers" && <OffersTab />}
      {tab === "security" && <SecurityTab />}
    </div>
  );
}

/* ============================== OVERVIEW ============================== */
interface Overview {
  leads: { total: number; cold: number; warm: number; hot: number; recent7d: number };
  conversations: number;
  followups: { pending: number };
  conversions: number;
}

function OverviewTab() {
  const [data, setData] = useState<Overview | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/ai-agent/overview").then((r) => r.json()),
      fetch("/api/admin/ai-agent/offer-awareness").then((r) => r.json()),
    ])
      .then(([o, off]) => {
        if (o?.ok) setData(o.overview);
        if (off?.ok) setWarnings(off.warnings || []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingBlock />;
  if (!data) return <EmptyCard title="No data yet" hint="Metrics appear once the agent starts capturing leads." />;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total leads" value={data.leads.total} hint={`${data.leads.recent7d} in last 7 days`} />
        <KpiCard label="Hot leads" value={data.leads.hot} tone="red" hint="Strong buying intent" />
        <KpiCard label="Warm leads" value={data.leads.warm} tone="amber" />
        <KpiCard label="Cold leads" value={data.leads.cold} tone="blue" />
        <KpiCard label="Conversations" value={data.conversations} tone="blue" />
        <KpiCard label="Follow-ups pending" value={data.followups.pending} tone="amber" />
        <KpiCard label="Conversions" value={data.conversions} tone="green" />
      </div>

      {warnings.length > 0 && (
        <div className="rounded-xl border border-[var(--warning)] bg-[#fef3e2] px-4 py-3 text-sm text-[#8a5a00]">
          <p className="font-semibold">Offer awareness</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ============================== LEADS ============================== */
function LeadsTab() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [temperature, setTemperature] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = temperature ? `?temperature=${encodeURIComponent(temperature)}` : "";
      const res = await fetch(`/api/admin/ai-agent/leads${q}`).then((r) => r.json());
      if (res.ok) setRows(res.leads);
    } finally {
      setLoading(false);
    }
  }, [temperature]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <select className="input max-w-[200px]" value={temperature} onChange={(e) => setTemperature(e.target.value)}>
          <option value="">All temperatures</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>
      </div>
      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyCard title="No leads yet" hint="Leads captured by the agent will show here." />
      ) : (
        <LeadTable rows={rows} onOpen={setSelected} />
      )}
      {selected && <LeadProfileDrawer leadId={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  );
}

function HotLeadsTab() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/ai-agent/hot-leads").then((r) => r.json());
      if (res.ok) setRows(res.leads);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingBlock />;
  if (rows.length === 0) return <EmptyCard title="No hot or warm leads" hint="High-intent leads will surface here for priority follow-up." />;
  return (
    <>
      <LeadTable rows={rows} onOpen={setSelected} />
      {selected && <LeadProfileDrawer leadId={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </>
  );
}

function LeadTable({ rows, onOpen }: { rows: Lead[]; onOpen: (id: string) => void }) {
  return (
    <TableShell headers={["Lead", "Score", "Temp", "Status", "Last seen", ""]}>
      {rows.map((l) => (
        <tr key={l.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface" onClick={() => onOpen(l.id)}>
          <td className="px-4 py-3">
            <div className="font-semibold text-ink">{l.name || "Anonymous"}</div>
            <div className="text-xs text-muted">{l.phone || l.email || l.source || "—"}</div>
          </td>
          <td className="px-4 py-3 tabular-nums text-ink2">{l.score}</td>
          <td className="px-4 py-3"><span className={`pill ${tempPill(l.temperature)}`}>{l.temperature}</span></td>
          <td className="px-4 py-3 text-ink2">{l.status}</td>
          <td className="px-4 py-3 text-ink2">{new Date(l.last_seen_at).toLocaleDateString("en-IN")}</td>
          <td className="px-4 py-3 text-right text-primary">View →</td>
        </tr>
      ))}
    </TableShell>
  );
}

/* ========================= LEAD PROFILE DRAWER ========================= */
interface LeadProfile {
  lead: Lead;
  payments: { id: string; item?: string | null; item_type?: string | null; amount?: number; status?: string; reference_no?: string | null; created_at?: string }[];
  registrations: { id: string; webinar_id: string | null; attended: boolean | null; created_at: string | null }[];
  student: { id: string; name: string | null } | null;
  hasPaid: boolean;
  recommendedPitch: { course: { id: string; title: string; link: string } | null; webinar: { id: string; title: string; link: string } | null } | null;
  nextAction: string;
}

function LeadProfileDrawer({ leadId, onClose, onChanged }: { leadId: string; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<LeadProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/ai-agent/lead-profile?id=${encodeURIComponent(leadId)}`).then((r) => r.json());
      if (res.ok && res.profile) {
        setProfile(res.profile);
        setStatus(res.profile.lead.status || "");
        setNotes(res.profile.lead.notes || "");
      }
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/ai-agent/lead-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: leadId, status, notes }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "Save failed.");
      toast("Lead updated.", "success");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function createFollowup() {
    try {
      const res = await fetch("/api/admin/ai-agent/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, type: "manual", channel: "counselor", notes: "Manual follow-up from lead profile" }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "Failed.");
      toast("Follow-up created.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const wa = profile?.lead.phone ? whatsappLink(profile.lead.phone, "Hi, this is Naman IAS Academy — following up on your UPSC prep enquiry.") : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="font-heading text-base font-bold">Lead profile</p>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink2 hover:bg-surface">✕</button>
        </div>

        {loading ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : !profile ? (
          <div className="p-8 text-center text-sm text-ink2">Lead not found.</div>
        ) : (
          <div className="space-y-4 p-4">
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <p className="font-heading text-lg font-bold">{profile.lead.name || "Anonymous"}</p>
                <span className={`pill ${tempPill(profile.lead.temperature)}`}>{profile.lead.temperature}</span>
              </div>
              <div className="mt-1 space-y-0.5 text-sm text-ink2">
                {profile.lead.phone && <p>📞 {profile.lead.phone}</p>}
                {profile.lead.email && <p>✉️ {profile.lead.email}</p>}
                {profile.lead.city && <p>📍 {profile.lead.city}</p>}
                {profile.lead.target_year && <p>🎯 Target {profile.lead.target_year}</p>}
                <p className="text-xs text-muted">Score {profile.lead.score} · via {profile.lead.source || "chat"}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-secondary h-8 min-h-0 px-3 py-1 text-xs">WhatsApp</a>
                )}
                <button onClick={createFollowup} className="btn btn-ghost h-8 min-h-0 px-3 py-1 text-xs">+ Follow-up</button>
              </div>
            </div>

            <div className="rounded-xl border border-line bg-surface p-3 text-sm">
              <p className="font-semibold text-ink">Next action</p>
              <p className="mt-0.5 text-ink2">{profile.nextAction}</p>
              {profile.recommendedPitch && (
                <div className="mt-2 space-y-1 text-xs">
                  {profile.recommendedPitch.webinar && (
                    <p>Suggested masterclass: <a className="text-primary" href={profile.recommendedPitch.webinar.link} target="_blank" rel="noopener noreferrer">{profile.recommendedPitch.webinar.title}</a></p>
                  )}
                  {profile.recommendedPitch.course && (
                    <p>Suggested course: <a className="text-primary" href={profile.recommendedPitch.course.link} target="_blank" rel="noopener noreferrer">{profile.recommendedPitch.course.title}</a></p>
                  )}
                </div>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Linked payments ({profile.payments.length})</p>
              {profile.payments.length === 0 ? (
                <p className="text-sm text-muted">None found for this phone.</p>
              ) : (
                <div className="space-y-1.5">
                  {profile.payments.slice(0, 6).map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-xs">
                      <span className="text-ink">{p.item || p.item_type || "Payment"}</span>
                      <span className={`pill ${p.status === "PAID" ? "pill-green" : p.status === "FAILED" ? "pill-red" : "pill-gray"}`}>{p.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Webinar registrations ({profile.registrations.length})</p>
              {profile.registrations.length === 0 ? (
                <p className="text-sm text-muted">None found.</p>
              ) : (
                <div className="space-y-1.5">
                  {profile.registrations.slice(0, 6).map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-xs">
                      <span className="text-ink2">{r.webinar_id}</span>
                      <span className="text-muted">{r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN") : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Update</p>
              <select className="input mt-2" value={status} onChange={(e) => setStatus(e.target.value)}>
                {["new", "contacted", "registered", "converted", "enrolled", "closed"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <textarea className="input mt-2 min-h-[70px]" placeholder="Internal notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <button onClick={save} disabled={saving} className="btn btn-primary mt-2 w-full text-sm">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== CONVERSATIONS ============================== */
interface Conversation {
  id: string;
  session_id: string | null;
  provider: string;
  status: string;
  message_count: number;
  summary: string | null;
  last_message_at: string;
}

function ConversationsTab() {
  const [rows, setRows] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/ai-agent/conversations")
      .then((r) => r.json())
      .then((d) => d.ok && setRows(d.conversations))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((c) => (c.summary || "").toLowerCase().includes(s) || (c.session_id || "").toLowerCase().includes(s));
  }, [rows, q]);

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <input className="input mb-4 max-w-md" placeholder="Search summaries / session id…" value={q} onChange={(e) => setQ(e.target.value)} />
      {filtered.length === 0 ? (
        <EmptyCard title="No conversations" hint="Redacted conversation summaries will appear here." />
      ) : (
        <TableShell headers={["Session", "Msgs", "Status", "Last message", ""]}>
          {filtered.map((c) => (
            <tr key={c.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface" onClick={() => setOpenId(c.id)}>
              <td className="px-4 py-3">
                <div className="font-mono text-xs text-ink2">{(c.session_id || c.id).slice(0, 14)}…</div>
                {c.summary && <div className="mt-0.5 line-clamp-1 max-w-md text-xs text-muted">{c.summary}</div>}
              </td>
              <td className="px-4 py-3 tabular-nums text-ink2">{c.message_count}</td>
              <td className="px-4 py-3 text-ink2">{c.status}</td>
              <td className="px-4 py-3 text-ink2">{new Date(c.last_message_at).toLocaleString("en-IN")}</td>
              <td className="px-4 py-3 text-right text-primary">View →</td>
            </tr>
          ))}
        </TableShell>
      )}
      {openId && <ConversationDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ConversationDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [convo, setConvo] = useState<Conversation | null>(null);
  const [events, setEvents] = useState<{ id: string; event_type: string | null; payload: Record<string, unknown>; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/ai-agent/conversations?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setConvo(d.conversation);
          setEvents(d.events || []);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="font-heading text-base font-bold">Conversation</p>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink2 hover:bg-surface">✕</button>
        </div>
        {loading ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : (
          <div className="space-y-3 p-4">
            {convo?.summary && (
              <div className="rounded-xl bg-surface p-3 text-sm text-ink2 whitespace-pre-wrap">{convo.summary}</div>
            )}
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Events (redacted)</p>
            {events.length === 0 ? (
              <p className="text-sm text-muted">No events.</p>
            ) : (
              events.map((e) => (
                <div key={e.id} className="rounded-lg border border-line px-3 py-2 text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium text-ink">{e.event_type}</span>
                    <span className="text-muted">{new Date(e.created_at).toLocaleTimeString("en-IN")}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== FOLLOW-UPS ============================== */
interface Followup {
  id: string;
  lead_id: string | null;
  type: string | null;
  channel: string | null;
  status: string;
  scheduled_for: string | null;
  created_at: string;
}

function FollowupsTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Followup[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = status ? `?status=${encodeURIComponent(status)}` : "";
      const res = await fetch(`/api/admin/ai-agent/followups${q}`).then((r) => r.json());
      if (res.ok) setRows(res.followups);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(id: string, next: string) {
    try {
      const res = await fetch("/api/admin/ai-agent/followups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: next }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "Failed.");
      toast(`Marked ${next}.`, "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <select className="input max-w-[200px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="done">Done</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <span className="rounded-lg bg-surface px-3 py-1.5 text-xs text-muted">Auto-send is OFF (admin-controlled)</span>
      </div>
      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyCard title="No follow-ups" hint="Create follow-ups from a lead profile." />
      ) : (
        <TableShell headers={["Type", "Channel", "Status", "Created", "Actions"]}>
          {rows.map((f) => (
            <tr key={f.id} className="border-b border-line last:border-0">
              <td className="px-4 py-3 text-ink">{f.type || "manual"}</td>
              <td className="px-4 py-3 text-ink2">{f.channel || "—"}</td>
              <td className="px-4 py-3"><span className={`pill ${f.status === "pending" ? "pill-amber" : f.status === "done" ? "pill-green" : "pill-gray"}`}>{f.status}</span></td>
              <td className="px-4 py-3 text-ink2">{new Date(f.created_at).toLocaleDateString("en-IN")}</td>
              <td className="px-4 py-3">
                {f.status === "pending" && (
                  <div className="flex gap-1.5 text-xs">
                    <button className="btn btn-ghost h-8 min-h-0 px-2 py-1" onClick={() => update(f.id, "done")}>Done</button>
                    <button className="btn btn-ghost h-8 min-h-0 px-2 py-1 text-danger" onClick={() => update(f.id, "cancelled")}>Cancel</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </TableShell>
      )}
    </div>
  );
}

/* ============================== SETTINGS ============================== */
interface AgentSettings {
  tone: string;
  primary_cta: string;
  offer_priority: string;
  retention_days: number;
  require_marketing_consent: boolean;
  frequency: { min_delay_s: number; max_delay_s: number; scroll_pct: number; dismiss_suppress_h: number };
  enabled_pages: string[];
}

const DEFAULT_SETTINGS: AgentSettings = {
  tone: "warm_mentor",
  primary_cta: "callback",
  offer_priority: "webinar_first",
  retention_days: 180,
  require_marketing_consent: true,
  frequency: { min_delay_s: 8, max_delay_s: 15, scroll_pct: 30, dismiss_suppress_h: 24 },
  enabled_pages: ["/", "/courses", "/webinars", "/resources", "/current-affairs"],
};

function SettingsTab() {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/ai-agent/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          const row = (d.settings || []).find((s: { key: string; value: unknown }) => s.key === "config");
          if (row?.value) setCfg({ ...DEFAULT_SETTINGS, ...(row.value as Partial<AgentSettings>) });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/ai-agent/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "config", value: cfg }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "Save failed.");
      toast("Settings saved.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingBlock />;

  return (
    <div className="max-w-2xl space-y-5">
      <div className="rounded-xl border border-line bg-surface px-4 py-3 text-xs text-ink2">
        Master switches (public widget on/off, provider, auto-follow-up sending) are controlled by <strong>environment variables</strong> and stay in the code owner&apos;s hands. These settings tune agent behaviour and copy.
      </div>

      <div className="card space-y-3 p-5">
        <p className="font-heading text-base font-bold">Behaviour</p>
        <Field label="Tone">
          <select className="input" value={cfg.tone} onChange={(e) => setCfg({ ...cfg, tone: e.target.value })}>
            <option value="warm_mentor">Warm mentor</option>
            <option value="concise">Concise</option>
            <option value="formal">Formal</option>
          </select>
        </Field>
        <Field label="Primary CTA">
          <select className="input" value={cfg.primary_cta} onChange={(e) => setCfg({ ...cfg, primary_cta: e.target.value })}>
            <option value="callback">Counsellor callback</option>
            <option value="webinar">Webinar registration</option>
            <option value="resources">Free resources</option>
          </select>
        </Field>
        <Field label="Offer priority">
          <select className="input" value={cfg.offer_priority} onChange={(e) => setCfg({ ...cfg, offer_priority: e.target.value })}>
            <option value="webinar_first">Webinar first</option>
            <option value="course_first">Course first</option>
          </select>
        </Field>
      </div>

      <div className="card space-y-3 p-5">
        <p className="font-heading text-base font-bold">Triggers & frequency</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min delay (s)"><NumberInput value={cfg.frequency.min_delay_s} onChange={(v) => setCfg({ ...cfg, frequency: { ...cfg.frequency, min_delay_s: v } })} /></Field>
          <Field label="Max delay (s)"><NumberInput value={cfg.frequency.max_delay_s} onChange={(v) => setCfg({ ...cfg, frequency: { ...cfg.frequency, max_delay_s: v } })} /></Field>
          <Field label="Scroll trigger (%)"><NumberInput value={cfg.frequency.scroll_pct} onChange={(v) => setCfg({ ...cfg, frequency: { ...cfg.frequency, scroll_pct: v } })} /></Field>
          <Field label="Dismiss suppress (h)"><NumberInput value={cfg.frequency.dismiss_suppress_h} onChange={(v) => setCfg({ ...cfg, frequency: { ...cfg.frequency, dismiss_suppress_h: v } })} /></Field>
        </div>
      </div>

      <div className="card space-y-3 p-5">
        <p className="font-heading text-base font-bold">Privacy & retention</p>
        <Field label="Retention (days)"><NumberInput value={cfg.retention_days} onChange={(v) => setCfg({ ...cfg, retention_days: v })} /></Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cfg.require_marketing_consent} onChange={(e) => setCfg({ ...cfg, require_marketing_consent: e.target.checked })} />
          Require marketing consent before phone capture
        </label>
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? "Saving…" : "Save settings"}</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink2">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      className="input"
      value={value}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        onChange(Number.isFinite(n) ? n : 0);
      }}
    />
  );
}

/* ============================== OFFER AWARENESS ============================== */
interface LiveOffer {
  type: string;
  id: string;
  title: string;
  mode: string | null;
  price: number;
  duration: string | null;
  link: string;
}

function OffersTab() {
  const [courses, setCourses] = useState<LiveOffer[]>([]);
  const [webinars, setWebinars] = useState<LiveOffer[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/ai-agent/offer-awareness")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setCourses(d.offers.courses || []);
          setWebinars(d.offers.webinars || []);
          setWarnings(d.warnings || []);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingBlock />;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-surface px-4 py-3 text-xs text-ink2">
        These are the ONLY offers the agent can talk about — live courses (published &amp; active) and webinars currently OPEN for registration. It never pitches anything not shown here.
      </div>
      {warnings.map((w, i) => (
        <div key={i} className="rounded-xl border border-[var(--warning)] bg-[#fef3e2] px-4 py-3 text-sm text-[#8a5a00]">{w}</div>
      ))}
      <OfferList title={`Webinars open now (${webinars.length})`} offers={webinars} />
      <OfferList title={`Live courses (${courses.length})`} offers={courses} />
    </div>
  );
}

function OfferList({ title, offers }: { title: string; offers: LiveOffer[] }) {
  return (
    <div>
      <p className="mb-2 font-heading text-sm font-bold">{title}</p>
      {offers.length === 0 ? (
        <p className="text-sm text-muted">None live right now.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {offers.map((o) => (
            <a key={o.id} href={o.link} target="_blank" rel="noopener noreferrer" className="card p-3 hover:border-primary">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">{o.title}</span>
                <span className="text-sm font-bold" style={{ color: "var(--gold, #b8860b)" }}>{o.price > 0 ? `₹${o.price.toLocaleString("en-IN")}` : "Free"}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted">{[o.mode, o.duration].filter(Boolean).join(" · ") || "—"}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================== SECURITY ============================== */
interface AuditRow {
  id: string;
  actor: string | null;
  action: string | null;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  created_at: string;
}

function SecurityTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/ai-agent/audit")
      .then((r) => r.json())
      .then((d) => d.ok && setRows(d.logs))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <div className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-xs text-ink2">
        Append-only audit of sensitive actions (lead PII reads, settings changes, follow-up edits). Rows are redacted at write time.
      </div>
      {rows.length === 0 ? (
        <EmptyCard title="No audit entries" hint="Sensitive admin actions will be logged here." />
      ) : (
        <TableShell headers={["Action", "Actor", "Target", "IP", "When"]}>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0">
              <td className="px-4 py-3 font-medium text-ink">{r.action}</td>
              <td className="px-4 py-3 text-ink2">{r.actor}</td>
              <td className="px-4 py-3 text-ink2">{[r.target_type, r.target_id].filter(Boolean).join(":") || "—"}</td>
              <td className="px-4 py-3 font-mono text-xs text-muted">{r.ip || "—"}</td>
              <td className="px-4 py-3 text-ink2">{new Date(r.created_at).toLocaleString("en-IN")}</td>
            </tr>
          ))}
        </TableShell>
      )}
    </div>
  );
}

/* ============================== SHARED ============================== */
function EmptyCard({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="font-heading text-lg font-bold">{title}</p>
      <p className="mt-1 text-sm text-ink2">{hint}</p>
    </div>
  );
}
