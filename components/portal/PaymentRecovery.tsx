"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Mirrors RecoveryItem from lib/paymentProofs.ts. */
interface RecoveryItem {
  paymentId: string;
  referenceNo: string | null;
  item: string;
  itemWhen: string | null;
  itemType: string;
  itemSlug: string | null;
  paymentStatus: string;
  proofStatus: "none" | "submitted" | "reupload_requested" | "accepted" | "rejected";
  adminReason: string | null;
  filesCount: number;
  studentNote: string | null;
  createdAt: string;
}

interface UploadedFile {
  key: string;
  name: string;
  content_type: string;
  size: number;
  uploaded_at: string;
}

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_FILES = 3;
const MAX_BYTES = 8 * 1024 * 1024;

function signature(items: RecoveryItem[]): string {
  return items.map((i) => `${i.paymentId}:${i.proofStatus}`).sort().join("|");
}

/** Items that still need the student to act (drive the one-time pop-up). */
function needsAction(i: RecoveryItem): boolean {
  return i.proofStatus === "none" || i.proofStatus === "reupload_requested" || i.proofStatus === "rejected";
}

export default function PaymentRecovery() {
  const [items, setItems] = useState<RecoveryItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [dismissedBanners, setDismissedBanners] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<RecoveryItem | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/payment-proofs", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setItems(json.items as RecoveryItem[]);
    } catch {
      /* non-fatal */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // One-time, state-aware pop-up: shows again only if the proof state changes
  // (e.g. admin requests a reupload). Never nags within the same state.
  useEffect(() => {
    if (!loaded || !items.length) return;
    const actionable = items.filter(needsAction);
    if (!actionable.length) return;
    const sig = signature(actionable);
    let seen = "";
    try {
      seen = sessionStorage.getItem("paymentRecoveryPopup") || "";
    } catch {
      /* ignore */
    }
    if (seen !== sig) setShowPopup(true);
  }, [loaded, items]);

  const dismissPopup = useCallback(() => {
    setShowPopup(false);
    try {
      sessionStorage.setItem("paymentRecoveryPopup", signature(items.filter(needsAction)));
    } catch {
      /* ignore */
    }
  }, [items]);

  const openReport = useCallback(
    (item: RecoveryItem) => {
      setActive(item);
      setShowPopup(false);
    },
    [],
  );

  // Banners persist until resolved. Info (submitted) is dismissible; warning
  // (reupload_requested / rejected) is NOT — the student can't miss it.
  const banners = useMemo(
    () => items.filter((i) => !(i.proofStatus === "submitted" && dismissedBanners.has(i.paymentId))),
    [items, dismissedBanners],
  );

  if (!loaded || !items.length) return null;

  return (
    <>
      {/* Persistent dashboard banners */}
      {banners.length > 0 && (
        <div className="mt-6 space-y-3">
          {banners.map((i) => (
            <Banner
              key={i.paymentId}
              item={i}
              onReport={() => openReport(i)}
              onDismiss={
                i.proofStatus === "submitted"
                  ? () => setDismissedBanners((prev) => new Set(prev).add(i.paymentId))
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {/* One-time login pop-up */}
      {showPopup && (
        <Modal onClose={dismissPopup}>
          <div className="text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-2xl">💳</div>
            <h3 className="mt-3 text-lg font-bold text-[var(--navy)]">We noticed a payment that&apos;s still being confirmed</h3>
            <p className="mt-2 text-sm text-ink2">Already paid? Report it and our team will verify your payment and confirm shortly.</p>
          </div>
          <div className="mt-5 space-y-2">
            {items.filter(needsAction).map((i) => (
              <button
                key={i.paymentId}
                onClick={() => openReport(i)}
                className="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-left transition hover:border-primary/50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{i.item}</span>
                  <span className="block text-xs text-muted">
                    {i.itemType === "webinar" ? "Webinar" : "Course"}
                    {i.itemWhen ? ` · ${i.itemWhen}` : ""} · {labelForStatus(i.paymentStatus)}
                  </span>
                </span>
                <span className="ml-3 shrink-0 text-sm font-semibold text-primary">Report →</span>
              </button>
            ))}
          </div>
          <button onClick={dismissPopup} className="btn btn-secondary mt-4 w-full text-sm">Maybe later</button>
        </Modal>
      )}

      {/* Report / upload panel */}
      {active && (
        <ReportPanel
          item={active}
          onClose={() => setActive(null)}
          onSubmitted={async () => {
            setActive(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function labelForStatus(s: string): string {
  const up = (s || "").toUpperCase();
  if (up === "FAILED") return "Payment failed";
  if (up === "VERIFYING") return "Verifying";
  return "Payment pending";
}

function Banner({
  item,
  onReport,
  onDismiss,
}: {
  item: RecoveryItem;
  onReport: () => void;
  onDismiss?: () => void;
}) {
  const cfg = (() => {
    switch (item.proofStatus) {
      case "submitted":
        return {
          cls: "border-blue-200 bg-blue-50 text-blue-900",
          icon: "🔎",
          title: "Your payment proof is under review",
          body: "We'll confirm shortly. You'll get access as soon as it's verified.",
          cta: null as string | null,
        };
      case "reupload_requested":
        return {
          cls: "border-amber-300 bg-amber-50 text-amber-900",
          icon: "⚠️",
          title: "Reupload required — the screenshot wasn't clear enough",
          body: item.adminReason ? `Reason: ${item.adminReason}` : "Please upload your payment proof again.",
          cta: "Reupload proof",
        };
      case "rejected":
        return {
          cls: "border-rose-300 bg-rose-50 text-rose-900",
          icon: "⚠️",
          title: "We couldn't verify this payment",
          body: item.adminReason ? `Reason: ${item.adminReason}` : "If you did pay, please report it again with a clear screenshot.",
          cta: "Report again",
        };
      default:
        return {
          cls: "border-amber-200 bg-amber-50 text-amber-900",
          icon: "💳",
          title: "A payment is still being confirmed",
          body: "Already paid? Report it and we'll verify and confirm shortly.",
          cta: "Report a payment",
        };
    }
  })();

  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 ${cfg.cls}`}>
      <span className="mt-0.5 text-lg">{cfg.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{cfg.title}</p>
        <p className="mt-0.5 text-xs opacity-90">
          <span className="font-medium">{item.item}</span>
          {item.itemWhen ? <span className="opacity-80"> ({item.itemWhen})</span> : null} — {cfg.body}
        </p>
        {cfg.cta && (
          <button onClick={onReport} className="btn btn-primary mt-3 px-3 py-1.5 text-xs">{cfg.cta}</button>
        )}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-sm opacity-60 hover:opacity-100">×</button>
      )}
    </div>
  );
}

function ReportPanel({
  item,
  onClose,
  onSubmitted,
}: {
  item: RecoveryItem;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [note, setNote] = useState(item.studentNote || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(list: FileList | null) {
    if (!list || !list.length) return;
    setError(null);
    const remaining = MAX_FILES - files.length;
    const chosen = Array.from(list).slice(0, remaining);
    for (const file of chosen) {
      if (!ALLOWED.includes(file.type)) {
        setError("Only images (JPG/PNG/WebP) and PDF are allowed.");
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError("Each file must be 8 MB or smaller.");
        continue;
      }
      setBusy(true);
      try {
        const signRes = await fetch("/api/portal/payment-proofs/sign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentId: item.paymentId, fileName: file.name, contentType: file.type, size: file.size }),
        });
        const signJson = await signRes.json();
        if (!signJson.ok) {
          setError(signJson.error || "Could not start the upload.");
          continue;
        }
        const put = await fetch(signJson.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!put.ok) {
          setError("Upload failed. Please try again.");
          continue;
        }
        setFiles((prev) => [...prev, signJson.file as UploadedFile]);
      } catch {
        setError("Upload failed. Please try again.");
      } finally {
        setBusy(false);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit() {
    if (!files.length) {
      setError("Please attach at least one screenshot or PDF.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/payment-proofs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: item.paymentId, note, files }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Could not submit. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not submit. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      {done ? (
        <div className="text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-green-100 text-2xl">✓</div>
          <h3 className="mt-3 text-lg font-bold text-[var(--navy)]">Thank you — proof submitted</h3>
          <p className="mt-2 text-sm text-ink2">Our team will verify your payment and confirm shortly. You&apos;ll get access as soon as it&apos;s verified.</p>
          <button onClick={onSubmitted} className="btn btn-primary mt-5 w-full">Done</button>
        </div>
      ) : (
        <>
          <h3 className="text-lg font-bold text-[var(--navy)]">Report a payment</h3>
          <p className="mt-1 text-sm text-ink2">
            <span className="font-semibold text-ink">{item.item}</span>
            {item.itemWhen ? <span className="text-muted"> · {item.itemWhen}</span> : null} · {labelForStatus(item.paymentStatus)}
          </p>
          <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs text-muted">
            Uploading a screenshot does <span className="font-semibold">not</span> grant access. We verify the payment, then confirm.
          </p>

          {item.proofStatus === "reupload_requested" && item.adminReason && (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Reupload requested: {item.adminReason}
            </p>
          )}

          <div className="mt-4">
            <label className="text-sm font-semibold text-ink">Screenshot or PDF of your payment</label>
            <p className="text-xs text-muted">Images or PDF · up to {MAX_FILES} files · 8 MB each</p>
            <div className="mt-2 space-y-2">
              {files.map((f) => (
                <div key={f.key} className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-xs">
                  <span className="truncate">{f.name}</span>
                  <button
                    onClick={() => setFiles((prev) => prev.filter((x) => x.key !== f.key))}
                    className="ml-2 shrink-0 text-muted hover:text-danger"
                    aria-label="Remove"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            {files.length < MAX_FILES && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="mt-2 w-full rounded-xl border border-dashed border-line py-3 text-sm font-medium text-ink2 transition hover:border-primary/50 hover:text-primary disabled:opacity-60"
              >
                {busy ? "Uploading…" : "+ Add file"}
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          <div className="mt-4">
            <label className="text-sm font-semibold text-ink">Add a note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="e.g. Paid via UPI at 3:42 PM, transaction ID…"
              className="input mt-1 w-full text-sm"
            />
          </div>

          {error && <p className="mt-3 text-sm font-medium text-danger">{error}</p>}

          <div className="mt-5 flex gap-2">
            <button onClick={onClose} className="btn btn-secondary flex-1">Cancel</button>
            <button onClick={submit} disabled={busy || !files.length} className="btn btn-primary flex-1 disabled:opacity-60">
              {busy ? "Submitting…" : "Submit proof"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
