"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatINR, formatISTDate, istTodayYMD } from "@/lib/dates";
import type { InstallmentProofFileMeta, InstallmentProofStatus } from "@/lib/installmentProofTypes";

interface ProofDetail {
  id: string;
  status: InstallmentProofStatus;
  submitted_at: string;
  installment_no: number;
  claimed_amount: number | null;
  claimed_paid_date: string | null;
  reference_utr: string | null;
  student_comment: string | null;
  files: InstallmentProofFileMeta[];
}

interface ProofRecordPreview {
  expected: { installmentNo: number; amount: number; due: string | null };
  claimed: { amount: number | null; date: string | null; utr: string | null };
  enrollment: {
    totalFee: number;
    amountPaid: number;
    outstanding: number;
    pctPaid: number;
    unpaidInstallments: Array<{ no: number; amount: number; due: string | null }>;
  };
  allocationNote: string | null;
  flagEnabled: boolean;
}

export interface InstallmentProofReviewPanelProps {
  proofId: string;
  student: string;
  pctPaid: number;
  amountPaid: number;
  totalFee: number;
  amountDue: number;
  onClose: () => void;
  onUpdated: (proofId: string) => void;
}

type BusyAction = "approve_record" | "grant_only" | "reject" | null;

function ageLabel(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isHeicMime(mime: string): boolean {
  return mime === "image/heic" || mime === "image/heif";
}

function isPdf(mime: string): boolean {
  return mime === "application/pdf" || mime.endsWith("/pdf");
}

function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

export default function InstallmentProofReviewPanel({
  proofId,
  student,
  pctPaid,
  amountPaid,
  totalFee,
  amountDue,
  onClose,
  onUpdated,
}: InstallmentProofReviewPanelProps) {
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const [proof, setProof] = useState<ProofDetail | null>(null);
  const [preview, setPreview] = useState<ProofRecordPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileIndex, setFileIndex] = useState(0);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmAmount, setConfirmAmount] = useState("");
  const [confirmDate, setConfirmDate] = useState("");
  const [confirmUtr, setConfirmUtr] = useState("");
  const [seenProof, setSeenProof] = useState(false);

  const loadProof = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/installment-proofs?id=${encodeURIComponent(proofId)}&preview=1`
      );
      const json = await res.json();
      if (!res.ok || !json.ok || !json.proof) {
        setError(json.error || "Could not load proof");
        setProof(null);
        setPreview(null);
        return;
      }
      setProof(json.proof as ProofDetail);
      setPreview({
        expected: json.expected,
        claimed: json.claimed,
        enrollment: json.enrollment,
        allocationNote: json.allocationNote ?? null,
        flagEnabled: !!json.flagEnabled,
      });
      setFileIndex(0);
    } catch {
      setError("Could not load proof");
      setProof(null);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [proofId]);

  useEffect(() => {
    void loadProof();
  }, [loadProof]);

  const currentFile = proof?.files[fileIndex] ?? null;

  useEffect(() => {
    if (!proof || !currentFile) {
      setFileUrl(null);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setFileUrl(null);
    setImgFailed(false);
    setZoom(1);
    void (async () => {
      try {
        const qs = new URLSearchParams({
          id: proofId,
          file: currentFile.path,
        });
        const res = await fetch(`/api/admin/installment-proofs?${qs}`);
        const json = await res.json();
        if (!cancelled && res.ok && json.ok && json.url) {
          setFileUrl(String(json.url));
        }
      } catch { /* non-fatal */ }
      finally {
        if (!cancelled) setFileLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [proof, currentFile, proofId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("[data-drawer-autofocus]")?.focus();
  }, []);

  async function postAction(body: Record<string, unknown>): Promise<{
    ok: boolean;
    error?: string;
    alreadyRecorded?: boolean;
    alreadyPaidSuperseded?: boolean;
  }> {
    const res = await fetch("/api/admin/installment-proofs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return {
      ok: res.ok && json.ok,
      error: json.error as string | undefined,
      alreadyRecorded: json.alreadyRecorded as boolean | undefined,
      alreadyPaidSuperseded: json.alreadyPaidSuperseded as boolean | undefined,
    };
  }

  function openConfirm() {
    if (!preview) return;
    const defaultAmount = preview.expected.amount || preview.claimed.amount || 0;
    setConfirmAmount(defaultAmount > 0 ? String(defaultAmount) : "");
    setConfirmDate(preview.claimed.date ? preview.claimed.date.slice(0, 10) : istTodayYMD());
    setConfirmUtr(preview.claimed.utr || "");
    setSeenProof(false);
    setShowReject(false);
    setShowConfirm(true);
  }

  function cancelConfirm() {
    setShowConfirm(false);
  }

  function startReject() {
    setShowConfirm(false);
    setShowReject(true);
  }

  async function approveRecord() {
    const amountNum = Number(confirmAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast("Enter a valid amount", "error");
      return;
    }
    if (!confirmDate) {
      toast("Payment date is required", "error");
      return;
    }
    if (!seenProof) {
      toast("Confirm you have seen proof of this payment", "error");
      return;
    }
    setBusy("approve_record");
    const { ok, error: err, alreadyRecorded, alreadyPaidSuperseded } = await postAction({
      action: "approve_record",
      proof_id: proofId,
      amount: amountNum,
      payment_date: confirmDate,
      reference_utr: confirmUtr.trim() || null,
      seen_proof: true,
    });
    setBusy(null);
    if (ok) {
      if (alreadyPaidSuperseded) {
        toast("Already paid — nothing recorded", "info");
      } else if (alreadyRecorded) {
        toast("Payment was already recorded for this proof", "info");
      } else {
        toast("Payment recorded — proof approved", "success");
      }
      onUpdated(proofId);
      onClose();
    } else {
      toast(err || "Could not record payment", "error");
    }
  }

  async function grantOnly() {
    setBusy("grant_only");
    const { ok, error: err } = await postAction({ action: "grant_only", proof_id: proofId });
    setBusy(null);
    if (ok) {
      toast("Proof approved — provisional access granted", "success");
      onUpdated(proofId);
      onClose();
    } else {
      toast(err || "Could not approve proof", "error");
    }
  }

  async function reject() {
    const reason = rejectReason.trim();
    if (!reason) {
      toast("Rejection reason is required", "error");
      return;
    }
    setBusy("reject");
    const { ok, error: err } = await postAction({ action: "reject", proof_id: proofId, reason });
    setBusy(null);
    if (ok) {
      toast("Proof rejected", "success");
      onUpdated(proofId);
      onClose();
    } else {
      toast(err || "Could not reject proof", "error");
    }
  }

  const submittedAge = proof
    ? ageLabel(Math.max(0, Math.floor((Date.now() - new Date(proof.submitted_at).getTime()) / 60_000)))
    : null;

  const amountDiffers =
    !!preview && preview.claimed.amount != null && preview.claimed.amount !== preview.expected.amount;

  return (
    <div className="fixed inset-0 z-[140]">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="proof-review-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-[620px] animate-fade-in flex-col border-l border-line bg-white shadow-soft-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id="proof-review-title" className="font-heading text-lg font-extrabold">
              Review payment proof
            </h2>
            <p className="mt-0.5 truncate text-sm text-ink2">{student}</p>
            <p className="mt-0.5 text-xs text-muted">
              {pctPaid}% paid · {formatINR(amountPaid)} / {formatINR(totalFee)} · {formatINR(amountDue)} due
            </p>
          </div>
          <button
            type="button"
            data-drawer-autofocus
            onClick={onClose}
            aria-label="Close proof review"
            className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-surface hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && !proof && <p className="text-sm text-muted">Loading proof…</p>}
          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm">
              <p className="font-semibold text-danger">{error}</p>
              <button type="button" onClick={() => void loadProof()} className="btn btn-secondary mt-3 text-sm">
                Retry
              </button>
            </div>
          )}

          {proof && (
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-surface2 p-3 text-xs">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <span className="text-muted">Submitted</span>
                    <div className="font-medium">{formatISTDate(proof.submitted_at)} · {submittedAge}</div>
                  </div>
                  <div>
                    <span className="text-muted">Installment</span>
                    <div className="font-medium">#{proof.installment_no}</div>
                  </div>
                  <div>
                    <span className="text-muted">Claimed amount</span>
                    <div className="font-medium">{proof.claimed_amount != null ? formatINR(proof.claimed_amount) : "—"}</div>
                  </div>
                  <div>
                    <span className="text-muted">Claimed paid date</span>
                    <div className="font-medium">{proof.claimed_paid_date ? formatISTDate(proof.claimed_paid_date) : "—"}</div>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-muted">UTR / reference</span>
                    <div className="font-mono font-medium">{proof.reference_utr || "—"}</div>
                  </div>
                  {proof.student_comment && (
                    <div className="sm:col-span-2">
                      <span className="text-muted">Student comment</span>
                      <div className="mt-0.5 whitespace-pre-wrap">{proof.student_comment}</div>
                    </div>
                  )}
                </div>
              </div>

              {showConfirm && preview && (
                <div className="space-y-3 rounded-xl border border-primary/30 bg-primary-tint p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-primary">Confirm before recording</p>

                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg border border-line bg-white p-2">
                      <span className="text-muted">Expected</span>
                      <div className="font-semibold text-ink">
                        Instalment {preview.expected.installmentNo} · {formatINR(preview.expected.amount)}
                      </div>
                    </div>
                    <div
                      className={`rounded-lg border p-2 ${
                        amountDiffers ? "border-amber-300 bg-amber-50" : "border-line bg-white"
                      }`}
                    >
                      <span className={amountDiffers ? "text-amber-800" : "text-muted"}>Claimed by student</span>
                      <div className={`flex items-center gap-1.5 font-semibold ${amountDiffers ? "text-amber-800" : "text-ink"}`}>
                        <span>{preview.claimed.amount != null ? formatINR(preview.claimed.amount) : "—"}</span>
                        {amountDiffers && (
                          <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                            Differs
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-line bg-white p-2 text-xs">
                    <div>
                      <span className="text-muted">Total fee</span>
                      <div className="font-medium text-ink">{formatINR(preview.enrollment.totalFee)}</div>
                    </div>
                    <div>
                      <span className="text-muted">Paid</span>
                      <div className="font-medium text-ink">{formatINR(preview.enrollment.amountPaid)}</div>
                    </div>
                    <div>
                      <span className="text-muted">Outstanding</span>
                      <div className="font-medium text-ink">
                        {formatINR(preview.enrollment.outstanding)} · {preview.enrollment.pctPaid}%
                      </div>
                    </div>
                  </div>

                  {preview.allocationNote && (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                      {preview.allocationNote}
                    </p>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-semibold text-ink">Amount to record</span>
                      <input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        className="input mt-1"
                        value={confirmAmount}
                        onChange={(e) => setConfirmAmount(e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-ink">Payment date</span>
                      <input
                        type="date"
                        className="input mt-1"
                        value={confirmDate}
                        onChange={(e) => setConfirmDate(e.target.value)}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-xs font-semibold text-ink">UTR / reference (optional)</span>
                      <input
                        type="text"
                        className="input mt-1"
                        value={confirmUtr}
                        onChange={(e) => setConfirmUtr(e.target.value)}
                        placeholder="e.g. UTR / transaction id"
                      />
                    </label>
                  </div>

                  <label className="flex items-start gap-2 rounded-lg border border-line bg-white p-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={seenProof}
                      onChange={(e) => setSeenProof(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                    />
                    <span>I have seen proof of this payment</span>
                  </label>
                </div>
              )}

              {proof.files.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Files ({fileIndex + 1}/{proof.files.length})
                    </span>
                    <div className="flex items-center gap-1">
                      {currentFile && isImage(currentFile.mime) && (
                        <>
                          <button
                            type="button"
                            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                            className="rounded-lg border border-line p-1.5 text-muted hover:bg-surface2"
                            aria-label="Zoom out"
                          >
                            <ZoomOut size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                            className="rounded-lg border border-line p-1.5 text-muted hover:bg-surface2"
                            aria-label="Zoom in"
                          >
                            <ZoomIn size={14} />
                          </button>
                          <span className="px-1 text-[10px] tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
                        </>
                      )}
                      <button
                        type="button"
                        disabled={fileIndex <= 0}
                        onClick={() => setFileIndex((i) => i - 1)}
                        className="rounded-lg border border-line p-1.5 disabled:opacity-40"
                        aria-label="Previous file"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={fileIndex >= proof.files.length - 1}
                        onClick={() => setFileIndex((i) => i + 1)}
                        className="rounded-lg border border-line p-1.5 disabled:opacity-40"
                        aria-label="Next file"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-line bg-surface2">
                    {fileLoading && <p className="p-8 text-center text-sm text-muted">Loading file…</p>}
                    {!fileLoading && fileUrl && currentFile && isImage(currentFile.mime) && !imgFailed && (
                      <div className="max-h-[420px] overflow-auto p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={fileUrl}
                          alt={currentFile.original_name || "Payment proof"}
                          style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
                          className="max-w-none rounded-lg"
                          onError={() => setImgFailed(true)}
                        />
                      </div>
                    )}
                    {!fileLoading && fileUrl && currentFile && isImage(currentFile.mime) && imgFailed && (
                      <div className="p-6 text-center text-sm">
                        <p className="text-muted">
                          {isHeicMime(currentFile.mime)
                            ? "This HEIC can’t preview in this browser."
                            : "Preview failed."}
                        </p>
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-primary hover:underline">
                          Download / open file
                        </a>
                      </div>
                    )}
                    {!fileLoading && fileUrl && currentFile && isPdf(currentFile.mime) && (
                      <iframe
                        src={fileUrl}
                        title={currentFile.original_name || "Payment proof PDF"}
                        className="h-[420px] w-full bg-white"
                      />
                    )}
                    {!fileLoading && fileUrl && currentFile && !isImage(currentFile.mime) && !isPdf(currentFile.mime) && (
                      <div className="p-6 text-center text-sm">
                        <p className="text-muted">Preview not available for this file type.</p>
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-primary hover:underline">
                          Open file
                        </a>
                      </div>
                    )}
                    {!fileLoading && !fileUrl && (
                      <p className="p-8 text-center text-sm text-muted">Could not load file preview.</p>
                    )}
                  </div>
                  {currentFile && (
                    <p className="mt-1 truncate text-[10px] text-muted">{currentFile.original_name}</p>
                  )}
                </div>
              )}

              {showReject && (
                <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
                  <label className="block text-xs font-semibold text-danger">Rejection reason (required)</label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-line bg-white p-2 text-sm"
                    placeholder="Why is this proof being rejected?"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {proof && proof.status === "pending" && (
          <div className="flex flex-col gap-2 border-t border-line px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {showConfirm ? (
              <>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={cancelConfirm}
                  className="btn btn-secondary w-full text-sm sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!!busy || !seenProof || !confirmAmount || Number(confirmAmount) <= 0}
                  onClick={() => void approveRecord()}
                  className="btn btn-primary w-full text-sm sm:w-auto"
                >
                  {busy === "approve_record" ? "Recording…" : "Confirm & record payment"}
                </button>
              </>
            ) : showReject ? (
              <>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => { setShowReject(false); setRejectReason(""); }}
                  className="btn btn-secondary w-full text-sm sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!!busy || !rejectReason.trim()}
                  onClick={() => void reject()}
                  className="btn btn-primary w-full text-sm sm:w-auto bg-danger hover:bg-danger"
                >
                  {busy === "reject" ? "Rejecting…" : "Confirm reject"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={startReject}
                  className="btn btn-secondary w-full text-sm text-danger sm:w-auto"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void grantOnly()}
                  className="btn btn-secondary w-full text-sm sm:w-auto"
                >
                  {busy === "grant_only" ? "Granting…" : "Grant access only"}
                </button>
                {preview?.flagEnabled && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={openConfirm}
                    className="btn btn-primary w-full text-sm sm:w-auto"
                  >
                    Approve & record payment
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
