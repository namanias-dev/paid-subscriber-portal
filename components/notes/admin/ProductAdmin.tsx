"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/ui";
import { formatPaise } from "@/lib/store/money";

interface Row {
  id: string;
  sku: string;
  slug: string;
  name: string;
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
    mrp_paise: "0",
    selling_price_paise: "0",
    on_hand: "0",
    is_active: false,
  });
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/notes/products", { cache: "no-store" });
    const json = await res.json();
    setRows(json.products || []);
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

  return (
    <div>
      <PageHeader title="Notes catalogue" subtitle="Prices are paise (₹1 = 100). Nothing is live until is_active is checked." />
      <form onSubmit={create} className="mb-8 grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-3">
        {(["sku", "slug", "name"] as const).map((k) => (
          <label key={k} className="text-sm">
            {k}
            <input required value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1 w-full rounded border px-2 py-1" />
          </label>
        ))}
        <label className="text-sm">
          MRP paise
          <input value={form.mrp_paise} onChange={(e) => setForm({ ...form, mrp_paise: e.target.value })} className="mt-1 w-full rounded border px-2 py-1" />
        </label>
        <label className="text-sm">
          Selling paise
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
            <th className="p-2">Price</th>
            <th className="p-2">Stock</th>
            <th className="p-2">Live</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2 font-mono text-xs">{r.sku}</td>
              <td className="p-2">{r.name}</td>
              <td className="p-2">{formatPaise(r.selling_price_paise)}</td>
              <td className="p-2">
                {r.on_hand} / reserved {r.reserved}
              </td>
              <td className="p-2">{r.is_active ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
