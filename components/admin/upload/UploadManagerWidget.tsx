"use client";

import { useRef } from "react";
import { Pause, Play, X, RotateCcw, CheckCircle2, AlertTriangle, UploadCloud, ChevronDown, ChevronUp, FileVideo } from "lucide-react";
import { useUploadManager, type UploadItem } from "./uploadManager";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
function fmtEta(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

const STATUS_LABEL: Record<UploadItem["status"], string> = {
  queued: "Queued", uploading: "Uploading", paused: "Paused", retrying: "Retrying…",
  completed: "Completed", failed: "Failed", resumable: "Resume needed",
};

export default function UploadManagerWidget() {
  const { items, minimized, setMinimized, pause, resume, cancel, retry, attachFile, dismiss } = useUploadManager();
  if (items.length === 0) return null;

  const active = items.filter((i) => i.status === "uploading" || i.status === "retrying").length;

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[min(92vw,380px)]">
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.45)]">
        <button
          type="button"
          onClick={() => setMinimized(!minimized)}
          className="flex w-full items-center justify-between gap-2 bg-gradient-to-r from-[#0b1437] to-[#13225a] px-4 py-3 text-left text-white"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <UploadCloud size={16} className="text-[var(--ca-gold)]" />
            {active > 0 ? `Uploading ${active} lecture${active > 1 ? "s" : ""}` : `Uploads (${items.length})`}
          </span>
          {minimized ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {!minimized && (
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {items.map((i) => <Row key={i.recordingId} item={i} {...{ pause, resume, cancel, retry, attachFile, dismiss }} />)}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({
  item, pause, resume, cancel, retry, attachFile, dismiss,
}: {
  item: UploadItem;
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => Promise<void>;
  retry: (id: string) => void;
  attachFile: (id: string, f: File) => void;
  dismiss: (id: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const pct = item.fileSize ? Math.min(100, Math.round((item.bytesUploaded / item.fileSize) * 100)) : 0;
  const speedMBs = item.speedBps ? (item.speedBps / 1024 ** 2).toFixed(2) : "0.00";
  const isActive = item.status === "uploading" || item.status === "retrying";

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface2 text-ink2"><FileVideo size={15} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-semibold text-ink" title={item.title || item.fileName}>{item.title || item.fileName}</p>
            <StatusPill status={item.status} />
          </div>

          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface2">
            <div
              className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${item.status === "completed" ? "bg-success" : item.status === "failed" ? "bg-danger" : "bg-gradient-to-r from-[var(--ca-gold-bright)] to-[var(--ca-gold)]"}`}
              style={{ width: `${item.status === "completed" ? 100 : pct}%` }}
            />
          </div>

          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
            <span>{fmtBytes(item.bytesUploaded)} / {fmtBytes(item.fileSize)} · {pct}%</span>
            {isActive && <span>{speedMBs} MB/s · ETA {fmtEta(item.etaSeconds)}</span>}
          </div>

          {item.status === "resumable" && item.needsFile && (
            <div className="mt-2">
              <p className="text-[11px] text-amber-700">Re-select this file to resume only the missing parts.</p>
              <input
                ref={fileInput}
                type="file"
                accept="video/mp4,video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size !== item.fileSize) { alert("That file doesn't match the original size — pick the same file."); return; }
                  attachFile(item.recordingId, f);
                }}
              />
              <button onClick={() => fileInput.current?.click()} className="btn btn-secondary mt-1 text-xs"><RotateCcw size={13} /> Choose file & resume</button>
            </div>
          )}

          {item.status === "failed" && item.error && (
            <p className="mt-1 truncate text-[11px] text-danger" title={item.error}>{item.error}</p>
          )}

          <div className="mt-2 flex items-center gap-2">
            {item.status === "uploading" && <IconBtn onClick={() => pause(item.recordingId)} title="Pause"><Pause size={14} /></IconBtn>}
            {(item.status === "paused" || item.status === "retrying") && <IconBtn onClick={() => resume(item.recordingId)} title="Resume"><Play size={14} /></IconBtn>}
            {item.status === "failed" && <IconBtn onClick={() => retry(item.recordingId)} title="Retry"><RotateCcw size={14} /></IconBtn>}
            {item.status === "completed" ? (
              <button onClick={() => dismiss(item.recordingId)} className="ml-auto text-xs font-semibold text-success">Done</button>
            ) : (
              <button
                onClick={() => { if (confirm("Cancel this upload? Uploaded parts will be discarded and the draft removed.")) cancel(item.recordingId); }}
                className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-danger"
              >
                <X size={13} /> Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink2 hover:border-[rgba(212,175,55,0.6)] hover:text-ink">
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: UploadItem["status"] }) {
  const map: Record<UploadItem["status"], string> = {
    queued: "pill-gray", uploading: "pill-blue", paused: "pill-amber", retrying: "pill-amber",
    completed: "pill-green", failed: "pill-red", resumable: "pill-amber",
  };
  return (
    <span className={`pill ${map[status]} shrink-0 text-[10px]`}>
      {status === "completed" && <CheckCircle2 size={10} />}
      {status === "failed" && <AlertTriangle size={10} />}
      {STATUS_LABEL[status]}
    </span>
  );
}
