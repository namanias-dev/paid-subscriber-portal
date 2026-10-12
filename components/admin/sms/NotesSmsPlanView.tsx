"use client";

import { AlertTriangle, CheckCircle2, Send } from "lucide-react";

export interface NotesPlanView {
  templateKey: string;
  dltTemplateId: string;
  dltType: string;
  variables: { slot: number; token: string; label: string; value: string | null }[];
  text: string | null;
  destination: string;
  customerName: string | null;
  source: { kind: string; orderNo?: string | null } | null;
  ok: boolean;
  hold: string | null;
  holdText: string | null;
  blockers: { code: string; text: string }[];
}

/** Server-built dry run: what would be sent, to whom, and why it can or cannot be. */
export default function NotesSmsPlanView({ plan, busy, onSend }: { plan: NotesPlanView; busy?: boolean; onSend?: () => void }) {
  return (
    <div className="space-y-2 rounded-xl border border-line p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {plan.ok
          ? <span className="pill pill-green"><CheckCircle2 size={12} /> Validator: pass</span>
          : <span className="pill pill-amber"><AlertTriangle size={12} /> Not sendable</span>}
        <span className="text-muted">
          {plan.templateKey} · DLT <span className="font-mono">{plan.dltTemplateId}</span> · to <span className="font-mono">{plan.destination}</span>
          {plan.source?.orderNo ? <> · {plan.source.orderNo}</> : null}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {plan.variables.map((v) => (
          <div key={v.slot} className="contents">
            <dt className="text-muted">{v.slot}. {v.label}</dt>
            <dd className="font-mono text-ink break-words">{v.value ?? "—"}</dd>
          </div>
        ))}
      </dl>
      {plan.text && <p className="rounded-lg bg-surface p-2.5 font-mono leading-relaxed text-ink break-words">{plan.text}</p>}
      {plan.holdText && <p className="leading-relaxed text-amber-800">{plan.holdText}</p>}
      {plan.blockers.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-amber-800">
          {plan.blockers.map((b) => <li key={b.code}>{b.text}</li>)}
        </ul>
      )}
      {onSend && (
        <button type="button" disabled={!plan.ok || busy} onClick={onSend} className="btn btn-primary min-h-11 text-sm">
          <Send size={14} /> Send this SMS
        </button>
      )}
    </div>
  );
}
