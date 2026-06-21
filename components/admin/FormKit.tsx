"use client";

import { useState } from "react";
import Link from "next/link";

/** Wide, multi-section admin form layout primitives (light theme, royal blue). */

/**
 * Lightweight tabbed layout. All panels stay mounted (toggled with `hidden`) so
 * controlled inputs — including the TipTap editor — never lose state or remount
 * when switching tabs.
 */
export function Tabs({
  items,
}: {
  items: { id: string; label: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(items[0]?.id);
  return (
    <div>
      <div role="tablist" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
        {items.map((t) => {
          const on = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(t.id)}
              className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition ${
                on ? "border-primary text-primary" : "border-transparent text-ink2 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="mt-6">
        {items.map((t) => (
          <div key={t.id} hidden={active !== t.id} className="space-y-6">
            {t.content}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FormShell({
  title,
  subtitle,
  backHref,
  children,
}: {
  title: string;
  subtitle?: string;
  backHref: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl pb-24">
      <Link href={backHref} className="text-sm text-primary">← Back</Link>
      <div className="mb-6 mt-2">
        <h1 className="font-heading text-2xl font-extrabold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink2">{subtitle}</p>}
      </div>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

export function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="font-heading text-lg font-bold">{title}</h2>
        {desc && <p className="mt-0.5 text-sm text-muted">{desc}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  full,
  children,
}: {
  label: string;
  hint?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Sticky action bar so Save is always reachable on long forms. */
export function FormActions({
  saving,
  onSave,
  cancelHref,
  saveLabel = "Save",
}: {
  saving: boolean;
  onSave: () => void;
  cancelHref: string;
  saveLabel?: string;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 mt-2 flex gap-3 border-t border-line bg-canvas/90 px-1 py-3 backdrop-blur sm:justify-end">
      <Link href={cancelHref} className="btn btn-secondary flex-1 sm:flex-none">Cancel</Link>
      <button onClick={onSave} disabled={saving} className="btn btn-primary flex-1 sm:flex-none">
        {saving ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}
