"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { IssueCategory, PublicIssue } from "@/lib/store/issues";

export default function IssueSheet({
  open,
  orderNo,
  token,
  categories,
  onClose,
  onCreated,
}: {
  open: boolean;
  orderNo: string;
  token: string;
  categories: { id: IssueCategory; label: string; hint: string }[];
  onClose: () => void;
  onCreated: (issue: PublicIssue) => void;
}) {
  const titleId = useId();
  const reduce = useReducedMotion();
  const first = useRef<HTMLButtonElement>(null);
  const [category, setCategory] = useState<IssueCategory | "">(categories[0]?.id || "");
  const [description, setDescription] = useState("");
  const [callback, setCallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategory(categories[0]?.id || "");
    setDescription("");
    setCallback(false);
    setError(null);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => first.current?.focus(), 40);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(timer);
    };
  }, [open, categories]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/order/${encodeURIComponent(orderNo)}/issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: token, category, description, callback_requested: callback }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (json.issue) onCreated(json.issue);
        throw new Error(json.error || "Could not send this.");
      }
      onCreated(json.issue);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button type="button" aria-label="Close" className="absolute inset-0 bg-[var(--ca-navy)]/45" onClick={onClose} />
          <motion.form
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onSubmit={submit}
            className="relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] bg-[#fbfaf6] p-5 shadow-2xl sm:max-w-md sm:rounded-[28px] sm:p-6"
            initial={reduce ? false : { y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? undefined : { y: 16, opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--ca-navy)]/15 sm:hidden" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Need help</p>
                <h2 id={titleId} className="mt-1 font-heading text-2xl font-bold text-[var(--ca-navy)]">
                  Raise an issue
                </h2>
              </div>
              <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-full text-sm text-[var(--ca-navy)]/60">
                Close
              </button>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ca-navy)]/65">
              Tell us what looks wrong. We’ll keep the update on this order page.
            </p>
            <fieldset className="mt-4 space-y-2">
              <legend className="sr-only">Issue type</legend>
              {categories.map((item, index) => (
                <button
                  key={item.id}
                  ref={index === 0 ? first : undefined}
                  type="button"
                  onClick={() => setCategory(item.id)}
                  className={`flex min-h-14 w-full items-center justify-between rounded-2xl border px-4 text-left ${
                    category === item.id
                      ? "border-[var(--ca-gold-dark)] bg-white"
                      : "border-[var(--ca-navy)]/10 bg-white/70"
                  }`}
                  aria-pressed={category === item.id}
                >
                  <span>
                    <span className="block text-sm font-semibold text-[var(--ca-navy)]">{item.label}</span>
                    <span className="block text-xs text-[var(--ca-navy)]/55">{item.hint}</span>
                  </span>
                  <span
                    className={`h-4 w-4 rounded-full border ${
                      category === item.id ? "border-[var(--ca-gold-dark)] bg-[var(--ca-gold)]" : "border-[var(--ca-navy)]/25"
                    }`}
                  />
                </button>
              ))}
            </fieldset>
            <label className="mt-4 block text-sm font-medium text-[var(--ca-navy)]">
              What should we look at?
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                minLength={12}
                maxLength={600}
                rows={4}
                className="mt-2 w-full rounded-2xl border border-[var(--ca-navy)]/12 bg-white px-3 py-3 text-base text-[var(--ca-navy)]"
              />
            </label>
            <label className="mt-3 flex min-h-12 items-center gap-3 text-sm text-[var(--ca-navy)]">
              <input type="checkbox" checked={callback} onChange={(e) => setCallback(e.target.checked)} className="h-5 w-5" />
              Call me on the phone used at checkout
            </label>
            {error && (
              <p role="alert" className="mt-3 text-sm text-red-800">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || !category}
              className="mt-4 min-h-12 w-full rounded-full bg-[var(--ca-navy)] text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Sending…" : "Submit issue"}
            </button>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
