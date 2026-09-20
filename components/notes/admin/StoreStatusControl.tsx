"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, CheckCircle2, CircleSlash, Loader2, ShieldAlert, TriangleAlert } from "lucide-react";

interface LaunchState {
  live: boolean;
  killSwitch: boolean;
  lastChangedByName: string | null;
  lastChangedAt: string | null;
}
interface Readiness {
  liveProducts: number;
  withCovers: number;
  withSamples: number;
  readyStock: number;
  onDemand: number;
  comingSoon: number;
  unavailable: number;
  bundlesLive: number;
  warnings: string[];
  blockers: string[];
}

function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function StoreStatusControl() {
  const [state, setState] = useState<LaunchState | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<null | "enable" | "disable">(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notes/store-state", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setState(json.state);
        setReadiness(json.readiness);
      } else {
        setError(json.error || "Could not load store status.");
      }
    } catch {
      setError("Could not load store status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const apply = async (live: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/notes/store-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ live }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        const blockers = Array.isArray(json.blockers) && json.blockers.length ? ` ${json.blockers.join(" ")}` : "";
        setError((json.error || "Could not update the store.") + blockers);
      } else {
        setState(json.state);
        await load();
      }
    } catch {
      setError("Could not update the store. Please try again.");
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  };

  if (loading) {
    return (
      <div className="mb-6 rounded-2xl border border-line bg-white p-5">
        <div className="h-6 w-40 animate-pulse rounded bg-[var(--surface)]" />
      </div>
    );
  }
  if (!state) {
    return (
      <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error || "Store status unavailable."}
      </div>
    );
  }

  const live = state.live;
  const hasBlockers = (readiness?.blockers.length ?? 0) > 0;
  const changed = timeAgo(state.lastChangedAt);

  return (
    <section
      className={`mb-6 overflow-hidden rounded-2xl border ${
        live ? "border-emerald-300 bg-emerald-50/60" : "border-line bg-white"
      }`}
      aria-label="Notes Store status"
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Notes Store</p>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold ${
                live ? "bg-emerald-600 text-white" : "bg-[var(--surface)] text-ink"
              }`}
            >
              {live ? <CheckCircle2 size={14} /> : <CircleSlash size={14} />}
              {live ? "LIVE" : "OFFLINE"}
            </span>
            {state.killSwitch && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700">
                <ShieldAlert size={12} /> Kill switch on
              </span>
            )}
          </div>
          <p className="mt-2 max-w-prose text-sm text-muted">
            {live
              ? "Students can browse and purchase your published Notes."
              : "Students cannot currently browse or purchase Notes."}
          </p>
          {(changed || state.lastChangedByName) && (
            <p className="mt-1 text-xs text-muted">
              Last changed {changed ? `on ${changed}` : ""}
              {state.lastChangedByName ? ` by ${state.lastChangedByName}` : ""}.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {live && (
            <a
              href="/notes"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-[var(--surface)]"
            >
              View store <ArrowUpRight size={15} />
            </a>
          )}
          {live ? (
            <button
              type="button"
              onClick={() => setConfirm("disable")}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700"
            >
              Take Store Offline
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm("enable")}
              disabled={hasBlockers}
              title={hasBlockers ? "Resolve the blockers below first" : undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Enable Notes Store
            </button>
          )}
        </div>
      </div>

      {/* Readiness */}
      {readiness && (
        <div className="border-t border-line bg-white/70 px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Store readiness</p>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[
              { label: "Live products", value: readiness.liveProducts },
              { label: "With covers", value: `${readiness.withCovers}/${readiness.liveProducts}` },
              { label: "With samples", value: `${readiness.withSamples}/${readiness.liveProducts}` },
              { label: "Ready stock", value: readiness.readyStock },
              { label: "On demand", value: readiness.onDemand },
              { label: "Bundles", value: readiness.bundlesLive },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-line bg-white p-2">
                <p className="text-[10px] text-muted">{s.label}</p>
                <p className="font-heading text-lg font-bold tabular-nums text-ink">{s.value}</p>
              </div>
            ))}
          </div>
          {readiness.blockers.length > 0 && (
            <ul className="mt-3 space-y-1">
              {readiness.blockers.map((b, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm text-red-700">
                  <ShieldAlert size={15} className="mt-0.5 shrink-0" /> {b}
                </li>
              ))}
            </ul>
          )}
          {readiness.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {readiness.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm text-amber-700">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" /> {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="border-t border-line bg-red-50 px-5 py-3 text-sm text-red-700">{error}</p>}

      {confirm && (
        <ConfirmDialog
          mode={confirm}
          saving={saving}
          onCancel={() => setConfirm(null)}
          onConfirm={() => apply(confirm === "enable")}
        />
      )}
    </section>
  );
}

function ConfirmDialog({
  mode,
  saving,
  onCancel,
  onConfirm,
}: {
  mode: "enable" | "disable";
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const enable = mode === "enable";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={enable ? "Make Notes Store live" : "Take Notes Store offline"}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-heading text-lg font-bold text-ink">
          {enable ? "Make Notes Store live?" : "Take Notes Store offline?"}
        </h3>
        <ul className="mt-3 space-y-1.5 text-sm text-muted">
          {enable ? (
            <>
              <li>• The Notes tab becomes visible to students and public visitors.</li>
              <li>• The <code>/notes</code> storefront becomes accessible.</li>
              <li>• Live products become purchasable.</li>
              <li>• Draft, Archived, Coming Soon and Unavailable products stay governed by their own states.</li>
            </>
          ) : (
            <>
              <li>• The Notes tab disappears from student/public navigation.</li>
              <li>• The public <code>/notes</code> storefront becomes unavailable and new purchases stop.</li>
              <li>• Existing orders, payments, fulfilment and inventory history are preserved and stay available in admin.</li>
            </>
          )}
        </ul>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-[var(--surface)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white transition disabled:opacity-60 ${
              enable ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            {enable ? "Make Store Live" : "Take Store Offline"}
          </button>
        </div>
      </div>
    </div>
  );
}
