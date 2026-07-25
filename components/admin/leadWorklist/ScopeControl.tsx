"use client";

import { LEAD_SCOPES, type LeadScope } from "./query";

/**
 * The scope control — the single most important thing on this page.
 *
 * Before Phase 2 the 178,183 legacy leads were hidden by an implicit default
 * nobody could see. They are now first-class, which means the boundary has to
 * be visible AND deliberate: a segmented control that always states which
 * universe is on screen, defaults to `live`, and writes itself to the URL so
 * the answer survives a refresh and travels in a shared link.
 */
export default function ScopeControl({
  value,
  onChange,
}: {
  value: LeadScope;
  onChange: (scope: LeadScope) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="radiogroup"
        aria-label="Lead scope"
        className="inline-flex overflow-hidden rounded-xl border border-line-strong bg-white p-0.5 shadow-soft-sm"
      >
        {LEAD_SCOPES.map((scope) => {
          const active = scope.value === value;
          return (
            <button
              key={scope.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={scope.hint}
              onClick={() => onChange(scope.value)}
              className="rounded-[10px] px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-primary/40"
              style={{
                background: active ? "var(--primary)" : "transparent",
                color: active ? "#fff" : "var(--ink2)",
              }}
            >
              {scope.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted">{LEAD_SCOPES.find((s) => s.value === value)?.hint}</p>
    </div>
  );
}
