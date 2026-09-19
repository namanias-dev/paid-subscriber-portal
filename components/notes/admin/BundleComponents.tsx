"use client";

import { useCallback, useEffect, useState } from "react";
import { formatPaise } from "@/lib/store/money";

interface Component {
  component_id: string;
  qty: number;
  name: string;
  sku: string;
  selling_price_paise: number;
  availability_mode: string | null;
}

interface Candidate {
  id: string;
  name: string;
  sku: string;
  selling_price_paise: number;
}

/**
 * Manage the products inside a bundle: add/remove components, adjust qty, and see
 * the individual total. Inventory/preparation for the bundle already flows through
 * these components (no independent bundle stock).
 */
export default function BundleComponents({ bundleId, bundlePricePaise }: { bundleId: string; bundlePricePaise: number }) {
  const [components, setComponents] = useState<Component[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [total, setTotal] = useState(0);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/notes/bundles?bundle_id=${bundleId}`, { cache: "no-store" });
    const json = await res.json();
    if (json.ok) {
      setComponents(json.components || []);
      setCandidates(json.candidates || []);
      setTotal(json.component_total_paise || 0);
    }
  }, [bundleId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!pick) return;
    setBusy(true);
    try {
      await fetch("/api/admin/notes/bundles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundle_id: bundleId, component_id: pick, qty: 1 }),
      });
      setPick("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(componentId: string) {
    setBusy(true);
    try {
      await fetch(`/api/admin/notes/bundles?bundle_id=${bundleId}&component_id=${componentId}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function setQty(componentId: string, qty: number) {
    if (qty < 1) return;
    setBusy(true);
    try {
      await fetch("/api/admin/notes/bundles", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundle_id: bundleId, action: "qty", component_id: componentId, qty }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const savings = total - bundlePricePaise;

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <h4 className="text-sm font-semibold text-ink">Bundle contents ({components.length})</h4>
      <div className="mt-2 space-y-1.5">
        {components.map((c) => (
          <div key={c.component_id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-white px-2 py-1.5 text-sm">
            <span className="min-w-0 truncate">
              {c.name} <span className="font-mono text-xs text-muted">{c.sku}</span>
            </span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={c.qty}
                disabled={busy}
                onChange={(e) => setQty(c.component_id, Number(e.target.value))}
                className="h-8 w-14 rounded border border-line px-1 text-sm"
              />
              <span className="tabular-nums text-ink2">{formatPaise(c.selling_price_paise * c.qty)}</span>
              <button type="button" onClick={() => remove(c.component_id)} className="text-xs font-medium text-red-700">
                Remove
              </button>
            </span>
          </div>
        ))}
        {components.length === 0 && <p className="text-xs text-muted">No components yet — add subject notes below.</p>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 flex-1 rounded border border-line px-2 text-sm">
          <option value="">Add a subject notes product…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {formatPaise(c.selling_price_paise)}
            </option>
          ))}
        </select>
        <button type="button" disabled={busy || !pick} onClick={add} className="h-9 rounded bg-ink px-3 text-sm font-semibold text-white disabled:opacity-50">
          Add
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-sm">
        <span className="text-ink2">
          Individual total <span className="tabular-nums font-semibold">{formatPaise(total)}</span> · Bundle price{" "}
          <span className="tabular-nums font-semibold">{formatPaise(bundlePricePaise)}</span>
        </span>
        <span className={savings > 0 ? "font-semibold text-emerald-700" : "text-muted"}>
          {savings > 0 ? `Saves ${formatPaise(savings)}` : "No saving vs individual total"}
        </span>
      </div>
    </div>
  );
}
