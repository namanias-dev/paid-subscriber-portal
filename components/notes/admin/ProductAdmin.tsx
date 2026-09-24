"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/admin/ui";
import { formatPaise } from "@/lib/store/money";

type AvailabilityMode = "ready_stock" | "on_demand" | "coming_soon" | "unavailable";

interface Row {
  id: string;
  sku: string;
  slug: string;
  name: string;
  subject: string | null;
  kind: "single" | "bundle";
  mrp_paise: number;
  selling_price_paise: number;
  sellable: number;
  availability_mode: AvailabilityMode;
  is_active: boolean;
  archived: boolean;
  has_cover: boolean;
  sample_count: number;
  order_count: number;
  weight_grams: number | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
}

const AVAILABILITY_LABEL: Record<AvailabilityMode, string> = {
  ready_stock: "Ready Stock",
  on_demand: "On Demand",
  coming_soon: "Coming Soon",
  unavailable: "Unavailable",
};

function statusPill(r: Row): { text: string; cls: string } {
  if (r.archived) return { text: "ARCHIVED", cls: "bg-slate-200 text-slate-700" };
  if (r.is_active) return { text: "LIVE", cls: "bg-emerald-100 text-emerald-800" };
  return { text: "DRAFT", cls: "bg-amber-100 text-amber-900" };
}

export default function NotesProductAdmin() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    subject: "",
    sku: "",
    slug: "",
    kind: "single" as "single" | "bundle",
    price: "2999",
    weight: "",
    length: "",
    width: "",
    height: "",
  });

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/admin/notes/products${showArchived ? "?include_archived=1" : ""}`, { cache: "no-store" });
    const json = await res.json();
    setRows(json.products || []);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, [showArchived]); // eslint-disable-line react-hooks/exhaustive-deps

  function slugify(s: string) {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const name = form.name.trim();
    if (!name) return;
    const slug = form.slug.trim() || slugify(name);
    const sku = form.sku.trim() || `NSA-${slug.toUpperCase().slice(0, 20)}`;
    const res = await fetch("/api/admin/notes/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        subject: form.subject.trim() || null,
        sku,
        slug,
        kind: form.kind,
        mrp_paise: form.kind === "single" ? Math.round(Number(form.price || 2999) * 100) : 0,
        selling_price_paise: form.kind === "single" ? Math.round(Number(form.price || 2999) * 100) : 0,
        weight_grams: form.weight ? Number(form.weight) : null,
        length_mm: form.length ? Math.round(Number(form.length) * 10) : null,
        width_mm: form.width ? Math.round(Number(form.width) * 10) : null,
        height_mm: form.height ? Math.round(Number(form.height) * 10) : null,
        on_hand: 0,
        is_active: false,
      }),
    });
    const json = await res.json();
    if (json.ok && json.id) {
      router.push(`/admin/notes/products/${json.id}`);
    } else {
      setMsg(json.error || "Could not create");
    }
  }

  return (
    <div>
      <PageHeader
        title="Notes catalogue"
        subtitle="Manage subject notes and bundles. Tap a card to edit content, media, pricing and availability."
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-ink2">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        <button type="button" onClick={() => setCreating((v) => !v)} className="h-9 rounded-full bg-[var(--primary)] px-4 text-sm font-semibold text-white">
          {creating ? "Close" : "+ New notes product"}
        </button>
      </div>

      {creating && (
        <form onSubmit={create} className="mb-5 grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-ink2">Product title</span>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="min-h-10 w-full rounded-lg border border-line px-3 text-sm" placeholder="e.g. Indian Polity Notes" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-ink2">Subject</span>
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="min-h-10 w-full rounded-lg border border-line px-3 text-sm" placeholder="e.g. Indian Polity" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-ink2">Type</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "single" | "bundle" })} className="min-h-10 w-full rounded-lg border border-line px-3 text-sm">
              <option value="single">Subject notes</option>
              <option value="bundle">Bundle</option>
            </select>
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-ink2">Advanced (SKU / slug)</summary>
            <div className="mt-2 grid gap-2">
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="min-h-10 w-full rounded-lg border border-line px-3 text-sm" placeholder="SKU (auto if blank)" />
              <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="min-h-10 w-full rounded-lg border border-line px-3 text-sm" placeholder="slug (auto if blank)" />
            </div>
          </details>
          {form.kind === "single" && (
            <label className="text-sm">
              <span className="mb-1 block font-medium text-ink2">Selling price (₹)</span>
              <input type="number" min={1} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="min-h-10 w-full rounded-lg border border-line px-3 text-sm" />
            </label>
          )}
          <label className="text-sm">
            <span className="mb-1 block font-medium text-ink2">Packed weight (g)</span>
            <input type="number" min={50} value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} className="min-h-10 w-full rounded-lg border border-line px-3 text-sm" placeholder="Measure once" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-ink2">Length × width × height (cm)</span>
            <span className="grid grid-cols-3 gap-2">
              <input type="number" min={0.5} step="0.1" value={form.length} onChange={(e) => setForm({ ...form, length: e.target.value })} className="min-h-10 rounded-lg border border-line px-2 text-sm" placeholder="L" />
              <input type="number" min={0.5} step="0.1" value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} className="min-h-10 rounded-lg border border-line px-2 text-sm" placeholder="W" />
              <input type="number" min={0.5} step="0.1" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} className="min-h-10 rounded-lg border border-line px-2 text-sm" placeholder="H" />
            </span>
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="h-10 rounded-full bg-ink px-5 text-sm font-semibold text-white">
              Create & edit
            </button>
            {msg && <span className="ml-3 text-sm text-red-700">{msg}</span>}
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-sm text-muted">
          No notes products yet. Create your first one above.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const pill = statusPill(r);
            return (
              <Link
                key={r.id}
                href={`/admin/notes/products/${r.id}`}
                className="flex flex-col rounded-2xl border border-line bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-soft"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{r.subject || (r.kind === "bundle" ? "Bundle" : "Notes")}</p>
                    <h3 className="mt-0.5 truncate font-heading text-base font-bold text-ink">{r.name}</h3>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${pill.cls}`}>{pill.text}</span>
                </div>

                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-lg font-semibold tabular-nums text-ink">{formatPaise(r.selling_price_paise)}</span>
                  {r.mrp_paise > r.selling_price_paise && (
                    <span className="text-sm tabular-nums text-muted line-through">{formatPaise(r.mrp_paise)}</span>
                  )}
                </div>

                <p className="mt-2 text-sm text-ink2">
                  {r.weight_grams && r.length_mm && r.width_mm && r.height_mm
                    ? `${r.weight_grams} g · ${r.length_mm / 10} × ${r.width_mm / 10} × ${r.height_mm / 10} cm · Auto fulfillment ready`
                    : "Package profile required · Auto fulfillment blocked"}
                </p>
                <div className="mt-2 text-sm text-ink2">
                  {r.availability_mode === "ready_stock" ? (
                    <span>{AVAILABILITY_LABEL.ready_stock} · {r.sellable} available</span>
                  ) : (
                    <span>{AVAILABILITY_LABEL[r.availability_mode]}</span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  <span>{r.sample_count ? `${r.sample_count} sample page${r.sample_count === 1 ? "" : "s"}` : "No preview yet"}</span>
                  <span>{r.order_count} order{r.order_count === 1 ? "" : "s"}</span>
                  {!r.has_cover && <span className="text-amber-700">No cover</span>}
                </div>

                <span className="mt-4 inline-flex text-sm font-semibold text-[var(--primary)]">Manage notes →</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
