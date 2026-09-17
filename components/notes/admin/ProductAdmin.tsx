"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/ui";
import { formatPaise } from "@/lib/store/money";

interface Row {
  id: string;
  sku: string;
  slug: string;
  name: string;
  mrp_paise: number;
  selling_price_paise: number;
  on_hand: number;
  reserved: number;
  is_active: boolean;
}

export default function NotesProductAdmin() {
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({
    sku: "",
    slug: "",
    name: "",
    mrp_paise: "100",
    selling_price_paise: "100",
    on_hand: "1",
    is_active: false,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { selling_price_paise: string; mrp_paise: string; on_hand: string; is_active: boolean }>>({});

  async function load() {
    const res = await fetch("/api/admin/notes/products", { cache: "no-store" });
    const json = await res.json();
    const products: Row[] = json.products || [];
    setRows(products);
    const next: typeof edits = {};
    for (const r of products) {
      next[r.id] = {
        selling_price_paise: String(r.selling_price_paise),
        mrp_paise: String(r.mrp_paise),
        on_hand: String(r.on_hand),
        is_active: r.is_active,
      };
    }
    setEdits(next);
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/notes/products", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        mrp_paise: Number(form.mrp_paise),
        selling_price_paise: Number(form.selling_price_paise),
        on_hand: Number(form.on_hand),
      }),
    });
    const json = await res.json();
    setMsg(json.ok ? "Saved" : json.error);
    await load();
  }

  async function saveRow(id: string) {
    const edit = edits[id];
    if (!edit) return;
    const res = await fetch("/api/admin/notes/products", {
      method: "PATCH",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        mrp_paise: Number(edit.mrp_paise),
        selling_price_paise: Number(edit.selling_price_paise),
        on_hand: Number(edit.on_hand),
        is_active: edit.is_active,
      }),
    });
    const json = await res.json();
    setMsg(json.ok ? "Updated" : json.error);
    await load();
  }

  return (
    <div>
      <PageHeader
        title="Notes catalogue"
        subtitle="Prices are paise. ₹1 = 100. MRP is raised to selling if you leave it lower. Nothing is live until Active is checked."
      />
      <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        ₹1 Eazypay test SKU: name containing <strong>TEST</strong>, selling 100, MRP 100, on hand ≥ 1, then Active.
        Checkout PIN <strong>160099</strong> is zero-shipping so the gateway charge stays ₹1.
      </p>
      <form onSubmit={create} className="mb-8 grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-3">
        {(["sku", "slug", "name"] as const).map((k) => (
          <label key={k} className="text-sm">
            {k}
            <input required value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1 w-full rounded border px-2 py-1" />
          </label>
        ))}
        <label className="text-sm">
          MRP paise (₹1 = 100)
          <input value={form.mrp_paise} onChange={(e) => setForm({ ...form, mrp_paise: e.target.value })} className="mt-1 w-full rounded border px-2 py-1" />
        </label>
        <label className="text-sm">
          Selling paise (₹1 = 100)
          <input value={form.selling_price_paise} onChange={(e) => setForm({ ...form, selling_price_paise: e.target.value })} className="mt-1 w-full rounded border px-2 py-1" />
        </label>
        <label className="text-sm">
          On hand
          <input value={form.on_hand} onChange={(e) => setForm({ ...form, on_hand: e.target.value })} className="mt-1 w-full rounded border px-2 py-1" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Active
        </label>
        <button type="submit" className="h-10 rounded bg-slate-900 text-white">
          Create
        </button>
        {msg && <p className="text-sm">{msg}</p>}
      </form>
      <table className="w-full border bg-white text-sm">
        <thead>
          <tr className="bg-slate-50 text-left">
            <th className="p-2">SKU</th>
            <th className="p-2">Name</th>
            <th className="p-2">Selling / MRP paise</th>
            <th className="p-2">Stock</th>
            <th className="p-2">Live</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const edit = edits[r.id];
            return (
              <tr key={r.id} className="border-t">
                <td className="p-2 font-mono text-xs">{r.sku}</td>
                <td className="p-2">{r.name}</td>
                <td className="p-2">
                  <div className="flex items-center gap-1">
                    <input
                      className="w-20 rounded border px-1 py-0.5"
                      value={edit?.selling_price_paise ?? ""}
                      onChange={(e) => setEdits((s) => ({ ...s, [r.id]: { ...s[r.id], selling_price_paise: e.target.value } }))}
                    />
                    <span>/</span>
                    <input
                      className="w-20 rounded border px-1 py-0.5"
                      value={edit?.mrp_paise ?? ""}
                      onChange={(e) => setEdits((s) => ({ ...s, [r.id]: { ...s[r.id], mrp_paise: e.target.value } }))}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{formatPaise(r.selling_price_paise)}</p>
                </td>
                <td className="p-2">
                  <input
                    className="w-16 rounded border px-1 py-0.5"
                    value={edit?.on_hand ?? ""}
                    onChange={(e) => setEdits((s) => ({ ...s, [r.id]: { ...s[r.id], on_hand: e.target.value } }))}
                  />
                  <p className="mt-1 text-xs text-slate-500">reserved {r.reserved}</p>
                </td>
                <td className="p-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!edit?.is_active}
                      onChange={(e) => setEdits((s) => ({ ...s, [r.id]: { ...s[r.id], is_active: e.target.checked } }))}
                    />
                    {edit?.is_active ? "yes" : "no"}
                  </label>
                </td>
                <td className="p-2">
                  <button type="button" className="rounded bg-slate-900 px-3 py-1 text-white" onClick={() => saveRow(r.id)}>
                    Save
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
