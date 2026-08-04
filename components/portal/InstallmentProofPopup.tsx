"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Calendar, Check, FileText, ImageIcon, Upload, X } from "lucide-react";
import { formatINR } from "@/lib/dates";
import type {
  InstallmentProofFileMeta,
  InstallmentProofPromptProps,
} from "@/lib/installmentProofTypes";

const H24 = 24 * 60 * 60 * 1000;
const MAX_FILES = 3;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);
const ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.pdf,.jpg,.jpeg,.png,.webp,.heic";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

type Slide = "main" | "upload" | "view";

interface LocalFile {
  id: string;
  file: File;
  preview: string | null;
  uploaded?: InstallmentProofFileMeta;
}

interface PromptResponse {
  ok: boolean;
  enabled?: boolean;
  prompt?: InstallmentProofPromptProps | null;
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function isWithin24h(ts: string | null): boolean {
  if (!ts) return false;
  const n = Number(ts);
  return Number.isFinite(n) && Date.now() - n < H24;
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function shouldShowPrompt(prompt: InstallmentProofPromptProps): boolean {
  if (prompt.state === "none") return false;
  if (prompt.state === "expiring") {
    if (isWithin24h(storageGet(`ipp_snooze_${prompt.enrollmentId}`))) return false;
    if (isWithin24h(storageGet(`ipp_expiring_seen_${prompt.enrollmentId}`))) return false;
    return true;
  }
  if (prompt.state === "blocked") {
    return sessionGet(`ipp_session_blocked_${prompt.enrollmentId}`) !== "1";
  }
  if (prompt.state === "pending_review") {
    const proofId = prompt.pendingProof?.id;
    if (!proofId) return true;
    if (isWithin24h(storageGet(`ipp_pending_seen_${proofId}`))) return false;
    return true;
  }
  return false;
}

function markShown(prompt: InstallmentProofPromptProps): void {
  if (prompt.state === "expiring") {
    storageSet(`ipp_expiring_seen_${prompt.enrollmentId}`, String(Date.now()));
  } else if (prompt.state === "pending_review" && prompt.pendingProof) {
    storageSet(`ipp_pending_seen_${prompt.pendingProof.id}`, String(Date.now()));
  }
}

function snoozeExpiring(enrollmentId: string): void {
  storageSet(`ipp_snooze_${enrollmentId}`, String(Date.now()));
}

function dismissBlocked(enrollmentId: string): void {
  sessionSet(`ipp_session_blocked_${enrollmentId}`, "1");
}

export default function InstallmentProofPopup() {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<InstallmentProofPromptProps | null>(null);
  const [slide, setSlide] = useState<Slide>("main");
  const [reduceMotion, setReduceMotion] = useState(true);
  const [mounted, setMounted] = useState(false);

  const [localFiles, setLocalFiles] = useState<LocalFile[]>([]);
  const [claimedAmount, setClaimedAmount] = useState("");
  const [claimedDate, setClaimedDate] = useState("");
  const [referenceUtr, setReferenceUtr] = useState("");
  const [studentComment, setStudentComment] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadDone, setUploadDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewProof, setViewProof] = useState<{
    files: InstallmentProofFileMeta[];
    submittedAt: string;
    reviewReason: string | null;
  } | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    setSlide("main");
    setLocalFiles((prev) => {
      prev.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
      return [];
    });
    setClaimedAmount("");
    setClaimedDate("");
    setReferenceUtr("");
    setStudentComment("");
    setUploadBusy(false);
    setUploadProgress(0);
    setUploadDone(false);
    setError(null);
    setViewProof(null);
  }, []);

  const handleDismiss = useCallback(() => {
    if (!prompt) {
      close();
      return;
    }
    if (prompt.state === "blocked") dismissBlocked(prompt.enrollmentId);
    close();
  }, [close, prompt]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portal/installment-proofs/prompt", { cache: "no-store" });
        const json = (await res.json()) as PromptResponse;
        if (cancelled || !json.ok || !json.enabled || !json.prompt) return;
        const p = json.prompt;
        if (p.state === "none" || !shouldShowPrompt(p)) return;
        markShown(p);
        setPrompt(p);
        setOpen(true);
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setMounted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("[data-ipp-autofocus]")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleDismiss();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null,
      );
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, handleDismiss, slide]);

  function goPay() {
    if (!prompt) return;
    window.location.href = prompt.payHref;
  }

  function remindLater() {
    if (!prompt) return;
    snoozeExpiring(prompt.enrollmentId);
    close();
  }

  function openUpload() {
    setSlide("upload");
    setError(null);
    setUploadDone(false);
    setUploadProgress(0);
  }

  async function openView() {
    if (!prompt?.pendingProof) return;
    setSlide("view");
    setViewLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/portal/installment-proofs?id=${encodeURIComponent(prompt.pendingProof.id)}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!json.ok || !json.proof) {
        setError("Could not load your submission.");
        return;
      }
      setViewProof({
        files: json.proof.files ?? [],
        submittedAt: json.proof.submitted_at ?? prompt.pendingProof.submittedAt,
        reviewReason: json.proof.review_reason ?? prompt.pendingProof.reviewReason,
      });
    } catch {
      setError("Could not load your submission.");
    } finally {
      setViewLoading(false);
    }
  }

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const remaining = MAX_FILES - localFiles.length;
    const chosen = Array.from(list).slice(0, remaining);
    const next: LocalFile[] = [];

    for (const file of chosen) {
      const type = file.type || "";
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const heic = ext === "heic" || ext === "heif";
      if (!ALLOWED_TYPES.has(type) && !heic) {
        setError("Please use PDF, JPG, PNG, WebP, or HEIC files.");
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError("Each file can be up to 10 MB.");
        continue;
      }
      const isImage = type.startsWith("image/") || heic;
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: isImage ? URL.createObjectURL(file) : null,
      });
    }

    if (next.length) setLocalFiles((prev) => [...prev, ...next].slice(0, MAX_FILES));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(id: string) {
    setLocalFiles((prev) => {
      const item = prev.find((f) => f.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((f) => f.id !== id);
    });
  }

  async function submitProof() {
    if (!prompt || !localFiles.length) {
      setError("Please attach at least one file.");
      return;
    }
    setUploadBusy(true);
    setError(null);
    setUploadProgress(0);

    const uploaded: InstallmentProofFileMeta[] = [];
    const total = localFiles.length;

    try {
      for (let i = 0; i < localFiles.length; i++) {
        const lf = localFiles[i]!;
        const form = new FormData();
        form.append("file", lf.file);
        form.append("installmentNo", String(prompt.installmentNo));
        const res = await fetch("/api/portal/installment-proofs", { method: "PUT", body: form });
        const json = await res.json();
        if (!json.ok || !json.file) {
          setError(json.error || "Upload failed. Please try again.");
          setUploadBusy(false);
          return;
        }
        uploaded.push(json.file as InstallmentProofFileMeta);
        setUploadProgress(Math.round(((i + 1) / total) * 85));
      }

      const body: Record<string, unknown> = {
        enrollmentId: prompt.enrollmentId,
        installmentNo: prompt.installmentNo,
        files: uploaded,
      };
      if (claimedAmount.trim()) body.claimedAmount = Number(claimedAmount);
      if (claimedDate) body.claimedPaidDate = claimedDate;
      if (referenceUtr.trim()) body.referenceUtr = referenceUtr.trim();
      if (studentComment.trim()) body.studentComment = studentComment.trim();

      const res = await fetch("/api/portal/installment-proofs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok || !json.proof) {
        setError(json.error || "Could not submit. Please try again.");
        setUploadBusy(false);
        return;
      }

      setUploadProgress(100);
      setUploadDone(true);

      const proof = json.proof as { id: string; submitted_at: string; files: InstallmentProofFileMeta[] };
      setTimeout(() => {
        setPrompt({
          ...prompt,
          state: "pending_review",
          pendingProof: {
            id: proof.id,
            submittedAt: proof.submitted_at,
            filesCount: proof.files?.length ?? uploaded.length,
            reviewReason: null,
          },
        });
        setSlide("main");
        setUploadDone(false);
        setUploadBusy(false);
        setLocalFiles((prev) => {
          prev.forEach((f) => {
            if (f.preview) URL.revokeObjectURL(f.preview);
          });
          return [];
        });
        setClaimedAmount("");
        setClaimedDate("");
        setReferenceUtr("");
        setStudentComment("");
      }, 900);
    } catch {
      setError("Something went wrong. Please try again.");
      setUploadBusy(false);
    }
  }

  if (!mounted || !open || !prompt) return null;

  const daysLabel =
    prompt.daysLeft != null
      ? prompt.daysLeft <= 0
        ? "today"
        : prompt.daysLeft === 1
          ? "1 day"
          : `${prompt.daysLeft} days`
      : null;

  const uploadHeading = prompt.pendingProof ? "Add to what you sent" : "Share your payment proof";
  const showClose = prompt.state === "blocked" || prompt.state === "pending_review" || slide !== "main";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        aria-label="Close dialog backdrop"
        onClick={prompt.state === "expiring" ? remindLater : handleDismiss}
        className="absolute inset-0 bg-black/40 backdrop-blur-[12px]"
        style={reduceMotion ? undefined : { animation: "ipp-fade 180ms ease-out forwards" }}
      />

      <div
        ref={panelRef}
        className="relative w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        style={
          reduceMotion
            ? { paddingBottom: "env(safe-area-inset-bottom, 0px)" }
            : {
                animation: "ipp-rise 260ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
                paddingBottom: "env(safe-area-inset-bottom, 0px)",
              }
        }
        onClick={(e) => e.stopPropagation()}
      >
        {showClose && (
          <button
            type="button"
            data-ipp-autofocus
            onClick={handleDismiss}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-muted transition hover:bg-black/5 hover:text-ink"
          >
            <X size={18} />
          </button>
        )}

        {slide === "upload" ? (
          <UploadSlide
            titleId={titleId}
            heading={uploadHeading}
            courseTitle={prompt.courseTitle}
            installmentNo={prompt.installmentNo}
            amountDue={prompt.amountDue}
            localFiles={localFiles}
            claimedAmount={claimedAmount}
            claimedDate={claimedDate}
            referenceUtr={referenceUtr}
            studentComment={studentComment}
            uploadBusy={uploadBusy}
            uploadProgress={uploadProgress}
            uploadDone={uploadDone}
            error={error}
            fileInputRef={fileInputRef}
            onBack={() => setSlide("main")}
            onAddFiles={addFiles}
            onRemoveFile={removeFile}
            onClaimedAmount={setClaimedAmount}
            onClaimedDate={setClaimedDate}
            onReferenceUtr={setReferenceUtr}
            onStudentComment={setStudentComment}
            onSubmit={submitProof}
            onBrowse={() => fileInputRef.current?.click()}
          />
        ) : slide === "view" ? (
          <ViewSlide
            titleId={titleId}
            viewLoading={viewLoading}
            viewProof={viewProof}
            error={error}
            onBack={() => setSlide("main")}
            onAddMore={openUpload}
          />
        ) : prompt.state === "pending_review" ? (
          <PendingReviewSlide
            titleId={titleId}
            courseTitle={prompt.courseTitle}
            pendingProof={prompt.pendingProof}
            onView={openView}
            onAddMore={openUpload}
            onClose={handleDismiss}
          />
        ) : prompt.state === "blocked" ? (
          <BlockedSlide
            titleId={titleId}
            courseTitle={prompt.courseTitle}
            amountDue={prompt.amountDue}
            installmentNo={prompt.installmentNo}
            onPay={goPay}
            onUpload={openUpload}
          />
        ) : (
          <ExpiringSlide
            titleId={titleId}
            courseTitle={prompt.courseTitle}
            amountDue={prompt.amountDue}
            dueDate={prompt.dueDate}
            daysLabel={daysLabel}
            installmentNo={prompt.installmentNo}
            onPay={goPay}
            onUpload={openUpload}
            onRemindLater={remindLater}
          />
        )}
      </div>

      <style jsx global>{`
        @keyframes ipp-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes ipp-rise {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes ipp-fade {
            from,
            to {
              opacity: 1;
            }
          }
          @keyframes ipp-rise {
            from,
            to {
              opacity: 1;
              transform: none;
            }
          }
        }
      `}</style>
    </div>
  );
}

function ExpiringSlide({
  titleId,
  courseTitle,
  amountDue,
  dueDate,
  daysLabel,
  installmentNo,
  onPay,
  onUpload,
  onRemindLater,
}: {
  titleId: string;
  courseTitle: string;
  amountDue: number;
  dueDate: string | null;
  daysLabel: string | null;
  installmentNo: number;
  onPay: () => void;
  onUpload: () => void;
  onRemindLater: () => void;
}) {
  return (
    <div className="card rounded-none border-0 shadow-none">
      <div className="bg-gradient-to-br from-blue-50 to-amber-50 px-6 pb-5 pt-6">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/80 text-2xl shadow-sm">
          📅
        </div>
        <h2 id={titleId} className="mt-4 text-center text-lg font-bold text-ink">
          Instalment coming up
        </h2>
        <p className="mt-1 text-center text-sm text-ink2">{courseTitle}</p>
      </div>

      <div className="space-y-4 px-6 py-5">
        <p className="text-sm leading-relaxed text-ink2">
          {daysLabel ? (
            <>
              Your access continues for about <span className="font-semibold text-ink">{daysLabel}</span>.
              Instalment {installmentNo} of {formatINR(amountDue)} is on the way
              {dueDate ? ` · due ${formatShortDate(dueDate)}` : ""}.
            </>
          ) : (
            <>
              Instalment {installmentNo} of {formatINR(amountDue)} is coming up
              {dueDate ? ` · due ${formatShortDate(dueDate)}` : ""}.
            </>
          )}
        </p>

        <div className="flex flex-col gap-2">
          <button type="button" data-ipp-autofocus onClick={onPay} className="btn btn-primary w-full">
            Pay now
          </button>
          <button type="button" onClick={onUpload} className="btn btn-secondary w-full">
            I&apos;ve already paid
          </button>
          <button type="button" onClick={onRemindLater} className="text-sm font-medium text-muted transition hover:text-ink">
            Remind me later
          </button>
        </div>
      </div>
    </div>
  );
}

function BlockedSlide({
  titleId,
  courseTitle,
  amountDue,
  installmentNo,
  onPay,
  onUpload,
}: {
  titleId: string;
  courseTitle: string;
  amountDue: number;
  installmentNo: number;
  onPay: () => void;
  onUpload: () => void;
}) {
  return (
    <div className="card rounded-none border-0 shadow-none">
      <div className="bg-gradient-to-br from-amber-50 to-blue-50 px-6 pb-5 pt-8">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/80 text-2xl shadow-sm">
          ⏸️
        </div>
        <h2 id={titleId} className="mt-4 text-center text-lg font-bold text-ink">
          Lectures are paused for now
        </h2>
        <p className="mt-1 text-center text-sm text-ink2">{courseTitle}</p>
      </div>

      <div className="space-y-4 px-6 py-5">
        <p className="text-sm leading-relaxed text-ink2">
          Once instalment {installmentNo} ({formatINR(amountDue)}) is cleared, your class hub opens again.
          Pay online or share proof if you&apos;ve already transferred.
        </p>

        <div className="flex flex-col gap-2">
          <button type="button" data-ipp-autofocus onClick={onPay} className="btn btn-primary w-full">
            Pay now
          </button>
          <button type="button" onClick={onUpload} className="btn btn-secondary w-full">
            I&apos;ve already paid
          </button>
        </div>
      </div>
    </div>
  );
}

function PendingReviewSlide({
  titleId,
  courseTitle,
  pendingProof,
  onView,
  onAddMore,
  onClose,
}: {
  titleId: string;
  courseTitle: string;
  pendingProof: InstallmentProofPromptProps["pendingProof"];
  onView: () => void;
  onAddMore: () => void;
  onClose: () => void;
}) {
  return (
    <div className="card rounded-none border-0 shadow-none">
      <div className="bg-gradient-to-br from-blue-50 to-emerald-50 px-6 pb-5 pt-8">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/80 text-2xl shadow-sm">
          ✓
        </div>
        <h2 id={titleId} className="mt-4 text-center text-lg font-bold text-ink">
          Thank you — we&apos;re reviewing
        </h2>
        <p className="mt-1 text-center text-sm text-ink2">{courseTitle}</p>
      </div>

      <div className="space-y-4 px-6 py-5">
        <p className="text-sm leading-relaxed text-ink2">
          We received your payment details
          {pendingProof?.submittedAt ? ` on ${formatShortDate(pendingProof.submittedAt)}` : ""}.
          Our team will confirm shortly and restore access when verified.
        </p>

        <div className="flex flex-col gap-2">
          <button type="button" data-ipp-autofocus onClick={onView} className="btn btn-secondary w-full">
            View what I sent
          </button>
          <button type="button" onClick={onAddMore} className="btn btn-secondary w-full">
            Add something else
          </button>
          <button type="button" onClick={onClose} className="text-sm font-medium text-muted transition hover:text-ink">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadSlide({
  titleId,
  heading,
  courseTitle,
  installmentNo,
  amountDue,
  localFiles,
  claimedAmount,
  claimedDate,
  referenceUtr,
  studentComment,
  uploadBusy,
  uploadProgress,
  uploadDone,
  error,
  fileInputRef,
  onBack,
  onAddFiles,
  onRemoveFile,
  onClaimedAmount,
  onClaimedDate,
  onReferenceUtr,
  onStudentComment,
  onSubmit,
  onBrowse,
}: {
  titleId: string;
  heading: string;
  courseTitle: string;
  installmentNo: number;
  amountDue: number;
  localFiles: LocalFile[];
  claimedAmount: string;
  claimedDate: string;
  referenceUtr: string;
  studentComment: string;
  uploadBusy: boolean;
  uploadProgress: number;
  uploadDone: boolean;
  error: string | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onBack: () => void;
  onAddFiles: (list: FileList | null) => void;
  onRemoveFile: (id: string) => void;
  onClaimedAmount: (v: string) => void;
  onClaimedDate: (v: string) => void;
  onReferenceUtr: (v: string) => void;
  onStudentComment: (v: string) => void;
  onSubmit: () => void;
  onBrowse: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="max-h-[85vh] overflow-y-auto">
      <div className="border-b border-line px-6 py-4">
        <button type="button" onClick={onBack} className="text-sm font-semibold text-primary">
          ← Back
        </button>
        <h2 id={titleId} className="mt-2 text-lg font-bold text-ink">
          {heading}
        </h2>
        <p className="mt-1 text-sm text-ink2">
          {courseTitle} · Instalment {installmentNo} · {formatINR(amountDue)}
        </p>
      </div>

      <div className="space-y-4 px-6 py-5">
        <div
          className={`rounded-2xl border-2 border-dashed px-4 py-6 text-center transition ${
            dragOver ? "border-primary/50 bg-blue-50/50" : "border-line bg-surface"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onAddFiles(e.dataTransfer.files);
          }}
        >
          <Upload className="mx-auto text-muted" size={28} />
          <p className="mt-2 text-sm font-medium text-ink">Drop files here or browse</p>
          <p className="mt-1 text-xs text-muted">PDF, JPG, PNG, WebP, HEIC · up to {MAX_FILES} files · 10 MB each</p>
          <button
            type="button"
            data-ipp-autofocus
            onClick={onBrowse}
            disabled={uploadBusy || localFiles.length >= MAX_FILES}
            className="btn btn-secondary mt-3 text-sm disabled:opacity-60"
          >
            Choose files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => onAddFiles(e.target.files)}
          />
        </div>

        {localFiles.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {localFiles.map((f) => (
              <div key={f.id} className="relative overflow-hidden rounded-xl border border-line bg-surface">
                {f.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.preview} alt="" className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square flex-col items-center justify-center gap-1 p-2 text-muted">
                    <FileText size={22} />
                    <span className="line-clamp-2 text-[10px]">{f.file.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveFile(f.id)}
                  disabled={uploadBusy}
                  aria-label="Remove file"
                  className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 text-muted shadow hover:text-ink disabled:opacity-60"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-ink">Amount (optional)</span>
            <input
              type="number"
              min={0}
              value={claimedAmount}
              onChange={(e) => onClaimedAmount(e.target.value)}
              placeholder={String(amountDue)}
              className="input mt-1 w-full text-sm"
              disabled={uploadBusy}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink">Date paid (optional)</span>
            <input
              type="date"
              value={claimedDate}
              onChange={(e) => onClaimedDate(e.target.value)}
              className="input mt-1 w-full text-sm"
              disabled={uploadBusy}
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-semibold text-ink">UTR / reference (optional)</span>
          <input
            type="text"
            value={referenceUtr}
            onChange={(e) => onReferenceUtr(e.target.value)}
            maxLength={80}
            className="input mt-1 w-full text-sm"
            disabled={uploadBusy}
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-ink">Comment (optional)</span>
          <textarea
            value={studentComment}
            onChange={(e) => onStudentComment(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Anything else that helps us verify…"
            className="input mt-1 w-full text-sm"
            disabled={uploadBusy}
          />
          <span className="text-[11px] text-muted">{studentComment.length}/500</span>
        </label>

        {error && <p className="text-sm text-amber-800">{error}</p>}

        <div className="flex items-center gap-3">
          {(uploadBusy || uploadDone) && (
            <ProgressRing progress={uploadDone ? 100 : uploadProgress} done={uploadDone} />
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={uploadBusy || uploadDone || !localFiles.length}
            className="btn btn-primary flex-1 disabled:opacity-60"
          >
            {uploadDone ? "Submitted" : uploadBusy ? "Uploading…" : "Submit for review"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ViewSlide({
  titleId,
  viewLoading,
  viewProof,
  error,
  onBack,
  onAddMore,
}: {
  titleId: string;
  viewLoading: boolean;
  viewProof: { files: InstallmentProofFileMeta[]; submittedAt: string; reviewReason: string | null } | null;
  error: string | null;
  onBack: () => void;
  onAddMore: () => void;
}) {
  return (
    <div className="max-h-[85vh] overflow-y-auto px-6 py-5">
      <button type="button" onClick={onBack} className="text-sm font-semibold text-primary">
        ← Back
      </button>
      <h2 id={titleId} className="mt-2 text-lg font-bold text-ink">
        What you sent
      </h2>

      {viewLoading ? (
        <p className="mt-4 text-sm text-muted">Loading…</p>
      ) : error ? (
        <p className="mt-4 text-sm text-amber-800">{error}</p>
      ) : viewProof ? (
        <div className="mt-4 space-y-3">
          <p className="flex items-center gap-2 text-sm text-ink2">
            <Calendar size={15} className="text-primary" />
            Submitted {formatShortDate(viewProof.submittedAt)}
          </p>
          {viewProof.reviewReason && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">{viewProof.reviewReason}</p>
          )}
          <ul className="space-y-2">
            {viewProof.files.map((f) => (
              <li
                key={f.path}
                className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
              >
                {f.mime.startsWith("image/") ? <ImageIcon size={16} className="text-primary" /> : <FileText size={16} className="text-primary" />}
                <span className="min-w-0 truncate">{f.original_name}</span>
              </li>
            ))}
          </ul>
          <button type="button" data-ipp-autofocus onClick={onAddMore} className="btn btn-secondary mt-2 w-full">
            Add something else
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ProgressRing({ progress, done }: { progress: number; done: boolean }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const offset = c - (progress / 100) * c;

  return (
    <div className="relative grid h-11 w-11 shrink-0 place-items-center" aria-hidden>
      <svg width="44" height="44" className="-rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-line" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-primary transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      {done && (
        <Check size={18} className="absolute text-emerald-600" strokeWidth={2.5} />
      )}
    </div>
  );
}
