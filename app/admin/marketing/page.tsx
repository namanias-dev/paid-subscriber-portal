"use client";

import { useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, KpiCard } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import type { Lead } from "@/lib/types";

const TEMPLATES = [
  { name: "Webinar reminder", body: "Hi {name}, your UPSC webinar starts soon! Join here: <link>" },
  { name: "Demo follow-up", body: "Hi {name}, how was your demo class? Ready to enroll? Reply here." },
  { name: "Fee reminder", body: "Hi {name}, a gentle reminder about your pending installment. Pay here: <link>" },
  { name: "Old lead reactivation", body: "Hi {name}, new UPSC batch starting! Special offer for you. Interested?" },
];

const AUDIENCES = [
  { key: "all", label: "All leads" },
  { key: "warm", label: "Warm & Interested" },
  { key: "demo", label: "Demo attended" },
  { key: "admitted", label: "Admitted students" },
  { key: "webinar", label: "Webinar registrants" },
];

export default function MarketingAdmin() {
  const { data: leads, loading } = useAdminData<Lead[]>("/api/admin/leads", "leads");
  const { toast } = useToast();
  const [aud, setAud] = useState("all");

  if (loading) return <LoadingBlock />;
  const list = leads || [];

  function filterAud(key: string) {
    switch (key) {
      case "warm": return list.filter((l) => l.temperature === "Warm" || l.temperature === "Interested");
      case "demo": return list.filter((l) => l.demo_attended);
      case "admitted": return list.filter((l) => l.admitted);
      case "webinar": return list.filter((l) => l.webinar_registered);
      default: return list;
    }
  }
  const selected = filterAud(aud);

  function exportAudience() {
    const rows = [["Name", "Phone"], ...selected.map((l) => [l.name, l.phone])];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `audience-${aud}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${selected.length} contacts`, "success");
  }

  return (
    <div>
      <PageHeader title="Marketing / Broadcast" subtitle="Templates, audiences & bulk outreach" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total audience" value={list.length} />
        <KpiCard label="Selected" value={selected.length} tone="green" />
        <KpiCard label="Templates" value={TEMPLATES.length} />
        <KpiCard label="Channels" value="WhatsApp · Email" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-base">Build an audience</h3>
          <div className="flex flex-wrap gap-2">
            {AUDIENCES.map((a) => (
              <button key={a.key} onClick={() => setAud(a.key)} className={`chip ${aud === a.key ? "chip-active" : ""}`}>{a.label}</button>
            ))}
          </div>
          <p className="mt-4 text-sm text-ink2">{selected.length} contacts match.</p>
          <button onClick={exportAudience} className="btn btn-primary mt-3 w-full text-sm">⬇ Export audience CSV</button>
        </div>

        <div className="card p-5">
          <h3 className="mb-3 text-base">Message templates</h3>
          <div className="space-y-2">
            {TEMPLATES.map((t) => (
              <div key={t.name} className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{t.name}</p>
                  <button onClick={() => { navigator.clipboard.writeText(t.body); toast("Template copied", "success"); }} className="text-xs text-primary">Copy</button>
                </div>
                <p className="mt-1 text-xs text-muted">{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
