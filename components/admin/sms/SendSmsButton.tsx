"use client";

import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface TemplateLite { id: string; name: string; status: string; gateway_template_id: string | null; message_type: string }

/**
 * Reusable per-record "Send SMS" action. Drop it on any admin row that has a
 * phone (payments, leads, registrations, proof, student/user, webinar). Sends a
 * single Approved/Active template to one person via the central service (caps,
 * dedupe and DLT gating all enforced server-side). No dead state — disabled with
 * a clear reason when nothing is sendable.
 */
export default function SendSmsButton({
  phone, name, className = "", label = "SMS",
}: { phone: string | null | undefined; name?: string | null; className?: string; label?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateLite[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [preview, setPreview] = useState<{ text: string; length: number; segments: number; ok: boolean; missing: string[]; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/admin/sms/templates").then((r) => r.json()).then((d) => {
      if (d.ok) setTemplates((d.templates as TemplateLite[]).filter((t) => (t.status === "active" || t.status === "approved") && t.gateway_template_id));
    }).catch(() => {});
  }, [open]);

  async function doPreview(id: string) {
    setTemplateId(id); setPreview(null);
    if (!id) return;
    const r = await fetch("/api/admin/sms/audience", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId: id, audience: { type: "person", mobile: phone, name } }) }).then((x) => x.json());
    if (r.ok && r.preview) setPreview(r.preview);
  }

  async function send() {
    if (!templateId) return;
    setBusy(true);
    const r = await fetch("/api/admin/sms/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, audience: { type: "person", mobile: phone, name } }) }).then((x) => x.json());
    setBusy(false);
    if (r.ok && r.sent) { toast("SMS sent.", "success"); setOpen(false); setPreview(null); setTemplateId(""); }
    else toast(r.ok ? `Not sent (${Object.keys(r.skipped || {})[0] || "skipped"}).` : (r.error || "Send failed"), "error");
  }

  if (!phone) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className || "inline-flex items-center gap-1 text-xs text-primary hover:opacity-80"} title="Send SMS">
        <MessageSquare size={14} /> {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold">Send SMS{name ? ` to ${name}` : ""}</h3>
            <p className="mt-0.5 font-mono text-xs text-muted">{phone}</p>
            <div className="mt-3">
              <select className="input" value={templateId} onChange={(e) => doPreview(e.target.value)}>
                <option value="">Select a template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.message_type === "promotional" ? " · promo" : ""}</option>)}
              </select>
              {templates.length === 0 && <p className="mt-1 text-xs text-amber-700">No Approved/Active templates. Activate one (with a DLT id) in SMS Mission Control → Templates.</p>}
            </div>
            {preview && (
              <div className="mt-3 rounded-xl bg-surface p-3 text-sm">
                <p className="whitespace-pre-wrap">{preview.text}</p>
                <p className="mt-2 text-xs text-muted">{preview.length} chars · {preview.segments} segment(s)</p>
                {preview.missing?.length > 0 && <p className="mt-1 text-xs text-amber-700">Missing: {preview.missing.join(", ")}</p>}
                {preview.errors?.length > 0 && <p className="mt-1 text-xs text-danger">{preview.errors.join("; ")}</p>}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="btn btn-secondary text-sm">Cancel</button>
              <button onClick={send} disabled={busy || !templateId} className="btn btn-primary text-sm">{busy ? "…" : "Send"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
