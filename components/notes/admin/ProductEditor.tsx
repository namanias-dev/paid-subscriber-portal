"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/admin/ui";
import MediaManager from "@/components/notes/admin/MediaManager";
import BundleComponents from "@/components/notes/admin/BundleComponents";

type AvailabilityMode = "ready_stock" | "on_demand" | "coming_soon" | "unavailable";

interface Product {
  id: string;
  sku: string;
  slug: string;
  kind: "single" | "bundle";
  name: string;
  subtitle: string | null;
  subject: string | null;
  author: string | null;
  language: string | null;
  edition: string | null;
  stage: string | null;
  short_description: string | null;
  description_md: string | null;
  how_to_use_md: string | null;
  prelims_relevance_md: string | null;
  mains_relevance_md: string | null;
  revision_value_md: string | null;
  highlights: string[];
  ideal_for: string[];
  topics: string[];
  page_count: number | null;
  booklets: number | null;
  physical_format: string | null;
  binding_type: string | null;
  weight_grams: number | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  hsn_code: string | null;
  tax_treatment: string | null;
  tax_rate_bps: number | null;
  mrp_paise: number;
  selling_price_paise: number;
  availability_mode: AvailabilityMode;
  on_hand: number;
  reserved: number;
  low_stock_threshold: number;
  is_active: boolean;
  archived: boolean;
  cover_image_key: string | null;
  paid_demand: number;
  order_count: number;
}

const AVAILABILITY: { value: AvailabilityMode; label: string; blurb: string }[] = [
  { value: "ready_stock", label: "Ready Stock", blurb: "We already have printed copies. Sells down real stock." },
  { value: "on_demand", label: "On Demand", blurb: "Accept orders and prepare copies from demand. No stock number." },
  { value: "coming_soon", label: "Coming Soon", blurb: "Visible to students but cannot be purchased yet." },
  { value: "unavailable", label: "Unavailable", blurb: "Hidden from purchase. Temporarily off." },
];

type SaveState = "saved" | "dirty" | "saving" | "error";

const rupees = (paise: number) => (paise / 100).toString();

export default function ProductEditor({ id }: { id: string }) {
  const router = useRouter();
  const [p, setP] = useState<Product | null>(null);
  const [save, setSave] = useState<SaveState>("saved");
  const [err, setErr] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/notes/products/${id}`, { cache: "no-store" });
    const json = await res.json();
    if (json.ok) {
      setP(json.product);
      loadedRef.current = true;
      setSave("saved");
    } else {
      setErr(json.error);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Warn on leaving with unsaved changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (save === "dirty" || save === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [save]);

  const set = <K extends keyof Product>(key: K, value: Product[K]) => {
    setP((cur) => (cur ? { ...cur, [key]: value } : cur));
    setSave("dirty");
  };

  const discountPct = useMemo(() => {
    if (!p || p.mrp_paise <= p.selling_price_paise) return 0;
    return Math.floor(((p.mrp_paise - p.selling_price_paise) / p.mrp_paise) * 100);
  }, [p]);

  async function persist() {
    if (!p) return;
    if (p.selling_price_paise > p.mrp_paise) {
      setErr("Selling price cannot exceed MRP.");
      setSave("error");
      return;
    }
    if (p.is_active && p.selling_price_paise <= 0) {
      setErr("A live product needs a selling price above ₹0.");
      setSave("error");
      return;
    }
    setSave("saving");
    setErr(null);
    const res = await fetch(`/api/admin/notes/products/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: p.name,
        subtitle: p.subtitle,
        subject: p.subject,
        author: p.author,
        language: p.language,
        edition: p.edition,
        stage: p.stage,
        short_description: p.short_description,
        description_md: p.description_md,
        how_to_use_md: p.how_to_use_md,
        prelims_relevance_md: p.prelims_relevance_md,
        mains_relevance_md: p.mains_relevance_md,
        revision_value_md: p.revision_value_md,
        highlights: p.highlights,
        ideal_for: p.ideal_for,
        topics: p.topics,
        page_count: p.page_count,
        booklets: p.booklets,
        physical_format: p.physical_format,
        binding_type: p.binding_type,
        weight_grams: p.weight_grams,
        length_mm: p.length_mm,
        width_mm: p.width_mm,
        height_mm: p.height_mm,
        hsn_code: p.hsn_code,
        tax_treatment: p.tax_treatment || "exempt",
        tax_rate_bps: p.tax_rate_bps || 0,
        mrp_paise: p.mrp_paise,
        selling_price_paise: p.selling_price_paise,
        availability_mode: p.availability_mode,
        on_hand: p.on_hand,
        low_stock_threshold: p.low_stock_threshold,
        is_active: p.is_active,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      setSave("saved");
    } else {
      setErr(json.error);
      setSave("error");
    }
  }

  async function lifecycle(action: "archive" | "unarchive") {
    const res = await fetch(`/api/admin/notes/products/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = await res.json();
    if (json.ok) await load();
    else setErr(json.error);
  }

  async function del() {
    if (!confirm("Delete this product permanently? This cannot be undone.")) return;
    const res = await fetch(`/api/admin/notes/products/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) {
      router.push("/admin/notes/products");
    } else {
      setErr(json.error || "Could not delete");
    }
  }

  if (err && !p) return <p className="p-4 text-sm text-red-700">{err}</p>;
  if (!p) return <p className="p-4 text-sm text-muted">Loading…</p>;

  const saveLabel =
    save === "saving" ? "Saving…" : save === "dirty" ? "Save changes" : save === "error" ? "Retry save" : "Saved";

  return (
    <div className="pb-24">
      <PageHeader
        title={p.name || "Untitled notes"}
        subtitle={`${p.kind === "bundle" ? "Bundle" : "Subject notes"} · ${p.subject || "no subject"} · ${p.order_count} order${p.order_count === 1 ? "" : "s"}`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/admin/notes/products" className="text-sm font-medium text-[var(--primary)]">
          ← Catalogue
        </Link>
        <span className="text-muted">·</span>
        <a href={`/notes/${p.slug}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-[var(--primary)]">
          View as student ↗
        </a>
        {p.archived && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Archived</span>}
      </div>

      {err && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}

      <div className="space-y-5">
        <Section title="Basic information">
          <Grid>
            <Field label="Subject"><input className={inp} value={p.subject || ""} onChange={(e) => set("subject", e.target.value)} /></Field>
            <Field label="Product title"><input className={inp} value={p.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Subtitle"><input className={inp} value={p.subtitle || ""} onChange={(e) => set("subtitle", e.target.value)} /></Field>
            <Field label="Author"><input className={inp} value={p.author || ""} onChange={(e) => set("author", e.target.value)} /></Field>
            <Field label="Language"><input className={inp} value={p.language || ""} onChange={(e) => set("language", e.target.value)} /></Field>
            <Field label="Edition / Year"><input className={inp} value={p.edition || ""} onChange={(e) => set("edition", e.target.value)} /></Field>
            <Field label="Stage">
              <select className={inp} value={p.stage || ""} onChange={(e) => set("stage", e.target.value || null)}>
                <option value="">—</option>
                <option value="prelims">Prelims</option>
                <option value="mains">Mains</option>
                <option value="both">Both</option>
              </select>
            </Field>
          </Grid>
          <Field label="Short description (one line under the title)">
            <input className={inp} value={p.short_description || ""} onChange={(e) => set("short_description", e.target.value)} />
          </Field>
        </Section>

        <Section title="Full product description">
          <Markdown label="Customer-facing description" value={p.description_md} onChange={(v) => set("description_md", v)} />
          <Markdown label="How to use these notes" value={p.how_to_use_md} onChange={(v) => set("how_to_use_md", v)} />
          <Markdown label="Prelims relevance" value={p.prelims_relevance_md} onChange={(v) => set("prelims_relevance_md", v)} />
          <Markdown label="Mains relevance" value={p.mains_relevance_md} onChange={(v) => set("mains_relevance_md", v)} />
          <Markdown label="Revision value" value={p.revision_value_md} onChange={(v) => set("revision_value_md", v)} />
        </Section>

        <Section title="What's included">
          <Repeatable items={p.highlights} onChange={(v) => set("highlights", v)} placeholder="e.g. Complete Constitution notes" addLabel="Add item" />
        </Section>

        <Section title="Who these notes are for">
          <Repeatable items={p.ideal_for} onChange={(v) => set("ideal_for", v)} placeholder="e.g. Prelims revision" addLabel="Add audience" />
        </Section>

        <Section title="Topics covered">
          <Repeatable items={p.topics} onChange={(v) => set("topics", v)} placeholder="e.g. Fundamental Rights" addLabel="Add topic" />
        </Section>

        <Section title="Physical product">
          <p className="mb-2 text-sm text-emerald-700">Physical hard copy: YES — printed and shipped.</p>
          <Grid>
            <Field label="Approximate pages"><input type="number" min={0} className={inp} value={p.page_count ?? ""} onChange={(e) => set("page_count", e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <Field label="Number of booklets"><input type="number" min={0} className={inp} value={p.booklets ?? ""} onChange={(e) => set("booklets", e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <Field label="Physical format"><input className={inp} value={p.physical_format || ""} placeholder="Printed booklet set" onChange={(e) => set("physical_format", e.target.value)} /></Field>
            <Field label="Binding"><input className={inp} value={p.binding_type || ""} onChange={(e) => set("binding_type", e.target.value)} /></Field>
          </Grid>
        </Section>

        <Section title="Shipping & package">
          <p className="mb-2 text-sm text-[var(--ca-navy)]/70">Saved once and automatically used for courier rates and fulfillment for future orders.</p>
          {p.weight_grams && p.length_mm && p.width_mm && p.height_mm ? (
            <p className="mb-3 text-sm font-semibold text-emerald-800">
              {p.weight_grams} g · {p.length_mm / 10} × {p.width_mm / 10} × {p.height_mm / 10} cm · Auto fulfillment ready
            </p>
          ) : (
            <p className="mb-3 text-sm font-semibold text-amber-800">Package profile required · Auto fulfillment blocked</p>
          )}
          <Grid>
            <Field label="Packed weight (g)"><input type="number" min={50} className={inp} value={p.weight_grams ?? ""} onChange={(e) => set("weight_grams", e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <Field label="Length (cm)"><input type="number" min={0.5} step="0.1" className={inp} value={p.length_mm ? p.length_mm / 10 : ""} onChange={(e) => set("length_mm", e.target.value === "" ? null : Math.round(Number(e.target.value) * 10))} /></Field>
            <Field label="Width (cm)"><input type="number" min={0.5} step="0.1" className={inp} value={p.width_mm ? p.width_mm / 10 : ""} onChange={(e) => set("width_mm", e.target.value === "" ? null : Math.round(Number(e.target.value) * 10))} /></Field>
            <Field label="Height (cm)"><input type="number" min={0.5} step="0.1" className={inp} value={p.height_mm ? p.height_mm / 10 : ""} onChange={(e) => set("height_mm", e.target.value === "" ? null : Math.round(Number(e.target.value) * 10))} /></Field>
          </Grid>
        </Section>

        <Section title="Tax">
          <p className="mb-2 text-sm text-[var(--ca-navy)]/70">Confirm HSN and tax treatment with your CA before accepting production orders. Printed books may have different GST treatment from brochures, loose printed material, workbooks or other printed products.</p>
          <p className="mb-2 text-sm text-[var(--ca-navy)]/70">Store prices are tax-inclusive unless Invoice and tax settings say exclusive. Existing orders keep the snapshot taken at checkout.</p>
          {!p.hsn_code && (p.tax_treatment || "exempt") !== "taxable" && (
            <p className="mb-3 text-sm text-amber-800">HSN is blank. This does not block checkout. Confirm the code with your CA before treating the classification as final.</p>
          )}
          <Grid>
            <Field label="HSN"><input className={inp} value={p.hsn_code || ""} inputMode="numeric" onChange={(e) => set("hsn_code", e.target.value.replace(/[^\d]/g, "").slice(0, 8) || null)} /></Field>
            <Field label="Tax treatment">
              <select className={inp} value={p.tax_treatment || "exempt"} onChange={(e) => set("tax_treatment", e.target.value)}>
                <option value="exempt">Exempt</option>
                <option value="nil">Nil rated</option>
                <option value="taxable">Taxable</option>
              </select>
            </Field>
            <Field label="GST rate (%)">
              <input type="number" min={0} max={40} step="0.01" className={inp} value={p.tax_rate_bps ? p.tax_rate_bps / 100 : ""} placeholder="Only when taxable" onChange={(e) => set("tax_rate_bps", e.target.value === "" ? 0 : Math.round(Number(e.target.value) * 100))} />
            </Field>
          </Grid>
        </Section>

        <Section title="Pricing">
          <Grid>
            <Field label="MRP (₹)"><input type="number" min={0} className={inp} value={rupees(p.mrp_paise)} onChange={(e) => set("mrp_paise", Math.round(Number(e.target.value) * 100))} /></Field>
            <Field label="Selling price (₹)"><input type="number" min={0} className={inp} value={rupees(p.selling_price_paise)} onChange={(e) => set("selling_price_paise", Math.round(Number(e.target.value) * 100))} /></Field>
          </Grid>
          {discountPct > 0 && (
            <p className="mt-2 text-sm font-medium text-emerald-700">
              {discountPct}% OFF · Savings ₹{((p.mrp_paise - p.selling_price_paise) / 100).toLocaleString("en-IN")}
            </p>
          )}
          {p.selling_price_paise > p.mrp_paise && <p className="mt-2 text-sm text-red-700">Selling price cannot exceed MRP.</p>}
        </Section>

        <Section title="Availability">
          <div className="grid gap-2 sm:grid-cols-2">
            {AVAILABILITY.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => set("availability_mode", a.value)}
                className={`rounded-xl border p-3 text-left ${p.availability_mode === a.value ? "border-[var(--primary)] bg-[var(--primary-tint,#eef4ff)] ring-1 ring-[var(--primary)]" : "border-line bg-white"}`}
              >
                <p className="text-sm font-semibold text-ink">{a.label}</p>
                <p className="mt-1 text-xs text-ink2">{a.blurb}</p>
              </button>
            ))}
          </div>
          {p.availability_mode === "ready_stock" && (
            <Grid>
              <Field label="Current quantity"><input type="number" min={p.reserved} className={inp} value={p.on_hand} onChange={(e) => set("on_hand", Number(e.target.value))} /></Field>
              <Field label="Low-stock alert at"><input type="number" min={0} className={inp} value={p.low_stock_threshold} onChange={(e) => set("low_stock_threshold", Number(e.target.value))} /></Field>
              <p className="self-end text-xs text-muted">Reserved (in open orders): {p.reserved}</p>
            </Grid>
          )}
          {p.availability_mode === "on_demand" && (
            <p className="mt-3 rounded-lg bg-surface p-3 text-sm text-ink2">
              Current paid demand: <strong>{p.paid_demand} cop{p.paid_demand === 1 ? "y" : "ies"}</strong> to prepare (see Preparation Queue).
            </p>
          )}
        </Section>

        {p.kind === "bundle" && (
          <Section title="Bundle contents">
            <BundleComponents bundleId={p.id} bundlePricePaise={p.selling_price_paise} />
          </Section>
        )}

        <Section title="Media & sample preview">
          <MediaManager productId={p.id} coverKey={p.cover_image_key} />
        </Section>

        <Section title="Publishing">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={p.is_active} onChange={(e) => set("is_active", e.target.checked)} />
            Live (visible to students). Uncheck to keep as a draft.
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {!p.archived ? (
              <button type="button" onClick={() => lifecycle("archive")} className="h-9 rounded border border-line px-3 text-sm font-medium text-ink2">
                Archive
              </button>
            ) : (
              <button type="button" onClick={() => lifecycle("unarchive")} className="h-9 rounded border border-line px-3 text-sm font-medium text-ink2">
                Unarchive
              </button>
            )}
            <button type="button" onClick={del} className="h-9 rounded border border-red-200 px-3 text-sm font-medium text-red-700">
              Delete
            </button>
            {p.order_count > 0 && (
              <span className="self-center text-xs text-muted">Has order history — delete is blocked; archive instead.</span>
            )}
          </div>
        </Section>
      </div>

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <span
            className={`text-sm font-medium ${
              save === "saved" ? "text-emerald-700" : save === "error" ? "text-red-700" : "text-amber-700"
            }`}
          >
            {save === "saved" ? "All changes saved" : save === "dirty" ? "Unsaved changes" : save === "saving" ? "Saving…" : "Save failed"}
          </span>
          <button
            type="button"
            onClick={persist}
            disabled={save === "saving" || save === "saved"}
            className="h-10 rounded-full bg-[var(--primary)] px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const inp = "min-h-10 w-full rounded-lg border border-line px-3 text-sm";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <h3 className="mb-3 font-heading text-base font-bold text-ink">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink2">{label}</span>
      {children}
    </label>
  );
}

function Markdown({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink2">{label}</span>
      <textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="w-full rounded-lg border border-line px-3 py-2 text-sm"
        placeholder="Use **bold**, - bullets, and ## headings."
      />
    </label>
  );
}

function Repeatable({
  items,
  onChange,
  placeholder,
  addLabel,
}: {
  items: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={inp}
            value={it}
            placeholder={placeholder}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            aria-label="Remove"
            className="h-9 w-9 shrink-0 rounded border border-line text-ink2"
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, ""])} className="text-sm font-semibold text-[var(--primary)]">
        + {addLabel}
      </button>
    </div>
  );
}
