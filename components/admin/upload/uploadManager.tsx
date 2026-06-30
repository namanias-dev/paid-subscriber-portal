"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * ============================================================================
 *  RESILIENT BACKGROUND UPLOAD MANAGER (client) — multipart, resumable,
 *  pausable, network-failure-safe. Bytes go browser→R2 directly via presigned
 *  PUTs; our server only mints URLs + orchestrates multipart. Upload state is
 *  persisted to localStorage so it survives refresh/crash; resume re-checks R2
 *  (ListParts) and uploads only the MISSING chunks. Runs in a single global
 *  provider so uploads continue across in-app navigation.
 * ============================================================================
 */

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB parts
const CONCURRENCY = 3;
const MAX_RETRIES = 5;
const STORE_KEY = "naman_uploads_v1";

export type UploadStatus =
  | "queued" | "uploading" | "paused" | "retrying" | "completed" | "failed" | "resumable";

interface PartRef { partNumber: number; etag: string }

export type UploadTarget = "lecture" | "webinar";

export interface UploadItem {
  recordingId: string;
  title: string;
  courseId: string;
  /** Which entity this upload populates. "lecture" (default) → content_items; "webinar" → webinars.recording_key. */
  target?: UploadTarget;
  fileName: string;
  fileSize: number;
  chunkSize: number;
  totalParts: number;
  completed: PartRef[];
  status: UploadStatus;
  bytesUploaded: number;
  speedBps: number;
  etaSeconds: number | null;
  error?: string;
  durationSeconds?: number | null;
  resolution?: string | null;
  /** Descriptor restored after a reload but the File bytes are gone — needs re-select. */
  needsFile?: boolean;
  /** Cancel may delete the record (true = freshly-created draft) or just reset it (false = existing recording). */
  deletable?: boolean;
}

interface Ctrl { paused: boolean; cancelled: boolean; running: boolean; samples: { t: number; b: number }[] }

interface UploadManagerCtx {
  items: UploadItem[];
  minimized: boolean;
  setMinimized: (v: boolean) => void;
  startUpload: (opts: { recordingId: string; title: string; courseId: string; file: File; durationSeconds?: number | null; resolution?: string | null; deletable?: boolean; target?: UploadTarget }) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => Promise<void>;
  retry: (id: string) => void;
  attachFile: (id: string, file: File) => void;
  dismiss: (id: string) => void;
}

const Ctx = createContext<UploadManagerCtx | null>(null);
export function useUploadManager(): UploadManagerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUploadManager must be used within UploadManagerProvider");
  return ctx;
}

async function api<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function UploadManagerProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [minimized, setMinimized] = useState(false);
  const files = useRef<Map<string, File>>(new Map());
  const ctrls = useRef<Map<string, Ctrl>>(new Map());
  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;

  // ---- persistence (descriptors only; File can't be serialized) ----
  const persist = useCallback((list: UploadItem[]) => {
    try {
      const slim = list
        .filter((i) => i.status !== "completed")
        .map(({ ...i }) => ({ ...i, speedBps: 0, etaSeconds: null }));
      localStorage.setItem(STORE_KEY, JSON.stringify(slim));
    } catch { /* ignore quota */ }
  }, []);

  const update = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => {
      const next = prev.map((i) => (i.recordingId === id ? { ...i, ...patch } : i));
      persist(next);
      return next;
    });
  }, [persist]);

  // Restore in-progress uploads after a reload → they need the file re-attached.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as UploadItem[];
      if (Array.isArray(saved) && saved.length) {
        setItems(saved.map((i) => ({ ...i, status: "resumable", needsFile: true, speedBps: 0, etaSeconds: null })));
        setMinimized(false);
      }
    } catch { /* ignore */ }
  }, []);

  // Warn before leaving while an upload is active (resumable design makes it recoverable).
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (itemsRef.current.some((i) => i.status === "uploading" || i.status === "retrying")) {
        e.preventDefault();
        e.returnValue = "Upload in progress — leave anyway?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const recordSpeed = useCallback((id: string, addedBytes: number) => {
    const ctrl = ctrls.current.get(id);
    if (!ctrl) return;
    const now = Date.now();
    ctrl.samples.push({ t: now, b: addedBytes });
    while (ctrl.samples.length && now - ctrl.samples[0].t > 8000) ctrl.samples.shift();
    const span = (now - (ctrl.samples[0]?.t ?? now)) / 1000 || 1;
    const bytes = ctrl.samples.reduce((s, x) => s + x.b, 0);
    const speed = bytes / span;
    const item = itemsRef.current.find((i) => i.recordingId === id);
    const remaining = item ? item.fileSize - item.bytesUploaded : 0;
    update(id, { speedBps: speed, etaSeconds: speed > 0 ? Math.round(remaining / speed) : null });
  }, [update]);

  const putPart = useCallback(async (id: string, key: string, uploadId: string, partNumber: number, file: File): Promise<PartRef> => {
    const start = (partNumber - 1) * CHUNK_SIZE;
    const blob = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
    let attempt = 0;
    for (;;) {
      const ctrl = ctrls.current.get(id);
      if (ctrl?.cancelled) throw new Error("cancelled");
      if (ctrl?.paused) throw new Error("paused");
      try {
        const { url } = await api<{ url: string }>("/api/admin/lectures/upload/sign-part", { key, uploadId, partNumber });
        const res = await fetch(url, { method: "PUT", body: blob });
        if (!res.ok) throw new Error(`part ${partNumber} → ${res.status}`);
        const etag = (res.headers.get("ETag") || res.headers.get("etag") || "").replaceAll('"', "");
        if (!etag) throw new Error("missing ETag (check R2 CORS ExposeHeaders)");
        recordSpeed(id, blob.size);
        return { partNumber, etag: `"${etag}"` };
      } catch (err) {
        if ((err as Error).message === "cancelled" || (err as Error).message === "paused") throw err;
        attempt += 1;
        if (attempt > MAX_RETRIES) throw err;
        update(id, { status: "retrying" });
        if (!navigator.onLine) { await waitForOnline(ctrl); }
        await sleep(Math.min(1000 * 2 ** attempt, 15000)); // exponential backoff (cap 15s)
      }
    }
  }, [recordSpeed, update]);

  const run = useCallback(async (id: string) => {
    const ctrl = ctrls.current.get(id);
    const file = files.current.get(id);
    if (!ctrl || !file || ctrl.running) return;
    ctrl.running = true;
    ctrl.paused = false;
    ctrl.cancelled = false;
    update(id, { status: "uploading", error: undefined, needsFile: false });

    try {
      let item = itemsRef.current.find((i) => i.recordingId === id);
      if (!item) return;

      // 1) Ensure the R2 multipart exists (create on first run).
      const target: UploadTarget = item.target === "webinar" ? "webinar" : "lecture";
      let key = ""; let uploadId = "";
      const partsInfo = await fetch(`/api/admin/lectures/upload/parts?recordingId=${id}&target=${target}`).then((r) => r.json()).catch(() => null);
      if (partsInfo?.uploadId && partsInfo?.key) {
        key = partsInfo.key; uploadId = partsInfo.uploadId;
      } else {
        const created = await api<{ uploadId: string; key: string }>("/api/admin/lectures/upload/create", {
          recordingId: id, totalParts: item.totalParts, chunkSize: item.chunkSize, fileSize: item.fileSize,
          durationSeconds: item.durationSeconds, resolution: item.resolution, target,
        });
        key = created.key; uploadId = created.uploadId;
      }

      // 2) Reconcile already-uploaded parts (R2 = source of truth) → upload only missing.
      const r2Parts: PartRef[] = (partsInfo?.parts as PartRef[]) || [];
      const done = new Map<number, PartRef>();
      for (const p of [...item.completed, ...r2Parts]) done.set(p.partNumber, p);
      const completedBytes = [...done.keys()].reduce((s, n) => s + Math.min(CHUNK_SIZE, file.size - (n - 1) * CHUNK_SIZE), 0);
      update(id, { completed: [...done.values()], bytesUploaded: completedBytes });

      const missing: number[] = [];
      for (let n = 1; n <= item.totalParts; n++) if (!done.has(n)) missing.push(n);

      // 3) Bounded-concurrency worker pool uploading missing chunks.
      let cursor = 0;
      const worker = async () => {
        for (;;) {
          const c = ctrls.current.get(id);
          if (c?.cancelled || c?.paused) return;
          const myIndex = cursor++;
          if (myIndex >= missing.length) return;
          const partNumber = missing[myIndex];
          const ref = await putPart(id, key, uploadId, partNumber, file);
          done.set(partNumber, ref);
          const cur = itemsRef.current.find((i) => i.recordingId === id);
          const bytes = (cur?.bytesUploaded ?? 0) + Math.min(CHUNK_SIZE, file.size - (partNumber - 1) * CHUNK_SIZE);
          update(id, { completed: [...done.values()], bytesUploaded: bytes, status: "uploading" });
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));

      const c = ctrls.current.get(id);
      if (c?.cancelled) return;
      if (c?.paused) { update(id, { status: "paused" }); return; }

      // 4) All parts present → complete.
      item = itemsRef.current.find((i) => i.recordingId === id);
      if (item && done.size >= item.totalParts) {
        await api("/api/admin/lectures/upload/complete", {
          recordingId: id, parts: [...done.values()],
          durationSeconds: item.durationSeconds, resolution: item.resolution, fileSize: item.fileSize, target,
        });
        update(id, { status: "completed", bytesUploaded: item.fileSize, speedBps: 0, etaSeconds: 0 });
        files.current.delete(id);
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "paused") update(id, { status: "paused" });
      else if (msg === "cancelled") { /* handled in cancel() */ }
      else update(id, { status: "failed", error: msg });
    } finally {
      const c = ctrls.current.get(id);
      if (c) c.running = false;
    }
  }, [putPart, update]);

  const startUpload = useCallback<UploadManagerCtx["startUpload"]>((opts) => {
    const totalParts = Math.max(1, Math.ceil(opts.file.size / CHUNK_SIZE));
    files.current.set(opts.recordingId, opts.file);
    ctrls.current.set(opts.recordingId, { paused: false, cancelled: false, running: false, samples: [] });
    const item: UploadItem = {
      recordingId: opts.recordingId,
      title: opts.title,
      courseId: opts.courseId,
      target: opts.target ?? "lecture",
      fileName: opts.file.name,
      fileSize: opts.file.size,
      chunkSize: CHUNK_SIZE,
      totalParts,
      completed: [],
      status: "uploading",
      bytesUploaded: 0,
      speedBps: 0,
      etaSeconds: null,
      durationSeconds: opts.durationSeconds ?? null,
      resolution: opts.resolution ?? null,
      deletable: opts.deletable ?? true,
    };
    // Update the ref SYNCHRONOUSLY so the first run() (scheduled below) finds the
    // item immediately — otherwise it races the React re-render that refreshes
    // itemsRef and bails on `!item`, leaving "Uploading 0%" until pause+resume.
    const next = [...itemsRef.current.filter((i) => i.recordingId !== opts.recordingId), item];
    itemsRef.current = next;
    setItems(next);
    persist(next);
    setMinimized(false);
    setTimeout(() => run(opts.recordingId), 0);
  }, [persist, run]);

  const pause = useCallback((id: string) => {
    const c = ctrls.current.get(id);
    if (c) c.paused = true;
    update(id, { status: "paused", speedBps: 0, etaSeconds: null });
  }, [update]);

  const resume = useCallback((id: string) => {
    if (!files.current.get(id)) { update(id, { status: "resumable", needsFile: true }); return; }
    let c = ctrls.current.get(id);
    if (!c) { c = { paused: false, cancelled: false, running: false, samples: [] }; ctrls.current.set(id, c); }
    c.paused = false;
    run(id);
  }, [run, update]);

  const retry = resume;

  const attachFile = useCallback((id: string, file: File) => {
    files.current.set(id, file);
    if (!ctrls.current.get(id)) ctrls.current.set(id, { paused: false, cancelled: false, running: false, samples: [] });
    update(id, { needsFile: false, fileName: file.name });
    run(id);
  }, [run, update]);

  const cancel = useCallback(async (id: string) => {
    const c = ctrls.current.get(id);
    if (c) c.cancelled = true;
    const found = itemsRef.current.find((i) => i.recordingId === id);
    const deletable = found?.deletable ?? false;
    const target: UploadTarget = found?.target === "webinar" ? "webinar" : "lecture";
    await api("/api/admin/lectures/upload/abort", { recordingId: id, deleteRecord: deletable, target }).catch(() => {});
    files.current.delete(id);
    ctrls.current.delete(id);
    setItems((prev) => {
      const next = prev.filter((i) => i.recordingId !== id);
      persist(next);
      return next;
    });
  }, [persist]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.recordingId !== id);
      persist(next);
      return next;
    });
    files.current.delete(id);
    ctrls.current.delete(id);
  }, [persist]);

  // Auto-resume on regained connectivity.
  useEffect(() => {
    const onOnline = () => {
      for (const i of itemsRef.current) {
        if ((i.status === "retrying" || i.status === "failed") && files.current.get(i.recordingId)) resume(i.recordingId);
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [resume]);

  return (
    <Ctx.Provider value={{ items, minimized, setMinimized, startUpload, pause, resume, cancel, retry, attachFile, dismiss }}>
      {children}
    </Ctx.Provider>
  );
}

function waitForOnline(ctrl?: Ctrl): Promise<void> {
  if (navigator.onLine) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (navigator.onLine || ctrl?.cancelled) { window.removeEventListener("online", check); resolve(); }
    };
    window.addEventListener("online", check);
    setTimeout(check, 3000);
  });
}
