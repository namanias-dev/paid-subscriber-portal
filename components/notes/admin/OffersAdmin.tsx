"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/ui";
import { offerDiscountLabel } from "@/lib/store/pricing";
import type { OfferWriteInput, StoreOfferLifecycle, StoreOfferScope } from "@/lib/store/offers";

interface OfferRow extends OfferWriteInput {
  id: string;
  slug: string;
  redemptions_used: number;
  remaining_redemptions: number | null;
  held: number;
  status: StoreOfferLifecycle;
  created_at: string;
}

interface CatalogProduct {
  id: string;
  name: string;
  sku: string;
  kind: string;
  category_id: string | null;
}

interface CatalogCategory {
  id: string;
  name: string;
  slug: string;
}

const EMPTY: OfferWriteInput = {
  name: "",
  slug: "",
  enabled: false,
  discount_type: "percentage",
  discount_value: 20,
  starts_at: "",
  ends_at: "",
  max_redemptions: 100,
  scope: "individual_subjects",
  product_ids: [],
  category_ids: [],
  banner_title: "Limited-time launch offer",
  banner_subtitle: "20% off Naman Sir’s handwritten notes",
  badge_text: "20% OFF",
};

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function statusTone(s: StoreOfferLifecycle): string {
  if (s === "ACTIVE") return "bg-emerald-50 text-emerald-800";
  if (s === "SCHEDULED") return "bg-sky-50 text-sky-800";
  if (s === "PAUSED") return "bg-amber-50 text-amber-800";
  if (s === "ENDED") return "bg-slate-100 text-slate-600";
  return "bg-white text-ink2";
}

function clientErrors(form: OfferWriteInput): string[] {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push("Name is required");
  if (!form.discount_value || form.discount_value <= 0) errors.push("Discount must be greater than 0");
  if (form.discount_type === "percentage" && form.discount_value > 100) errors.push("Percentage cannot exceed 100");
  if (form.starts_at && form.ends_at && new Date(form.ends_at) <= new Date(form.starts_at)) {
    errors.push("End time must be after the start time");
  }
  if (form.max_redemptions != null && form.max_redemptions <= 0) errors.push("Order limit must be greater than 0");
  if (form.scope === "specific_products" && !(form.product_ids || []).length) errors.push("Select at least one product");
  if (form.scope === "specific_categories" && !(form.category_ids || []).length) errors.push("Select at least one category");
  return errors;
}

export default function NotesOffersAdmin() {
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [form, setForm] = useState<OfferWriteInput>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/notes/offers", { cache: "no-store" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Unable to load offers");
    setOffers(json.offers || []);
    setProducts(json.products || []);
    setCategories(json.categories || []);
  }, []);

  useEffect(() => {
    load()
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [load]);

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setErr(null);
  }

  function startEdit(o: OfferRow) {
    setEditingId(o.id);
    setForm({
      name: o.name,
      slug: o.slug,
      enabled: o.enabled,
      discount_type: o.discount_type,
      discount_value: o.discount_value,
      starts_at: toLocalInput(o.starts_at),
      ends_at: toLocalInput(o.ends_at),
      max_redemptions: o.max_redemptions,
      scope: o.scope,
      product_ids: o.product_ids || [],
      category_ids: o.category_ids || [],
      banner_title: o.banner_title || "",
      banner_subtitle: o.banner_subtitle || "",
      badge_text: o.badge_text || "",
    });
    setErr(null);
  }

  const payload = useMemo<OfferWriteInput>(
    () => ({
      ...form,
      name: form.name.trim(),
      slug: form.slug?.trim() || undefined,
      starts_at: fromLocalInput(form.starts_at || ""),
      ends_at: fromLocalInput(form.ends_at || ""),
      max_redemptions: form.max_redemptions == null || form.max_redemptions === 0 ? null : Number(form.max_redemptions),
      product_ids: form.product_ids || [],
      category_ids: form.category_ids || [],
    }),
    [form],
  );

  async function save() {
    const local = clientErrors({ ...form, starts_at: payload.starts_at, ends_at: payload.ends_at });
    if (local.length) {
      setErr(local[0]);
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(editingId ? `/api/admin/notes/offers/${editingId}` : "/api/admin/notes/offers", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Save failed");
      setMsg(editingId ? "Offer updated." : "Offer created.");
      await load();
      if (!editingId && json.offer?.id) startEdit({ ...(json.offer as OfferRow), held: 0, remaining_redemptions: json.offer.max_redemptions, status: "DRAFT" });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, enabled: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/notes/offers/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled_only: true, enabled }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Update failed");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(id: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/notes/offers/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ duplicate: true }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Duplicate failed");
      await load();
      if (json.offer) startEdit({ ...(json.offer as OfferRow), held: 0, remaining_redemptions: json.offer.max_redemptions, status: "DRAFT" });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const previewLabel = form.discount_type === "percentage" || form.discount_type === "fixed_amount"
    ? offerDiscountLabel({ discount_type: form.discount_type, discount_value: Number(form.discount_value) || 0 })
    : "";

  return (
    <div className="space-y-6">
      <PageHeader title="Notes offers" subtitle="Limited-time campaigns that actually change cart and checkout totals." />
      {msg && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}
      {err && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-lg font-bold">Campaigns</h2>
              <button type="button" onClick={startCreate} className="h-9 rounded bg-ink px-3 text-sm font-semibold text-white">
                New offer
              </button>
            </div>
            {offers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line bg-white p-6 text-sm text-muted">No offers yet.</p>
            ) : (
              <ul className="space-y-3">
                {offers.map((o) => (
                  <li key={o.id} className="rounded-xl border border-line bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-heading text-base font-bold">{o.name}</p>
                        <p className="text-xs text-muted">{o.slug}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${statusTone(o.status)}`}>
                        {o.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm">
                      {offerDiscountLabel(o)} · {o.scope.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Used {o.redemptions_used}
                      {o.max_redemptions != null ? ` / ${o.max_redemptions}` : ""}
                      {o.held ? ` · ${o.held} held at checkout` : ""}
                      {o.remaining_redemptions != null ? ` · ${o.remaining_redemptions} remaining` : ""}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className="h-8 rounded border border-line px-2 text-xs font-semibold" onClick={() => startEdit(o)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="h-8 rounded border border-line px-2 text-xs font-semibold"
                        onClick={() => toggle(o.id, !o.enabled)}
                      >
                        {o.enabled ? "Pause" : "Activate"}
                      </button>
                      <button type="button" disabled={busy} className="h-8 rounded border border-line px-2 text-xs font-semibold" onClick={() => duplicate(o.id)}>
                        Duplicate
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form
            className="space-y-4 rounded-xl border border-line bg-white p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <h2 className="font-heading text-lg font-bold">{editingId ? "Edit offer" : "Create offer"}</h2>
            <Field label="Name">
              <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </Field>
            <Field label="Slug (optional)">
              <input className="input" value={form.slug || ""} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Discount type">
                <select
                  className="input"
                  value={form.discount_type}
                  onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value as OfferWriteInput["discount_type"] }))}
                >
                  <option value="percentage">Percentage</option>
                  <option value="fixed_amount">Fixed amount (paise)</option>
                </select>
              </Field>
              <Field label={form.discount_type === "percentage" ? "Percent" : "Amount (paise)"}>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={form.discount_type === "percentage" ? 100 : undefined}
                  value={form.discount_value}
                  onChange={(e) => setForm((f) => ({ ...f, discount_value: Number(e.target.value) }))}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Starts">
                <input className="input" type="datetime-local" value={form.starts_at || ""} onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))} />
              </Field>
              <Field label="Ends">
                <input className="input" type="datetime-local" value={form.ends_at || ""} onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))} />
              </Field>
            </div>
            <Field label="Order limit (leave blank for none)">
              <input
                className="input"
                type="number"
                min={1}
                value={form.max_redemptions ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, max_redemptions: e.target.value ? Number(e.target.value) : null }))}
              />
            </Field>
            <Field label="Applies to">
              <select
                className="input"
                value={form.scope}
                onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value as StoreOfferScope }))}
              >
                <option value="individual_subjects">Individual subject notes</option>
                <option value="all_products">All products</option>
                <option value="specific_products">Specific products</option>
                <option value="specific_categories">Specific categories</option>
                <option value="bundles">Bundles only</option>
              </select>
            </Field>
            {form.scope === "specific_products" && (
              <Field label="Eligible products">
                <select
                  multiple
                  className="input min-h-32"
                  value={form.product_ids || []}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      product_ids: Array.from(e.target.selectedOptions).map((o) => o.value),
                    }))
                  }
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {form.scope === "specific_categories" && (
              <Field label="Eligible categories">
                <select
                  multiple
                  className="input min-h-28"
                  value={form.category_ids || []}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      category_ids: Array.from(e.target.selectedOptions).map((o) => o.value),
                    }))
                  }
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Banner title">
              <input className="input" value={form.banner_title || ""} onChange={(e) => setForm((f) => ({ ...f, banner_title: e.target.value }))} />
            </Field>
            <Field label="Banner subtitle">
              <input className="input" value={form.banner_subtitle || ""} onChange={(e) => setForm((f) => ({ ...f, banner_subtitle: e.target.value }))} />
            </Field>
            <Field label="Badge text">
              <input className="input" value={form.badge_text || ""} onChange={(e) => setForm((f) => ({ ...f, badge_text: e.target.value }))} />
            </Field>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
              Enabled (can become live when the window and cap allow)
            </label>

            <div className="rounded-xl border border-[#d4af37]/35 bg-[#0b1a3f] p-4 text-white">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#fce9a8]">Live customer view</p>
              <p className="mt-2 text-lg font-bold">{previewLabel || "—"}</p>
              <p className="mt-1 text-sm text-white/70">{form.banner_subtitle || form.banner_title || "Banner copy appears here"}</p>
              <p className="mt-2 text-xs text-white/55">
                {form.max_redemptions ? `First ${form.max_redemptions} orders` : "No order cap"}
                {form.ends_at ? ` · Ends ${new Date(fromLocalInput(form.ends_at) || form.ends_at).toLocaleString("en-IN")}` : ""}
              </p>
            </div>

            <button type="submit" disabled={busy} className="h-10 rounded bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Saving…" : editingId ? "Save changes" : "Create offer"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}
