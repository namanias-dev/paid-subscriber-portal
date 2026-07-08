"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Download, FileText } from "lucide-react";
import { APPLICATION_STATUSES, APPLICATION_STATUS_LABELS } from "@/lib/careers/config";
import type { ApplicationStatus, CareerApplication } from "@/lib/careers/types";

export default function ApplicationDetail({
  open,
  onClose,
  application,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  application: CareerApplication | null;
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<ApplicationStatus>("new");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (application) {
      setStatus(application.status);
      setNotes(application.admin_notes || "");
    }
  }, [application]);

  if (!application) return null;

  async function save() {
    if (!application) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/careers/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, admin_notes: notes }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Save failed.");
      toast("Application updated.", "success");
      onUpdated();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const location = [application.city, application.state].filter(Boolean).join(", ") || "—";
  const customAnswers = Object.entries(application.answers || {});

  return (
    <Modal open={open} onClose={onClose} title={application.full_name} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink2">
          <span className="pill pill-blue">{application.position_title || "—"}</span>
          <span>Applied {new Date(application.created_at).toLocaleDateString("en-IN")}</span>
        </div>

        {/* Contact + core */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Info label="Phone" value={<a href={`tel:${application.phone}`} className="text-primary hover:underline">{application.phone}</a>} />
          <Info label="Email" value={<a href={`mailto:${application.email}`} className="text-primary hover:underline">{application.email}</a>} />
          <Info label="Location" value={location} />
          <Info label="Salary expectation" value={application.salary_expectation != null ? `₹${application.salary_expectation.toLocaleString("en-IN")}` : "—"} />
          <Info label="UPSC attempts" value={application.upsc_attempts ?? "—"} />
          <Info label="Interview attempts" value={application.interview_attempts ?? "—"} />
          {application.upsc_roll_number && <Info label="UPSC roll no" value={application.upsc_roll_number} />}
        </div>

        {application.subjects.length > 0 && (
          <div>
            <p className="label">Subjects</p>
            <div className="flex flex-wrap gap-1.5">
              {application.subjects.map((s) => (
                <span key={s} className="pill pill-gray">{s}</span>
              ))}
            </div>
          </div>
        )}

        {customAnswers.length > 0 && (
          <div>
            <p className="label">Other answers</p>
            <div className="space-y-1.5">
              {customAnswers.map(([k, v]) => (
                <div key={k} className="text-sm">
                  <span className="text-muted">{k}: </span>
                  <span className="text-ink">{Array.isArray(v) ? v.join(", ") : String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Files */}
        <div>
          <p className="label">Uploaded files</p>
          {application.files.length === 0 ? (
            <p className="text-sm text-muted">No files uploaded.</p>
          ) : (
            <div className="space-y-2">
              {application.files.map((f) => (
                <a
                  key={f.key}
                  href={`/api/admin/careers/applications/file?key=${encodeURIComponent(f.key)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-xl border border-line bg-surface2 px-3 py-2.5 hover:border-primary"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
                    <FileText size={16} className="shrink-0 text-primary" aria-hidden="true" />
                    <span className="truncate">{f.name}</span>
                    <span className="shrink-0 text-xs text-muted">({(f.field)})</span>
                  </span>
                  <Download size={16} className="ml-2 shrink-0 text-muted" aria-hidden="true" />
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Status + notes */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)}>
              {APPLICATION_STATUSES.map((s) => (
                <option key={s} value={s}>{APPLICATION_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Internal notes</label>
          <textarea className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes visible only to the hiring team." />
        </div>

        {application.status_history.length > 0 && (
          <div>
            <p className="label">History</p>
            <ul className="space-y-1 text-xs text-ink2">
              {application.status_history.map((h, i) => (
                <li key={i}>
                  <span className="font-semibold">{APPLICATION_STATUS_LABELS[h.status] || h.status}</span>
                  {h.by ? ` by ${h.by}` : ""} · {new Date(h.at).toLocaleString("en-IN")}
                  {h.note ? ` — ${h.note}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-3">
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={saving}>Close</button>
          <button type="button" className="btn btn-primary flex-1" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm text-ink">{value}</p>
    </div>
  );
}
